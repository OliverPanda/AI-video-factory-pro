/**
 * 合成Agent - 将图像序列 + 配音 + 字幕合成最终视频
 * 使用 fluent-ffmpeg 调用 FFmpeg
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import logger from '../utils/logger.js';

const VIDEO_WIDTH = parseInt(process.env.VIDEO_WIDTH || '1080', 10);
const VIDEO_HEIGHT = parseInt(process.env.VIDEO_HEIGHT || '1920', 10);
const VIDEO_FPS = parseInt(process.env.VIDEO_FPS || '24', 10);
const WORKSPACE_ROOT = path.resolve(process.cwd());
const ALLOWED_ROOTS = [
  WORKSPACE_ROOT,
  path.resolve(process.env.OUTPUT_DIR || './output'),
  path.resolve(process.env.TEMP_DIR || './temp'),
];

// 按优先级选择可用的中文字体（跨平台兼容）
function detectChineseFont() {
  const candidates = [
    'Microsoft YaHei',
    'PingFang SC',
    'Noto Sans CJK SC',
    'WenQuanYi Micro Hei',
    'SimHei',
    'Arial Unicode MS',
  ];

  if (process.platform === 'win32') {
    return candidates[0];
  }

  try {
    const installed = execSync('fc-list : family', { timeout: 3000 }).toString();
    for (const font of candidates) {
      if (installed.toLowerCase().includes(font.toLowerCase())) {
        logger.debug('VideoComposer', `检测到字体：${font}`);
        return font;
      }
    }
  } catch {
    // 非 Windows 环境未安装 fc-list 时回退到默认字体
  }

  return candidates[0];
}

const SUBTITLE_FONT = process.env.SUBTITLE_FONT || detectChineseFont();

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildSequenceCoverageSummary(plan, shotIds = []) {
  const appliedSequenceIds = Array.from(
    new Set(
      plan
        .filter((item) => item?.visualType === 'sequence_clip' && item?.sequenceId)
        .map((item) => item.sequenceId)
    )
  );
  const coveredShotIds = Array.from(
    new Set(
      plan.flatMap((item) =>
        item?.visualType === 'sequence_clip' && Array.isArray(item.coveredShotIds)
          ? item.coveredShotIds
          : []
      )
    )
  );
  const coveredShotIdSet = new Set(coveredShotIds);
  const fallbackShotIds = (Array.isArray(shotIds) ? shotIds : []).filter((shotId) => !coveredShotIdSet.has(shotId));

  return {
    sequence_coverage_shot_count: coveredShotIds.length,
    sequence_coverage_sequence_count: appliedSequenceIds.length,
    applied_sequence_ids: appliedSequenceIds,
    covered_shot_ids: coveredShotIds,
    fallback_shot_ids: fallbackShotIds,
  };
}

function buildVideoMetrics(plan, outputPath, options = {}) {
  const sequenceCoverageSummary = buildSequenceCoverageSummary(plan, options.shotIds || []);
  return {
    composed_shot_count: plan.length,
    subtitle_count: plan.filter((item) => item.dialogue).length,
    total_duration_sec: Number(plan.reduce((sum, item) => sum + item.duration, 0).toFixed(3)),
    output_path: outputPath,
    ...sequenceCoverageSummary,
  };
}

function buildArtifactIndex(artifactContext, extras = {}) {
  if (!artifactContext) {
    return {
      composePlanUri: null,
      segmentIndexUri: null,
      metricsUri: null,
      qaOverviewUri: null,
      ffmpegCommandUri: extras.ffmpegCommand ? 'inline:ffmpeg-command' : null,
      ffmpegStderrUri: extras.ffmpegStderr ? 'inline:ffmpeg-stderr' : null,
    };
  }

  return {
    composePlanUri: path.join(artifactContext.outputsDir, 'compose-plan.json'),
    segmentIndexUri: path.join(artifactContext.outputsDir, 'segment-index.json'),
    metricsUri: path.join(artifactContext.metricsDir, 'video-metrics.json'),
    qaOverviewUri: path.join(artifactContext.metricsDir, 'qa-summary.json'),
    ffmpegCommandUri: extras.ffmpegCommand
      ? path.join(artifactContext.errorsDir, 'ffmpeg-command.txt')
      : null,
    ffmpegStderrUri: extras.ffmpegStderr
      ? path.join(artifactContext.errorsDir, 'ffmpeg-stderr.txt')
      : null,
  };
}

function buildDeliveryReport(plan, options = {}) {
  const manualReviewShots = Array.from(
    new Set([
      ...(options.ttsQaReport?.manualReviewPlan?.recommendedShotIds || []),
      ...(options.lipsyncReport?.manualReviewShots || []),
    ])
  );
  const blockedReasons = [...(options.blockedReasons || [])];
  const warnings = [...(options.warnings || [])];
  const downgradedShotCount = Number.isFinite(options.lipsyncReport?.downgradedCount)
    ? options.lipsyncReport.downgradedCount
    : 0;
  const sequenceCoverageSummary = buildSequenceCoverageSummary(plan, options.shotIds || []);

  return {
    composedShotCount: plan.length,
    downgradedShotCount,
    blockedReasons,
    warnings,
    manualReviewShots,
    fallbackCount: Number.isFinite(options.lipsyncReport?.fallbackCount)
      ? options.lipsyncReport.fallbackCount
      : 0,
    fallbackShots: Array.isArray(options.lipsyncReport?.fallbackShots)
      ? options.lipsyncReport.fallbackShots
      : [],
    sequenceCoverageSummary,
    qaSummary: {
      audioSync: blockedReasons.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass',
      subtitleLayout: blockedReasons.length > 0 ? 'block' : 'pass',
      lipsyncCoverage: options.lipsyncReport?.status || 'pass',
      deliveryReadiness: blockedReasons.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass',
    },
  };
}

function writeComposerArtifacts(plan, outputPath, artifactContext, extras = {}) {
  if (!artifactContext) {
    return;
  }

  const segmentTempDir = outputPath.replace(/\.mp4$/i, '_segments');
  const segmentIndex = buildVisualSegmentJobs(plan, segmentTempDir);
  const sequenceCoverageSummary = buildSequenceCoverageSummary(plan, extras.shotIds || []);

  saveJSON(path.join(artifactContext.outputsDir, 'compose-plan.json'), plan);
  saveJSON(path.join(artifactContext.outputsDir, 'segment-index.json'), segmentIndex);
  saveJSON(path.join(artifactContext.metricsDir, 'video-metrics.json'), buildVideoMetrics(plan, outputPath, extras));

  if (extras.ffmpegCommand) {
    writeTextFile(path.join(artifactContext.errorsDir, 'ffmpeg-command.txt'), extras.ffmpegCommand);
  }
  if (extras.ffmpegStderr) {
    writeTextFile(path.join(artifactContext.errorsDir, 'ffmpeg-stderr.txt'), extras.ffmpegStderr);
  }

  saveJSON(artifactContext.manifestPath, {
    status: extras.status || 'completed',
    composedShotCount: plan.length,
    outputFiles: ['compose-plan.json', 'segment-index.json', 'video-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'videoComposer',
      agentName: 'Video Composer',
      status: extras.status === 'failed' ? 'block' : 'pass',
      headline:
        extras.status === 'failed'
          ? '成片合成失败，当前没有可签收视频'
          : `已成功合成 ${plan.length} 个镜头的视频`,
      summary:
        extras.status === 'failed'
          ? 'FFmpeg 或上游素材导致最终成片未成功产出。'
          : `最终视频已经输出，sequence 覆盖 ${sequenceCoverageSummary.sequence_coverage_shot_count} 个 shot。`,
      passItems:
        extras.status === 'failed'
          ? []
          : [
              `合成镜头数：${plan.length}`,
              `输出文件：${path.basename(outputPath)}`,
              `命中 sequence：${sequenceCoverageSummary.applied_sequence_ids.join(', ') || '无'}`,
              `未被 sequence 覆盖的 shot：${sequenceCoverageSummary.fallback_shot_ids.join(', ') || '无'}`,
            ],
      blockItems: extras.status === 'failed' ? ['final-video.mp4 未成功产出'] : [],
      nextAction:
        extras.status === 'failed'
          ? '优先查看 ffmpeg-command 和 ffmpeg-stderr，定位合成失败原因。'
          : '可以进入最终验收和交付。',
      evidenceFiles: [
        '1-outputs/compose-plan.json',
        '1-outputs/segment-index.json',
        '2-metrics/video-metrics.json',
        ...(extras.status === 'failed' ? ['3-errors/ffmpeg-command.txt', '3-errors/ffmpeg-stderr.txt'] : []),
      ],
      metrics: buildVideoMetrics(plan, outputPath, extras),
    },
    artifactContext
  );
}

function buildCompositionResult(status, outputPath, artifactContext, plan, extras = {}) {
  return {
    jobId: extras.jobId || null,
    status,
    outputVideo: {
      type: 'video',
      uri: outputPath,
      format: path.extname(outputPath).replace('.', '').toLowerCase() || 'mp4',
    },
    report: buildDeliveryReport(plan, extras),
    artifacts: buildArtifactIndex(artifactContext, extras),
  };
}

/**
 * 合成最终视频
 * @param {Array} shots - 分镜列表（含 duration）
 * @param {Array} imageResults - 图像生成结果（{shotId, keyframeAssetId, imagePath, success}）
 * @param {Array} audioResults - TTS结果（{shotId, audioPath}）
 * @param {string} outputPath - 最终视频路径（.mp4）
 * @param {Object} options - { title, animationClips }
 */
