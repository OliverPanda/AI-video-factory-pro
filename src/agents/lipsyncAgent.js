import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createLipsyncClip } from '../apis/lipsyncApi.js';
import { writeTextFile, ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import { classifyArtifactReadiness } from '../utils/rootCauseClassifier.js';
import logger from '../utils/logger.js';
import { lipsyncQueue, queueWithRetry } from '../utils/queue.js';

const execFileAsync = promisify(execFile);

function normalizeCameraType(shot) {
  return String(shot?.camera_type || shot?.cameraType || shot?.camera || '').trim().toLowerCase();
}

function inferShotScale(shot) {
  const cameraType = normalizeCameraType(shot);
  if (shot?.isCloseUp === true || /特写|close[-_\s]?up|cu/.test(cameraType)) {
    return 'close_up';
  }
  if (/近景|中景|medium|mc|ms/.test(cameraType)) {
    return 'medium';
  }
  return 'other';
}

function getTriggerReasons(shot) {
  const reasons = [];
  const shotScale = inferShotScale(shot);

  if (shot.visualSpeechRequired === true) reasons.push('visual_speech_required');
  if (shot.isCloseUp === true || shotScale === 'close_up') reasons.push('close_up');
  if (shotScale === 'medium') reasons.push('medium_shot');
  if (shot.isKeyShot === true || shot.storyKey === true || shot.keyDialogue === true) {
    reasons.push('key_shot');
  }

  return Array.from(new Set(reasons));
}

export function shouldApplyLipsync(shot) {
  if (!shot?.dialogue || !String(shot.dialogue).trim()) {
    return false;
  }

  if (shot.visualSpeechRequired === true || shot.isCloseUp === true) {
    return true;
  }

  const cameraType = normalizeCameraType(shot);
  if (!cameraType) {
    return false;
  }

  return /特写|近景|中景|close[-_\s]?up|medium|cu|mc|ms/.test(cameraType);
}

function buildResultStatus(result) {
  if (result?.success === false) return 'failed';
  if (result?.videoPath) return 'completed';
  return 'skipped';
}

async function probeVideoFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return false;
  }

  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      {
        windowsHide: true,
      }
    );

    return String(stdout || '').trim().split(/\r?\n/).includes('video');
  } catch {
    return false;
  }
}

function resolveProviderFailureReason(error) {
  const category = String(error?.category || '').trim().toLowerCase();
  if (category) {
    return category;
  }

  const code = String(error?.code || '').trim().toUpperCase();
  if (code.includes('TIMEOUT')) {
    return 'timeout';
  }
  if (code.includes('NETWORK')) {
    return 'network_error';
  }
  if (code.includes('INVALID_RESPONSE')) {
    return 'invalid_response';
  }

  return 'provider_error';
}

function deriveEntryQa(result, shot) {
  const shotScale = inferShotScale(shot);
  const triggerReasons = getTriggerReasons(shot);
  const warnings = [];
  const blockers = [];
  const timingOffsetMs = Number.isFinite(result?.timingOffsetMs) ? result.timingOffsetMs : null;
  const manualReviewRequired =
    shotScale === 'close_up' ||
    triggerReasons.includes('key_shot') ||
    triggerReasons.includes('visual_speech_required');

  if (result.status === 'failed') {
    if (manualReviewRequired) {
      blockers.push('critical_lipsync_failed');
    } else {
      warnings.push('lipsync_failed_downgraded_to_standard_comp');
    }
  } else if (result.status === 'completed') {
    if (timingOffsetMs !== null) {
      const thresholdMs = shotScale === 'close_up' ? 60 : shotScale === 'medium' ? 80 : 120;
      if (timingOffsetMs > thresholdMs) {
        if (shotScale === 'close_up') {
          blockers.push(`timing_offset_exceeded_${thresholdMs}ms`);
        } else {
          warnings.push(`timing_offset_exceeded_${thresholdMs}ms`);
        }
      }
    } else if (manualReviewRequired) {
      warnings.push('manual_review_required_without_evaluator');
    }
  } else if (result.status === 'skipped' && result.downgradeApplied) {
    warnings.push(result.downgradeReason || 'lipsync_skipped_downgraded_to_standard_comp');
  }

  return {
    shotScale,
    triggerReasons,
    manualReviewRequired,
    qaStatus: blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass',
    qaWarnings: warnings,
    qaBlockers: blockers,
  };
}

