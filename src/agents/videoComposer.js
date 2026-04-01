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

function buildVideoMetrics(plan, outputPath) {
  return {
    composed_shot_count: plan.length,
    subtitle_count: plan.filter((item) => item.dialogue).length,
    total_duration_sec: Number(plan.reduce((sum, item) => sum + item.duration, 0).toFixed(3)),
    output_path: outputPath,
  };
}

function writeComposerArtifacts(plan, outputPath, artifactContext, extras = {}) {
  if (!artifactContext) {
    return;
  }

  const segmentTempDir = outputPath.replace(/\.mp4$/i, '_segments');
  const segmentIndex = buildVisualSegmentJobs(plan, segmentTempDir);

  saveJSON(path.join(artifactContext.outputsDir, 'compose-plan.json'), plan);
  saveJSON(path.join(artifactContext.outputsDir, 'segment-index.json'), segmentIndex);
  saveJSON(path.join(artifactContext.metricsDir, 'video-metrics.json'), buildVideoMetrics(plan, outputPath));

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
  logger.info('VideoComposer', '开始合成视频...');

  const runCheckFFmpeg = options.checkFFmpeg || checkFFmpeg;
  const runGenerateSubtitleFile = options.generateSubtitleFile || generateSubtitleFile;
  const runMergeWithFFmpeg = options.mergeWithFFmpeg || mergeWithFFmpeg;
  const allowedRoots = options.allowedRoots || [];

  await runCheckFFmpeg();

  const safeOutputPath = assertSafeWorkspacePath(outputPath, '输出视频', { allowedRoots });
  ensureDir(path.dirname(safeOutputPath));

  const plan = buildCompositionPlan(
    shots,
    imageResults,
    audioResults,
    options.animationClips || []
  );
  if (plan.length === 0) throw new Error('没有可合成的分镜（无可用动画片段或静态图像）');
  const safePlan = validatePlanPaths(plan, { allowedRoots });

  logger.info('VideoComposer', `合成计划：${safePlan.length} 个分镜`);

  const subtitlePath = safeOutputPath.replace(/\.mp4$/i, '.ass');
  runGenerateSubtitleFile(safePlan, subtitlePath);

  try {
    await runMergeWithFFmpeg(safePlan, subtitlePath, safeOutputPath);
  } catch (error) {
    writeComposerArtifacts(safePlan, safeOutputPath, options.artifactContext, {
      status: 'failed',
      ffmpegCommand: error.ffmpegCommand || error.command || '',
      ffmpegStderr: error.ffmpegStderr || error.stderr || error.message,
    });
    throw error;
  }

  writeComposerArtifacts(safePlan, safeOutputPath, options.artifactContext, {
    status: 'completed',
  });

  logger.info('VideoComposer', `视频合成完成：${safeOutputPath}`);
  return safeOutputPath;
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

export function buildCompositionPlan(
  shots,
  imageResults = [],
  audioResults = [],
  animationClips = []
) {
  return shots
    .map((shot) => {
      const visual = resolveShotVisual(shot, imageResults, animationClips);
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
}

function resolveShotVisual(shot, imageResults, animationClips) {
  const shotDuration = shot.duration || shot.durationSec || 3;
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
      item.visualType === 'animation_clip'
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

function generateSubtitleFile(plan, subtitlePath) {
  const safeSubtitlePath = assertSafeWorkspacePath(subtitlePath, '字幕文件');
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

async function mergeWithFFmpeg(plan, subtitlePath, outputPath) {
  const safeSubtitlePath = assertSafeWorkspacePath(subtitlePath, '字幕文件', { mustExist: true });
  const safeOutputPath = assertSafeWorkspacePath(outputPath, '输出视频');
  const tempFiles = [];

  try {
    const { segmentPaths, concatListPath, concatVideoPath, tempDir } = await createVisualSegments(
      plan,
      safeOutputPath
    );
    tempFiles.push(...segmentPaths, concatListPath, concatVideoPath, tempDir);
    await concatVisualSegments(concatListPath, concatVideoPath);
    await muxAudioAndSubtitles(plan, concatVideoPath, safeSubtitlePath, safeOutputPath);
  } catch (err) {
    throw new Error(`FFmpeg 合成失败：${err.message}`);
  } finally {
    cleanupTempFiles(tempFiles);
  }
}

function createVisualSegments(plan, outputPath) {
  const tempDir = assertSafeWorkspacePath(outputPath.replace(/\.mp4$/i, '_segments'), '视频片段目录');
  ensureDir(tempDir);

  const segmentJobs = buildVisualSegmentJobs(plan, tempDir);
  const tasks = segmentJobs.map((job) => {
    if (job.visualType === 'animation_clip') {
      return transcodeAnimationClip(job, job.segmentPath).then(() => job.segmentPath);
    }
    return renderStaticImageSegment(job, job.segmentPath).then(() => job.segmentPath);
  });

  return Promise.all(tasks).then((segmentPaths) => {
    const concatListPath = assertSafeWorkspacePath(outputPath.replace(/\.mp4$/i, '_concat.txt'), '视频拼接列表');
    const concatVideoPath = assertSafeWorkspacePath(outputPath.replace(/\.mp4$/i, '_visual.mp4'), '视频拼接输出');
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

function muxAudioAndSubtitles(plan, concatVideoPath, subtitlePath, outputPath) {
  const audioItems = collectExistingAudioItems(plan);
  let cmd = ffmpeg().input(concatVideoPath);

  audioItems.forEach((item) => {
    cmd = cmd.input(item.audioPath);
  });

  const outputOptions = [
    '-vf',
    `ass=${escapeFilterPath(subtitlePath)}`,
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
    cmd = cmd.complexFilter(
      `${delayedInputs};${mixInputs}amix=inputs=${audioItems.length}:normalize=0[aout]`,
      ['aout']
    );
    outputOptions.push('-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k');
  }

  return new Promise((resolve, reject) => {
    cmd
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('start', (command) =>
        logger.debug('VideoComposer', `FFmpeg 命令：${command.slice(0, 160)}...`)
      )
      .on('progress', (p) => {
        if (p.percent) process.stdout.write(`\r[FFmpeg] 进度：${Math.round(p.percent)}%`);
      })
      .on('end', () => {
        process.stdout.write('\n');
        resolve(outputPath);
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
  escapeAssText,
  buildCompositionPlan,
  buildVideoMetrics,
  buildSubtitlePath: (outputPath) => outputPath.replace(/\.mp4$/i, '.ass'),
  normalizeAudioDuration: normalizeDuration,
};