export async function composeVideo(shots, imageResults, audioResults, outputPath, options = {}) {
  return composeFromLegacy(
    {
      shots,
      imageResults,
      audioResults,
      sequenceClips: options.sequenceClips || [],
      videoResults: options.videoClips || [],
      animationClips: options.animationClips || [],
      lipsyncResults: options.lipsyncClips || [],
      bridgeClips: options.bridgeClips || [],
      ttsQaReport: options.ttsQaReport,
      lipsyncReport: options.lipsyncReport,
    },
    outputPath,
    options
  );
}

export async function composeFromLegacy(input, outputPath, options = {}) {
  logger.info('VideoComposer', '开始合成视频...');

  const runCheckFFmpeg = options.checkFFmpeg || checkFFmpeg;
  const runGenerateSubtitleFile = options.generateSubtitleFile || generateSubtitleFile;
  const runMergeWithFFmpeg = options.mergeWithFFmpeg || mergeWithFFmpeg;
  const allowedRoots = options.allowedRoots || [];
  const blockedReasons = [];
  const warnings = [
    ...(input?.ttsQaReport?.status === 'warn' ? input.ttsQaReport.warnings || ['tts_qa_warn'] : []),
    ...(input?.lipsyncReport?.status === 'warn' ? input.lipsyncReport.warnings || ['lipsync_warn'] : []),
  ];

  if (input?.ttsQaReport?.status === 'block') {
    blockedReasons.push(...(input.ttsQaReport.blockers || ['tts_qa_blocked']));
  }
  if (input?.lipsyncReport?.status === 'block') {
    blockedReasons.push(...(input.lipsyncReport.blockers || ['lipsync_blocked']));
  }

  if (blockedReasons.length > 0) {
    return buildCompositionResult('blocked', outputPath, options.artifactContext, [], {
      blockedReasons,
      warnings,
      ttsQaReport: input?.ttsQaReport,
      lipsyncReport: input?.lipsyncReport,
      shotIds: Array.isArray(input?.shots) ? input.shots.map((shot) => shot?.id).filter(Boolean) : [],
      jobId: options.jobId || input?.jobId || null,
    });
  }

  await runCheckFFmpeg();

  const safeOutputPath = assertSafeWorkspacePath(outputPath, '输出视频', { allowedRoots });
  ensureDir(path.dirname(safeOutputPath));

  const adaptedInput = adaptLegacyComposeInput(input);
  const plan = buildCompositionPlan(
    adaptedInput.shots,
    adaptedInput.imageResults,
    adaptedInput.audioResults,
    adaptedInput.sequenceClips,
    adaptedInput.videoResults,
    adaptedInput.animationClips,
    adaptedInput.lipsyncResults,
    adaptedInput.bridgeClips
  );
  if (plan.length === 0) throw new Error('没有可合成的分镜（无可用动画片段或静态图像）');
  const safePlan = validatePlanPaths(plan, { allowedRoots });

  logger.info('VideoComposer', `合成计划：${safePlan.length} 个分镜`);

  const subtitlePath = safeOutputPath.replace(/\.mp4$/i, '.ass');
  runGenerateSubtitleFile(safePlan, subtitlePath, { allowedRoots });

  try {
    await runMergeWithFFmpeg(safePlan, subtitlePath, safeOutputPath, { allowedRoots });
  } catch (error) {
    writeComposerArtifacts(safePlan, safeOutputPath, options.artifactContext, {
      status: 'failed',
      ffmpegCommand: error.ffmpegCommand || error.command || '',
      ffmpegStderr: error.ffmpegStderr || error.stderr || error.message,
      shotIds: adaptedInput.shots.map((shot) => shot.id),
    });
    throw error;
  }

  writeComposerArtifacts(safePlan, safeOutputPath, options.artifactContext, {
    status: 'completed',
    shotIds: adaptedInput.shots.map((shot) => shot.id),
  });

  logger.info('VideoComposer', `视频合成完成：${safeOutputPath}`);
  return buildCompositionResult(
    warnings.length > 0 ? 'completed_with_warnings' : 'completed',
    safeOutputPath,
    options.artifactContext,
    safePlan,
    {
      warnings,
      ttsQaReport: input?.ttsQaReport,
      lipsyncReport: input?.lipsyncReport,
      shotIds: adaptedInput.shots.map((shot) => shot.id),
      jobId: options.jobId || input?.jobId || null,
    }
  );
}