function buildLipsyncRootCauseView(results = []) {
  const rootCauseEntries = [];

  for (const result of Array.isArray(results) ? results : []) {
    if (!result?.triggered) {
      continue;
    }

    if (!result?.imagePath) {
      const readiness = classifyArtifactReadiness(
        { imagePath: result?.imagePath, success: false, reason: result?.reason },
        {
          assetPathField: 'imagePath',
          successField: 'success',
          errorFields: ['error', 'reason'],
          readyCode: 'ready',
          readyLabel: '关键帧已就绪',
          timeoutCode: 'image_generation_timeout',
          timeoutLabel: '图像生成超时',
          failureCode: 'image_generation_failed',
          failureLabel: '图像生成失败',
          missingCode: 'image_result_missing',
          missingLabel: '关键帧结果缺失',
          missingReasonCode: 'missing_keyframe_image',
          timeoutReasonCode: 'image_generation_timeout',
          failureReasonCode: 'image_generation_failed',
          missingEvidenceWithoutPath: 'missing_image_for_lipsync',
          missingEvidenceWithPath: 'missing_image_success_flag',
        }
      );
      rootCauseEntries.push({
        shotId: result.shotId,
        severity: 'block',
        symptomCode: 'missing_image',
        symptomLabel: '缺少关键帧',
        rootCauseCode: readiness.rootCauseCode,
        rootCauseLabel: readiness.rootCauseLabel,
        evidence: readiness.evidenceSummary,
        conclusion: `镜头 ${result.shotId} 无法做口型同步，应优先回查上游关键帧产出。`,
      });
    }

    if (!result?.audioPath) {
      const readiness = classifyArtifactReadiness(
        { audioPath: result?.audioPath, success: false, reason: result?.reason },
        {
          assetPathField: 'audioPath',
          successField: 'success',
          errorFields: ['error', 'reason'],
          readyCode: 'ready',
          readyLabel: '音频已就绪',
          timeoutCode: 'tts_generation_timeout',
          timeoutLabel: 'TTS 生成超时',
          failureCode: 'tts_generation_failed',
          failureLabel: 'TTS 生成失败',
          missingCode: 'audio_result_missing',
          missingLabel: '音频结果缺失',
          missingReasonCode: 'missing_audio_asset',
          timeoutReasonCode: 'tts_generation_timeout',
          failureReasonCode: 'tts_generation_failed',
          missingEvidenceWithoutPath: 'missing_audio_for_lipsync',
          missingEvidenceWithPath: 'missing_audio_success_flag',
        }
      );
      rootCauseEntries.push({
        shotId: result.shotId,
        severity: 'block',
        symptomCode: 'missing_audio',
        symptomLabel: '缺少音频',
        rootCauseCode: readiness.rootCauseCode,
        rootCauseLabel: readiness.rootCauseLabel,
        evidence: readiness.evidenceSummary,
        conclusion: `镜头 ${result.shotId} 无法做口型同步，应优先回查上游音频产出。`,
      });
    }

    if (result.status === 'failed') {
      rootCauseEntries.push({
        shotId: result.shotId,
        severity: result.qaStatus === 'block' ? 'block' : 'warn',
        symptomCode: 'lipsync_provider_failure',
        symptomLabel: '口型生成失败',
        rootCauseCode: result.reason || 'provider_error',
        rootCauseLabel: result.reason || 'provider_error',
        evidence: result.error || result.errorCode || result.provider || 'unknown_provider_error',
        conclusion: `镜头 ${result.shotId} 的口型生成失败，应优先排查 lipsync 供应商调用或返回质量。`,
      });
    }

    if (result.reason === 'invalid_video_output') {
      rootCauseEntries.push({
        shotId: result.shotId,
        severity: 'warn',
        symptomCode: 'invalid_video_output',
        symptomLabel: '输出视频无效',
        rootCauseCode: 'provider_output_invalid',
        rootCauseLabel: '供应商输出无效视频',
        evidence: result.provider || 'unknown_provider',
        conclusion: `镜头 ${result.shotId} 返回了无效视频，应优先排查供应商输出质量或编码格式。`,
      });
    }

    if (result.fallbackApplied) {
      rootCauseEntries.push({
        shotId: result.shotId,
        severity: 'warn',
        symptomCode: 'provider_fallback_applied',
        symptomLabel: '已触发 provider fallback',
        rootCauseCode: 'primary_provider_unstable',
        rootCauseLabel: '主 provider 不稳定',
        evidence: `${result.fallbackFrom || 'unknown'} -> ${result.provider || 'unknown'}`,
        conclusion: `镜头 ${result.shotId} 已发生 provider fallback，应优先观察主 provider 的稳定性。`,
      });
    }

    if (Array.isArray(result.qaBlockers) && result.qaBlockers.some((item) => /^timing_offset_exceeded_/i.test(item))) {
      rootCauseEntries.push({
        shotId: result.shotId,
        severity: 'block',
        symptomCode: 'timing_offset_exceeded',
        symptomLabel: '口型时序超阈值',
        rootCauseCode: 'lipsync_alignment_drift',
        rootCauseLabel: '口型对齐漂移',
        evidence: String(result.timingOffsetMs ?? ''),
        conclusion: `镜头 ${result.shotId} 的口型时序超阈值，应优先排查对齐模型或音频节奏。`,
      });
    } else if (Array.isArray(result.qaWarnings) && result.qaWarnings.some((item) => /^timing_offset_exceeded_/i.test(item))) {
      rootCauseEntries.push({
        shotId: result.shotId,
        severity: 'warn',
        symptomCode: 'timing_offset_exceeded',
        symptomLabel: '口型时序偏差',
        rootCauseCode: 'lipsync_alignment_drift',
        rootCauseLabel: '口型对齐漂移',
        evidence: String(result.timingOffsetMs ?? ''),
        conclusion: `镜头 ${result.shotId} 的口型时序有偏差，建议优先抽查对齐效果。`,
      });
    }

    if (result.manualReviewRequired) {
      rootCauseEntries.push({
        shotId: result.shotId,
        severity: result.qaStatus === 'block' ? 'block' : 'warn',
        symptomCode: 'manual_review_required',
        symptomLabel: '需要人工复核',
        rootCauseCode: 'high_visual_salience_shot',
        rootCauseLabel: '高显著性口型镜头',
        evidence: (Array.isArray(result.triggerReasons) ? result.triggerReasons.join(',') : '') || result.shotScale || '',
        conclusion: `镜头 ${result.shotId} 属于高显著性口型镜头，应保留人工复核，不建议仅靠自动放行。`,
      });
    }
  }

  const counts = rootCauseEntries.reduce((acc, item) => {
    acc[item.rootCauseCode] = (acc[item.rootCauseCode] || 0) + 1;
    return acc;
  }, {});
  const topRootCauses = Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .map(([code, count]) => ({ code, count }))
    .slice(0, 5);

  return {
    entries: rootCauseEntries,
    topRootCauses,
    learnedPatterns: [
      rootCauseEntries.some((item) => item.symptomCode === 'missing_image')
        ? 'Lip-sync 缺少关键帧时，应先回查上游生图链路，而不是只在口型层重试。'
        : '',
      rootCauseEntries.some((item) => item.symptomCode === 'missing_audio')
        ? 'Lip-sync 缺少音频时，应先回查上游 TTS 产物，而不是只在口型层重试。'
        : '',
      rootCauseEntries.some((item) => item.symptomCode === 'provider_fallback_applied')
        ? 'Lip-sync 触发 provider fallback 往往说明主 provider 不稳，应该按供应商维度观察。'
        : '',
      rootCauseEntries.some((item) => item.symptomCode === 'timing_offset_exceeded')
        ? 'Lip-sync 时序偏差通常是对齐问题，不应和素材缺失混为一类。'
        : '',
    ].filter(Boolean),
  };
}