export async function composeFromJob(job, outputPath, options = {}) {
  const legacyInput = adaptCompositionJobToLegacy(job);
  return composeFromLegacy(legacyInput, outputPath, {
    ...options,
    jobId: job?.jobId || options.jobId || null,
  });
}

function normalizeLegacyShot(shot, order) {
  const durationSec = Number(shot?.duration ?? shot?.durationSec ?? 3);
  const dialogue = shot?.dialogue || '';

  return {
    shotId: shot?.id,
    order,
    durationMs: Math.round(normalizeDuration(durationSec) * 1000),
    dialogue,
    speakerId: shot?.speaker || '',
    subtitleSource: dialogue,
    metadata: {
      dialogueDurationMs: shot?.dialogueDurationMs ?? null,
      camera_type: shot?.camera_type,
      cameraType: shot?.cameraType,
      isCloseUp: shot?.isCloseUp,
      visualSpeechRequired: shot?.visualSpeechRequired,
    },
  };
}

function buildLegacyAssetBundle(input = {}) {
  return {
    visuals: (input.imageResults || [])
      .filter((entry) => entry?.imagePath)
      .map((entry) => ({
        assetId: entry.keyframeAssetId || `visual_${entry.shotId}`,
        shotId: entry.shotId,
        type: 'image',
        uri: entry.imagePath,
        format: path.extname(entry.imagePath).replace('.', '').toLowerCase() || 'png',
      })),
    audios: (input.audioResults || [])
      .filter((entry) => entry?.audioPath)
      .map((entry) => ({
        assetId: `audio_${entry.shotId}`,
        shotId: entry.shotId,
        type: 'audio',
        uri: entry.audioPath,
        format: path.extname(entry.audioPath).replace('.', '').toLowerCase() || 'mp3',
      })),
    clips: [
      ...((input.videoResults || [])
        .filter((entry) => entry?.videoPath)
        .map((entry) => ({
          assetId: `video_${entry.shotId}`,
          shotId: entry.shotId,
          role: 'video',
          type: 'video',
          uri: entry.videoPath,
          durationSec: entry.durationSec ?? entry.targetDurationSec ?? null,
          format: path.extname(entry.videoPath).replace('.', '').toLowerCase() || 'mp4',
        }))),
      ...((input.sequenceClips || [])
        .filter((entry) => entry?.videoPath)
        .map((entry) => ({
          assetId: `sequence_${entry.sequenceId}`,
          shotId: (entry.coveredShotIds || [])[0] || entry.sequenceId,
          role: 'sequence',
          type: 'video',
          uri: entry.videoPath,
          durationSec: entry.durationSec ?? entry.actualDurationSec ?? entry.targetDurationSec ?? null,
          format: path.extname(entry.videoPath).replace('.', '').toLowerCase() || 'mp4',
        }))),
      ...((input.animationClips || [])
        .filter((entry) => entry?.videoPath)
        .map((entry) => ({
          assetId: `animation_${entry.shotId}`,
          shotId: entry.shotId,
          role: 'animation',
          type: 'video',
          uri: entry.videoPath,
          durationSec: entry.durationSec ?? null,
          format: path.extname(entry.videoPath).replace('.', '').toLowerCase() || 'mp4',
        }))),
      ...((input.lipsyncResults || [])
        .filter((entry) => entry?.videoPath)
        .map((entry) => ({
          assetId: `lipsync_${entry.shotId}`,
          shotId: entry.shotId,
          role: 'lipsync',
          type: 'video',
          uri: entry.videoPath,
          durationSec: entry.durationSec ?? null,
          format: path.extname(entry.videoPath).replace('.', '').toLowerCase() || 'mp4',
        }))),
      ...((input.bridgeClips || [])
        .filter((entry) => entry?.videoPath)
        .map((entry) => ({
          assetId: `bridge_${entry.bridgeId}`,
          shotId: entry.fromShotId || entry.shotId || entry.bridgeId,
          role: 'bridge',
          type: 'video',
          uri: entry.videoPath,
          durationSec: entry.durationSec ?? null,
          format: path.extname(entry.videoPath).replace('.', '').toLowerCase() || 'mp4',
        }))),
    ],
  };
}

function adaptLegacyComposeInput(input = {}) {
  const normalizedShots = (input.shots || []).map((shot, index) => normalizeLegacyShot(shot, index));

  return {
    shots: normalizedShots.map((shot) => ({
      id: shot.shotId,
      durationSec: shot.durationMs / 1000,
      dialogue: shot.dialogue,
      speaker: shot.speakerId,
      subtitleSource: shot.subtitleSource,
      ...shot.metadata,
    })),
    imageResults: input.imageResults || [],
    audioResults: input.audioResults || [],
    sequenceClips: input.sequenceClips || [],
    videoResults: input.videoResults || [],
    animationClips: input.animationClips || [],
    lipsyncResults: input.lipsyncResults || [],
    bridgeClips: input.bridgeClips || [],
    assets: buildLegacyAssetBundle(input),
    normalizedShots,
  };
}

function adaptCompositionJobToLegacy(job = {}) {
  const assetIndex = new Map();
  for (const list of [
    ...(job?.assets?.visuals ? [job.assets.visuals] : []),
    ...(job?.assets?.audios ? [job.assets.audios] : []),
    ...(job?.assets?.clips ? [job.assets.clips] : []),
  ]) {
    for (const item of list) {
      if (item?.shotId) {
        const bucket = assetIndex.get(item.shotId) || [];
        bucket.push(item);
        assetIndex.set(item.shotId, bucket);
      }
    }
  }

  const sortedShots = [...(job?.shots || [])].sort((left, right) => (left.order || 0) - (right.order || 0));

  return {
    jobId: job?.jobId || null,
    shots: sortedShots.map((shot) => ({
      id: shot.shotId,
      durationSec: (shot.durationMs || 3000) / 1000,
      dialogue: shot.dialogue || '',
      speaker: shot.speakerId || '',
    })),
    imageResults: sortedShots.map((shot) => {
      const entries = assetIndex.get(shot.shotId) || [];
      const visual = entries.find((entry) => entry.type === 'image' && entry.uri === shot.visualRef) ||
        entries.find((entry) => entry.type === 'image');
      return {
        shotId: shot.shotId,
        imagePath: visual?.uri || null,
        success: Boolean(visual?.uri),
      };
    }),
    audioResults: sortedShots.map((shot) => {
      const entries = assetIndex.get(shot.shotId) || [];
      const audio = entries.find((entry) => entry.type === 'audio' && entry.uri === shot.audioRef) ||
        entries.find((entry) => entry.type === 'audio');
      return {
        shotId: shot.shotId,
        audioPath: audio?.uri || null,
      };
    }),
    videoResults: sortedShots
      .map((shot) => {
        const entries = assetIndex.get(shot.shotId) || [];
        const clip = entries.find((entry) => entry.role === 'video' && entry.uri === shot.videoRef) ||
          entries.find((entry) => entry.role === 'video');
        return clip ? {
          shotId: shot.shotId,
          videoPath: clip.uri,
          durationSec: clip.durationSec || null,
          status: 'completed',
        } : null;
      })
      .filter(Boolean),
    animationClips: sortedShots
      .map((shot) => {
        const entries = assetIndex.get(shot.shotId) || [];
        const clip = entries.find((entry) => entry.role === 'animation' && entry.uri === shot.animationRef) ||
          entries.find((entry) => entry.role === 'animation');
        return clip ? {
          shotId: shot.shotId,
          videoPath: clip.uri,
          durationSec: clip.durationSec || null,
        } : null;
      })
      .filter(Boolean),
    lipsyncResults: sortedShots
      .map((shot) => {
        const entries = assetIndex.get(shot.shotId) || [];
        const clip = entries.find((entry) => entry.role === 'lipsync' && entry.uri === shot.lipsyncRef) ||
          entries.find((entry) => entry.role === 'lipsync');
        return clip ? {
          shotId: shot.shotId,
          videoPath: clip.uri,
          durationSec: clip.durationSec || null,
          status: 'completed',
        } : null;
      })
      .filter(Boolean),
    sequenceClips: Array.isArray(job?.sequenceClips)
      ? job.sequenceClips
          .filter((clip) => clip?.sequenceId && clip?.videoPath)
          .map((clip) => ({
            sequenceId: clip.sequenceId,
            coveredShotIds: Array.isArray(clip.coveredShotIds) ? clip.coveredShotIds : [],
            videoPath: clip.videoPath,
            durationSec: clip.durationSec ?? clip.actualDurationSec ?? clip.targetDurationSec ?? null,
            status: clip.status || 'completed',
            finalDecision: clip.finalDecision || 'pass',
          }))
      : [],
  };
}