function writeArtifacts(report, results, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'lipsync.index.json'), results);
  saveJSON(path.join(artifactContext.metricsDir, 'lipsync-report.json'), report);
  saveJSON(
    path.join(artifactContext.metricsDir, 'lipsync-root-cause.json'),
    report.rootCauseView || { entries: [], topRootCauses: [], learnedPatterns: [] }
  );
  writeTextFile(
    path.join(artifactContext.outputsDir, 'lipsync-report.md'),
    [
      '| Shot ID | Triggered | Exec Status | QA Status | Review | Reason | Output |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...results.map((result) =>
        `| ${result.shotId} | ${result.triggered ? 'yes' : 'no'} | ${result.status} | ${result.qaStatus || ''} | ${result.manualReviewRequired ? 'yes' : 'no'} | ${result.reason || ''} | ${result.videoPath || ''} |`
      ),
    ].join('\n') + '\n'
  );
  writeTextFile(
    path.join(artifactContext.outputsDir, 'lipsync-root-cause.md'),
    [
      '# Lip-sync Root Cause View',
      '',
      '## Top Root Causes',
      ...(report.rootCauseView?.topRootCauses?.length
        ? report.rootCauseView.topRootCauses.map((item) => `- ${item.code}: ${item.count}`)
        : ['- 无']),
      '',
      '## Symptom Links',
      ...(report.rootCauseView?.entries?.length
        ? report.rootCauseView.entries.map((item) =>
            `- ${item.shotId || 'project_level'} | ${item.symptomLabel} -> ${item.rootCauseLabel} | ${item.conclusion}`
          )
        : ['- 无']),
      '',
      '## Learned Patterns',
      ...(report.rootCauseView?.learnedPatterns?.length
        ? report.rootCauseView.learnedPatterns.map((item) => `- ${item}`)
        : ['- 无']),
      '',
    ].join('\n')
  );

  for (const result of results.filter((item) => item.status === 'failed')) {
    saveJSON(path.join(artifactContext.errorsDir, `${result.shotId}-lipsync-error.json`), result);
  }

  saveJSON(artifactContext.manifestPath, {
    status: report.status,
    triggeredCount: report.triggeredCount,
    generatedCount: report.generatedCount,
    failedCount: report.failedCount,
    skippedCount: report.skippedCount,
    downgradedCount: report.downgradedCount,
    fallbackCount: report.fallbackCount,
    fallbackShots: report.fallbackShots,
    manualReviewCount: report.manualReviewCount,
    manualReviewShots: report.manualReviewShots,
    outputFiles: ['lipsync.index.json', 'lipsync-report.json', 'lipsync-root-cause.json', 'lipsync-report.md', 'lipsync-root-cause.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'lipsyncAgent',
      agentName: 'Lip-sync Agent',
      status: report.status,
      headline:
        report.status === 'pass'
          ? `已完成 ${report.generatedCount} 个口型镜头生成`
          : report.status === 'warn'
            ? `口型链路可继续，但有 ${report.warnings.length} 个风险提醒`
            : `口型链路被阻断，有 ${report.blockers.length} 个关键问题`,
      summary:
        report.status === 'pass'
          ? `当前口型镜头已达到最小可交付状态。${report.rootCauseView?.learnedPatterns?.length ? ` 当前沉淀 ${report.rootCauseView.learnedPatterns.length} 条 Lip-sync 根因经验。` : ''}`
          : report.status === 'warn'
            ? `部分镜头已降级或需要人工复核，但主链路仍可继续。${report.rootCauseView?.entries?.length ? ' 可优先查看 lipsync-root-cause 了解症状与主因。' : ''}`
            : `关键口型镜头存在阻断问题，建议先修复再交付。${report.rootCauseView?.entries?.length ? ' 可优先查看 lipsync-root-cause 了解症状与主因。' : ''}`,
      passItems: [
        `触发镜头数：${report.triggeredCount}`,
        `成功生成数：${report.generatedCount}`,
      ],
      warnItems: report.warnings,
      blockItems: report.blockers,
      nextAction:
        report.status === 'pass'
          ? '可以继续进入最终视频合成。'
          : report.status === 'warn'
            ? '优先查看需要人工复核和发生 fallback 的镜头。'
            : '先修复阻断镜头，再重新运行口型同步。',
      evidenceFiles: [
        '2-metrics/lipsync-report.json',
        '2-metrics/lipsync-root-cause.json',
        '1-outputs/lipsync-report.md',
        '1-outputs/lipsync-root-cause.md',
        '1-outputs/lipsync.index.json',
      ],
      metrics: {
        triggeredCount: report.triggeredCount,
        generatedCount: report.generatedCount,
        failedCount: report.failedCount,
        fallbackCount: report.fallbackCount,
        manualReviewCount: report.manualReviewCount,
        rootCauseCount: report.rootCauseView?.entries?.length || 0,
      },
    },
    artifactContext
  );
}