function assertSafeWorkspacePath(targetPath, label, options = {}) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error(`${label} 路径无效`);
  }

  if (/[\r\n\0]/.test(targetPath)) {
    throw new Error(`${label} 路径包含非法控制字符`);
  }

  const resolved = path.resolve(targetPath);
  const allowedRoots = [...ALLOWED_ROOTS, ...(options.allowedRoots || [])]
    .filter(Boolean)
    .map((root) => path.resolve(root));
  const isAllowed = allowedRoots.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });

  if (!isAllowed) {
    throw new Error(`${label} 路径超出允许范围：${resolved}`);
  }

  if (options.mustExist && !fs.existsSync(resolved)) {
    throw new Error(`${label} 不存在：${resolved}`);
  }

  return resolved;
}

function escapeConcatPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, `'\\''`);
}

function escapeFilterPath(filePath) {
  return filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function buildSubtitleFilterArg(filePath) {
  return `subtitles='${escapeFilterPath(filePath)}'`;
}

function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\N')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

function normalizeDuration(duration) {
  const numericDuration = Number(duration);
  return Number.isFinite(numericDuration) && numericDuration > 0 ? numericDuration : 0.1;
}

function isVideoBackedVisualType(visualType) {
  return (
    visualType === 'generated_video_clip' ||
    visualType === 'animation_clip' ||
    visualType === 'lipsync_clip' ||
    visualType === 'bridge_clip' ||
    visualType === 'sequence_clip'
  );
}

export function buildCompositionPlan(
  shots,
  imageResults = [],
  audioResults = [],
  sequenceClips = [],
  videoClips = [],
  animationClips = [],
  lipsyncClips = [],
  bridgeClips = []
) {
  const approvedSequenceClips = buildApprovedSequenceClips(sequenceClips, shots);
  const coveredShotIds = new Set(approvedSequenceClips.flatMap((clip) => clip.coveredShotIds));
  const insertedSequenceIds = new Set();

  const basePlan = shots
    .map((shot) => {
      const sequenceClip = approvedSequenceClips.find(
        (clip) => clip.startShotId === shot.id && !insertedSequenceIds.has(clip.sequenceId)
      );
      if (sequenceClip) {
        insertedSequenceIds.add(sequenceClip.sequenceId);
        return {
          shotId: `sequence:${sequenceClip.sequenceId}`,
          sequenceId: sequenceClip.sequenceId,
          coveredShotIds: sequenceClip.coveredShotIds,
          timelineFromShotId: sequenceClip.startShotId,
          timelineToShotId: sequenceClip.endShotId,
          visualType: 'sequence_clip',
          videoPath: sequenceClip.videoPath,
          audioPath: null,
          dialogue: '',
          duration: normalizeDuration(sequenceClip.durationSec),
        };
      }

      if (coveredShotIds.has(shot.id)) {
        return null;
      }

      const visual = resolveShotVisual(shot, imageResults, videoClips, animationClips, lipsyncClips);
      const audioResult = audioResults.find((r) => r.shotId === shot.id);
      if (!visual) return null;

      return {
        shotId: shot.id,
        ...visual,
        audioPath: audioResult?.audioPath || null,
        dialogue: shot.dialogue || '',
        duration: normalizeDuration(visual.duration || shot.duration || shot.durationSec || 3),
      };
    })
    .filter(Boolean);

  return insertBridgeClips(basePlan, bridgeClips);
}

function resolveShotVisual(shot, imageResults, videoClips, animationClips, lipsyncClips) {
  const shotDuration = shot.duration || shot.durationSec || 3;
  const generatedVideoClip = videoClips.find((clip) => clip.shotId === shot.id && clip.videoPath);
  if (generatedVideoClip) {
    return {
      visualType: 'generated_video_clip',
      videoPath: generatedVideoClip.videoPath,
      duration: generatedVideoClip.durationSec || shotDuration,
    };
  }

  const lipsyncClip = lipsyncClips.find((clip) => clip.shotId === shot.id && clip.videoPath);
  if (lipsyncClip) {
    return {
      visualType: 'lipsync_clip',
      videoPath: lipsyncClip.videoPath,
      duration: lipsyncClip.durationSec || shotDuration,
    };
  }

  const animationClip = animationClips.find((clip) => clip.shotId === shot.id && clip.videoPath);
  if (animationClip) {
    return {
      visualType: 'animation_clip',
      videoPath: animationClip.videoPath,
      duration: animationClip.durationSec || shotDuration,
    };
  }

  const imgResult = imageResults.find((result) => result.shotId === shot.id);
  if (!imgResult?.imagePath || imgResult.success === false) {
    return null;
  }

  return {
    visualType: 'static_image',
    imagePath: imgResult.imagePath,
    duration: shotDuration,
  };
}

function buildApprovedSequenceClips(sequenceClips = [], shots = []) {
  const shotOrder = new Map((Array.isArray(shots) ? shots : []).map((shot, index) => [shot.id, index]));
  const consumedShotIds = new Set();

  return (Array.isArray(sequenceClips) ? sequenceClips : [])
    .filter(
      (clip) =>
        clip?.sequenceId &&
        clip?.videoPath &&
        clip?.finalDecision === 'pass' &&
        Array.isArray(clip.coveredShotIds) &&
        clip.coveredShotIds.length > 0
    )
    .map((clip) => {
      const orderedShotIds = [...clip.coveredShotIds].sort(
        (left, right) => (shotOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (shotOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
      );
      return {
        ...clip,
        coveredShotIds: orderedShotIds,
        startShotId: orderedShotIds[0],
        endShotId: orderedShotIds[orderedShotIds.length - 1],
        durationSec: clip.durationSec ?? clip.actualDurationSec ?? clip.targetDurationSec ?? null,
      };
    })
    .sort(
      (left, right) => (shotOrder.get(left.startShotId) ?? Number.MAX_SAFE_INTEGER) - (shotOrder.get(right.startShotId) ?? Number.MAX_SAFE_INTEGER)
    )
    .filter((clip) => {
      const uniqueShotIds = new Set(clip.coveredShotIds);
      if (uniqueShotIds.size < 2 || uniqueShotIds.size !== clip.coveredShotIds.length) {
        return false;
      }

      const indexes = clip.coveredShotIds.map((shotId) => shotOrder.get(shotId));
      const hasUnknownShot = indexes.some((index) => !Number.isFinite(index));
      if (hasUnknownShot) {
        return false;
      }

      const isContiguous = indexes.every((index, position) => position === 0 || index === indexes[position - 1] + 1);
      if (!isContiguous) {
        return false;
      }

      const overlapsExisting = clip.coveredShotIds.some((shotId) => consumedShotIds.has(shotId));
      if (overlapsExisting) {
        return false;
      }

      clip.coveredShotIds.forEach((shotId) => consumedShotIds.add(shotId));
      return true;
    });
}

function insertBridgeClips(plan, bridgeClips = []) {
  const approvedBridgeClips = (Array.isArray(bridgeClips) ? bridgeClips : []).filter(
    (clip) => clip?.videoPath && clip?.finalDecision === 'pass' && clip?.fromShotId && clip?.toShotId
  );
  if (approvedBridgeClips.length === 0) {
    return plan;
  }

  const timeline = [];
  for (const [index, item] of plan.entries()) {
    timeline.push(item);
    const anchorShotId = item.timelineToShotId || item.shotId;
    const nextItem = plan[index + 1] || null;
    const nextAnchorShotId = nextItem?.timelineFromShotId || nextItem?.shotId || null;
    for (const clip of approvedBridgeClips.filter((entry) => entry.fromShotId === anchorShotId && entry.toShotId === nextAnchorShotId)) {
      timeline.push({
        shotId: `bridge:${clip.bridgeId}`,
        bridgeId: clip.bridgeId,
        fromShotId: clip.fromShotId,
        toShotId: clip.toShotId,
        visualType: 'bridge_clip',
        videoPath: clip.videoPath,
        audioPath: null,
        dialogue: '',
        duration: normalizeDuration(clip.durationSec),
      });
    }
  }

  return timeline;
}

function validatePlanPaths(plan, options = {}) {
  return plan.map((item) => ({
    ...item,
    imagePath:
      item.visualType === 'static_image'
        ? assertSafeWorkspacePath(item.imagePath, `分镜 ${item.shotId} 图像`, {
            mustExist: true,
            allowedRoots: options.allowedRoots,
          })
        : item.imagePath,
    videoPath:
      item.visualType === 'generated_video_clip' ||
      item.visualType === 'sequence_clip' ||
      item.visualType === 'bridge_clip' ||
      item.visualType === 'animation_clip' ||
      item.visualType === 'lipsync_clip'
        ? assertSafeWorkspacePath(item.videoPath, `分镜 ${item.shotId} 动画`, {
            mustExist: true,
            allowedRoots: options.allowedRoots,
          })
        : item.videoPath,
    audioPath: item.audioPath
      ? assertSafeWorkspacePath(item.audioPath, `分镜 ${item.shotId} 音频`, {
          mustExist: true,
          allowedRoots: options.allowedRoots,
        })
      : null,
  }));
}

function generateSubtitleFile(plan, subtitlePath, options = {}) {
  const safeSubtitlePath = assertSafeWorkspacePath(subtitlePath, '字幕文件', {
    allowedRoots: options.allowedRoots,
  });
  let currentTime = 0;
  const dialogues = [];

  for (const item of plan) {
    if (item.dialogue) {
      dialogues.push({
        start: currentTime,
        end: currentTime + item.duration,
        text: escapeAssText(item.dialogue),
      });
    }
    currentTime += item.duration;
  }

  if (dialogues.length === 0) {
    fs.writeFileSync(
      safeSubtitlePath,
      '[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
    );
    return;
  }

  const toASSTime = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const cs = Math.round((sec % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO_WIDTH}
PlayResY: ${VIDEO_HEIGHT}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${SUBTITLE_FONT},52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = dialogues
    .map((d) => `Dialogue: 0,${toASSTime(d.start)},${toASSTime(d.end)},Default,,0,0,0,,${d.text}`)
    .join('\n');

  fs.writeFileSync(safeSubtitlePath, header + events);
  logger.debug('VideoComposer', `字幕文件生成：${path.basename(safeSubtitlePath)}（${dialogues.length} 条）`);
}

async function mergeWithFFmpeg(plan, subtitlePath, outputPath, options = {}) {
  const safeSubtitlePath = assertSafeWorkspacePath(subtitlePath, '字幕文件', {
    mustExist: true,
    allowedRoots: options.allowedRoots,
  });
  const safeOutputPath = assertSafeWorkspacePath(outputPath, '输出视频', {
    allowedRoots: options.allowedRoots,
  });
  const tempFiles = [];

  try {
    const { segmentPaths, concatListPath, concatVideoPath, tempDir } = await createVisualSegments(
      plan,
      safeOutputPath,
      options
    );
    tempFiles.push(...segmentPaths, concatListPath, concatVideoPath, tempDir);
    await concatVisualSegments(concatListPath, concatVideoPath);
    await muxAudioAndSubtitles(plan, concatVideoPath, safeSubtitlePath, safeOutputPath, options);
  } catch (err) {
    throw new Error(`FFmpeg 合成失败：${err.message}`);
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

function createVisualSegments(plan, outputPath, options = {}) {
  const tempDir = assertSafeWorkspacePath(outputPath.replace(/\.mp4$/i, '_segments'), '视频片段目录', {
    allowedRoots: options.allowedRoots,
  });
  ensureDir(tempDir);

  const segmentJobs = buildVisualSegmentJobs(plan, tempDir);
  const tasks = segmentJobs.map((job) => {
    if (isVideoBackedVisualType(job.visualType)) {
      return transcodeAnimationClip(job, job.segmentPath).then(() => job.segmentPath);
    }
    return renderStaticImageSegment(job, job.segmentPath).then(() => job.segmentPath);
  });

  return Promise.all(tasks).then((segmentPaths) => {
    const concatListPath = assertSafeWorkspacePath(outputPath.replace(/\.mp4$/i, '_concat.txt'), '视频拼接列表', {
      allowedRoots: options.allowedRoots,
    });
    const concatVideoPath = assertSafeWorkspacePath(outputPath.replace(/\.mp4$/i, '_visual.mp4'), '视频拼接输出', {
      allowedRoots: options.allowedRoots,
    });
    const concatLines = segmentPaths.map((filePath) => `file '${escapeConcatPath(filePath)}'`).join('\n');
    fs.writeFileSync(concatListPath, concatLines);
    return { segmentPaths, concatListPath, concatVideoPath, tempDir };
  });
}

function renderStaticImageSegment(item, segmentPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(item.imagePath)
      .inputOptions(['-loop', '1'])
      .outputOptions([
        '-t', String(item.duration),
        '-vf', buildScalePadFilter(),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-r', String(VIDEO_FPS),
        '-an',
      ])
      .output(segmentPath)
      .on('end', () => resolve(segmentPath))
      .on('error', reject)
      .run();
  });
}

function transcodeAnimationClip(item, segmentPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(item.videoPath)
      .outputOptions([
        '-t', String(item.duration),
        '-vf', buildScalePadFilter(),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-r', String(VIDEO_FPS),
        '-an',
      ])
      .output(segmentPath)
      .on('end', () => resolve(segmentPath))
      .on('error', reject)
      .run();
  });
}

function concatVisualSegments(concatListPath, concatVideoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions([
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-r', String(VIDEO_FPS),
        '-an',
      ])
      .output(concatVideoPath)
      .on('end', () => resolve(concatVideoPath))
      .on('error', reject)
      .run();
  });
}