export async function runLipsync(shots, imageResults = [], audioResults = [], options = {}) {
  const {
    artifactContext,
    generateLipsyncClip = async (shot, imageResult, audioResult, runtimeOptions = {}) =>
      createLipsyncClip(
        {
          shotId: shot.id,
          dialogue: shot.dialogue || '',
          imagePath: imageResult?.imagePath || null,
          audioPath: audioResult?.audioPath || null,
          speaker: shot.speaker || null,
        },
        runtimeOptions.outputPathBuilder
          ? runtimeOptions.outputPathBuilder(shot)
          : path.join(process.env.TEMP_DIR || './temp', 'lipsync', `${shot.id}.mp4`),
        runtimeOptions
      ),
    shouldLipsyncShot = shouldApplyLipsync,
    validateGeneratedClip = probeVideoFile,
    outputPathBuilder = (shot) =>
      path.join(process.env.TEMP_DIR || './temp', 'lipsync', `${shot.id}.mp4`),
  } = options;

  const imageResultByShotId = new Map((imageResults || []).map((entry) => [entry.shotId, entry]));
  const audioResultByShotId = new Map((audioResults || []).map((entry) => [entry.shotId, entry]));

  const results = await Promise.all(
    (shots || []).map((shot) => {
      const triggered = shouldLipsyncShot(shot);
      const imageResult = imageResultByShotId.get(shot.id) || null;
      const audioResult = audioResultByShotId.get(shot.id) || null;

      if (!triggered) {
        return Promise.resolve({
          shotId: shot.id,
          triggered: false,
          status: 'skipped',
          reason: 'rule_not_matched',
          triggerReasons: [],
          qaStatus: 'pass',
          qaWarnings: [],
          qaBlockers: [],
          manualReviewRequired: false,
          downgradeApplied: false,
          videoPath: null,
        });
      }

      if (!imageResult?.imagePath) {
        const baseResult = {
          shotId: shot.id,
          triggered: true,
          status: 'failed',
          reason: 'missing_image',
          imagePath: null,
          audioPath: audioResult?.audioPath || null,
          videoPath: null,
          downgradeApplied: true,
          downgradeReason: 'missing_image',
        };
        return Promise.resolve({
          ...baseResult,
          ...deriveEntryQa(baseResult, shot),
        });
      }

      if (!audioResult?.audioPath) {
        const baseResult = {
          shotId: shot.id,
          triggered: true,
          status: 'failed',
          reason: 'missing_audio',
          imagePath: imageResult.imagePath,
          audioPath: null,
          videoPath: null,
          downgradeApplied: true,
          downgradeReason: 'missing_audio',
        };
        return Promise.resolve({
          ...baseResult,
          ...deriveEntryQa(baseResult, shot),
        });
      }

      return queueWithRetry(
        lipsyncQueue,
        async () => {
          try {
            const clip = await generateLipsyncClip(shot, imageResult, audioResult, {
              ...options,
              outputPathBuilder,
              outputPath: outputPathBuilder(shot),
            });
            const clipVideoPath = clip?.videoPath || null;
            const hasValidVideoOutput = clipVideoPath ? await validateGeneratedClip(clipVideoPath) : false;
            const baseResult = {
              shotId: shot.id,
              triggered: true,
              status: clipVideoPath && hasValidVideoOutput ? buildResultStatus(clip) : 'skipped',
              reason:
                clipVideoPath && !hasValidVideoOutput
                  ? 'invalid_video_output'
                  : clip?.reason || null,
              provider: clip?.provider || null,
              attemptedProviders: Array.isArray(clip?.attemptedProviders) ? clip.attemptedProviders : [],
              fallbackApplied: clip?.fallbackApplied === true,
              fallbackFrom: clip?.fallbackFrom || null,
              imagePath: imageResult.imagePath,
              audioPath: audioResult.audioPath,
              videoPath: clipVideoPath && hasValidVideoOutput ? clipVideoPath : null,
              durationSec: clip?.durationSec || shot.durationSec || shot.duration || null,
              timingOffsetMs: Number.isFinite(clip?.timingOffsetMs) ? clip.timingOffsetMs : null,
              evaluator: clip?.evaluator || null,
              downgradeApplied: clipVideoPath && !hasValidVideoOutput,
              downgradeReason: clipVideoPath && !hasValidVideoOutput ? 'invalid_video_output' : null,
            };
            return {
              ...baseResult,
              ...deriveEntryQa(baseResult, shot),
            };
          } catch (error) {
            logger.error('LipsyncAgent', `${shot.id} 口型同步失败：${error.message}`);
            const failureReason = resolveProviderFailureReason(error);
            const baseResult = {
              shotId: shot.id,
              triggered: true,
              status: 'failed',
              reason: failureReason,
              imagePath: imageResult.imagePath,
              audioPath: audioResult.audioPath,
              videoPath: null,
              error: error.message,
              provider: error?.provider || null,
              errorCode: error?.code || null,
              attemptedProviders: Array.isArray(error?.attemptedProviders) ? error.attemptedProviders : [],
              providerErrors: Array.isArray(error?.providerErrors) ? error.providerErrors : [],
              fallbackApplied: false,
              fallbackFrom: null,
              downgradeApplied: true,
              downgradeReason: failureReason,
            };
            return {
              ...baseResult,
              ...deriveEntryQa(baseResult, shot),
            };
          }
        },
        3,
        shot.id || 'lipsync'
      );
    })
  );

  const blockers = results
    .filter((item) => item.qaBlockers?.length)
    .flatMap((item) => item.qaBlockers.map((reason) => `${item.shotId}:${reason}`));
  const warnings = results
    .filter((item) => item.qaWarnings?.length)
    .flatMap((item) => item.qaWarnings.map((reason) => `${item.shotId}:${reason}`));
  const manualReviewShots = results
    .filter((item) => item.manualReviewRequired)
    .map((item) => item.shotId);
  const fallbackShots = results
    .filter((item) => item.fallbackApplied === true)
    .map((item) => item.shotId);

  const report = {
    status: blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass',
    triggeredCount: results.filter((item) => item.triggered).length,
    generatedCount: results.filter((item) => item.status === 'completed').length,
    failedCount: results.filter((item) => item.status === 'failed').length,
    skippedCount: results.filter((item) => item.status === 'skipped').length,
    downgradedCount: results.filter((item) => item.downgradeApplied).length,
    fallbackCount: fallbackShots.length,
    fallbackShots,
    manualReviewCount: manualReviewShots.length,
    manualReviewShots,
    blockers,
    warnings,
    entries: results,
  };
  report.rootCauseView = buildLipsyncRootCauseView(results);

  writeArtifacts(report, results, artifactContext);
  return {
    clips: results.filter((item) => item.videoPath),
    report,
    results,
  };
}

export const __testables = {
  shouldApplyLipsync,
  resolveProviderFailureReason,
  probeVideoFile,
};