function muxAudioAndSubtitles(plan, concatVideoPath, subtitlePath, outputPath, options = {}) {
  const audioItems = collectExistingAudioItems(plan);
  const safeConcatVideoPath = assertSafeWorkspacePath(concatVideoPath, '视频拼接输出', {
    mustExist: true,
    allowedRoots: options.allowedRoots,
  });
  const safeSubtitlePath = assertSafeWorkspacePath(subtitlePath, '字幕文件', {
    mustExist: true,
    allowedRoots: options.allowedRoots,
  });
  const safeOutputPath = assertSafeWorkspacePath(outputPath, '输出视频', {
    allowedRoots: options.allowedRoots,
  });
  let cmd = ffmpeg().input(safeConcatVideoPath);

  audioItems.forEach((item) => {
    cmd = cmd.input(item.audioPath);
  });

  const outputOptions = [
    '-vf',
    buildSubtitleFilterArg(safeSubtitlePath),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(VIDEO_FPS),
  ];

  if (audioItems.length > 0) {
    const delayedInputs = audioItems
      .map((item, index) => `[${index + 1}:a]adelay=${item.offsetMs}|${item.offsetMs}[a${index}]`)
      .join(';');
    const mixInputs = audioItems.map((_, index) => `[a${index}]`).join('');
    cmd = cmd.complexFilter(`${delayedInputs};${mixInputs}amix=inputs=${audioItems.length}:normalize=0[aout]`);
    outputOptions.push('-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
  }

  return new Promise((resolve, reject) => {
    cmd
      .outputOptions(outputOptions)
      .output(safeOutputPath)
      .on('start', (command) =>
        logger.debug('VideoComposer', `FFmpeg 命令：${command.slice(0, 160)}...`)
      )
      .on('progress', (p) => {
        if (p.percent) process.stdout.write(`\r[FFmpeg] 进度：${Math.round(p.percent)}%`);
      })
      .on('end', () => {
        process.stdout.write('\n');
        resolve(safeOutputPath);
      })
      .on('error', reject)
      .run();
  });
}

export function buildAudioTimeline(plan) {
  let elapsed = 0;

  return plan.map((item) => {
    const timelineItem = {
      shotId: item.shotId,
      audioPath: item.audioPath,
      offsetMs: Math.round(elapsed * 1000),
    };
    elapsed += item.duration;
    return timelineItem;
  });
}

export function collectExistingAudioItems(plan, existsSync = fs.existsSync) {
  return buildAudioTimeline(plan).filter((item) => item.audioPath && existsSync(item.audioPath));
}

export function buildVisualSegmentJobs(plan, tempDir) {
  return plan.map((item, index) => ({
    ...item,
    segmentPath: path.join(tempDir, `${String(index).padStart(3, '0')}_${item.shotId}.mp4`),
  }));
}

function buildScalePadFilter() {
  return `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2`;
}

function cleanupTempFiles(filePaths) {
  filePaths.forEach((filePath) => {
    fs.rm(filePath, { recursive: true, force: true }, (err) => {
      if (err && err.code !== 'ENOENT') {
        logger.warn('VideoComposer', `清理临时文件失败：${err.message}`);
      }
    });
  });
}

function checkFFmpeg() {
  return new Promise((resolve, reject) => {
    ffmpeg.getAvailableFormats((err) => {
      if (err) {
        reject(
          new Error(
            'FFmpeg 未安装或不在 PATH 中。\n' +
              '  Windows 安装：winget install Gyan.FFmpeg\n' +
              '  或访问：https://ffmpeg.org/download.html'
          )
        );
      } else {
        resolve();
      }
    });
  });
}

export const __testables = {
  assertSafeWorkspacePath,
  escapeConcatPath,
  escapeFilterPath,
  buildSubtitleFilterArg,
  escapeAssText,
  isVideoBackedVisualType,
  normalizeLegacyShot,
  buildLegacyAssetBundle,
  adaptLegacyComposeInput,
  adaptCompositionJobToLegacy,
  buildArtifactIndex,
  buildDeliveryReport,
  buildCompositionPlan,
  buildSequenceCoverageSummary,
  buildVideoMetrics,
  buildApprovedSequenceClips,
  insertBridgeClips,
  buildSubtitlePath: (outputPath) => outputPath.replace(/\.mp4$/i, '.ass'),
  normalizeAudioDuration: normalizeDuration,
};
