/**
 * 合成Agent - 将图像序列 + 配音 + 字幕合成最终视频
 * 使用 fluent-ffmpeg 调用 FFmpeg
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import { ensureDir } from '../utils/fileHelper.js';
import logger from '../utils/logger.js';

const VIDEO_WIDTH = parseInt(process.env.VIDEO_WIDTH || '1080');
const VIDEO_HEIGHT = parseInt(process.env.VIDEO_HEIGHT || '1920');
const VIDEO_FPS = parseInt(process.env.VIDEO_FPS || '24');

// 按优先级选择可用的中文字体（跨平台兼容）
function detectChineseFont() {
  const candidates = [
    'Microsoft YaHei', // Windows 微软雅黑
    'PingFang SC',     // macOS 苹方
    'Noto Sans CJK SC', // Linux Google Noto
    'WenQuanYi Micro Hei', // Linux 文泉驿
    'SimHei',          // 中易黑体（通用备选）
    'Arial Unicode MS', // 万能备选
  ];
  // 尝试用 fc-list 检测（Linux/macOS），Windows 直接返回首选
  try {
    const installed = execSync('fc-list : family', { timeout: 3000 }).toString();
    for (const font of candidates) {
      if (installed.toLowerCase().includes(font.toLowerCase())) {
        logger.debug('VideoComposer', `检测到字体：${font}`);
        return font;
      }
    }
  } catch {
    // Windows 上 fc-list 不存在，直接用微软雅黑
  }
  return candidates[0]; // 默认微软雅黑
}

const SUBTITLE_FONT = process.env.SUBTITLE_FONT || detectChineseFont();

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

  // 提前检查 FFmpeg 是否可用
  await checkFFmpeg();

  ensureDir(path.dirname(outputPath));

  // 构建合成计划（优先使用动画片段，无片段时回退到静态图）
  const plan = buildCompositionPlan(
    shots,
    imageResults,
    audioResults,
    options.animationClips || []
  );
  if (plan.length === 0) throw new Error('没有可合成的分镜（无可用动画片段或静态图像）');

  logger.info('VideoComposer', `合成计划：${plan.length} 个分镜`);

  // 生成字幕文件（ASS格式，支持中文）
  const subtitlePath = outputPath.replace('.mp4', '.ass');
  generateSubtitleFile(plan, subtitlePath);

  // 合成视频
  await mergeWithFFmpeg(plan, subtitlePath, outputPath);

  logger.info('VideoComposer', `视频合成完成：${outputPath}`);
  return outputPath;
}

// ─── 内部函数 ────────────────────────────────────────────────

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
        duration: visual.duration || shot.duration || shot.durationSec || 3,
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

function generateSubtitleFile(plan, subtitlePath) {
  let currentTime = 0;
  const dialogues = [];

  for (const item of plan) {
    if (item.dialogue) {
      dialogues.push({
        start: currentTime,
        end: currentTime + item.duration,
        text: item.dialogue,
      });
    }
    currentTime += item.duration;
  }

  if (dialogues.length === 0) {
    fs.writeFileSync(subtitlePath, '[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n');
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

  fs.writeFileSync(subtitlePath, header + events);
  logger.debug('VideoComposer', `字幕文件生成：${path.basename(subtitlePath)}（${dialogues.length} 条）`);
}

function mergeWithFFmpeg(plan, subtitlePath, outputPath) {
  return new Promise((resolve, reject) => {
    const tempFiles = [];

    createVisualSegments(plan, outputPath)
      .then(({ segmentPaths, concatListPath, concatVideoPath, tempDir }) => {
        tempFiles.push(...segmentPaths, concatListPath, concatVideoPath, tempDir);
        return concatVisualSegments(concatListPath, concatVideoPath).then(() =>
          muxAudioAndSubtitles(plan, concatVideoPath, subtitlePath, outputPath)
        );
      })
      .then(() => {
        cleanupTempFiles(tempFiles);
        resolve(outputPath);
      })
      .catch((err) => {
        cleanupTempFiles(tempFiles);
        reject(new Error(`FFmpeg 合成失败：${err.message}`));
      });
  });
}

function createVisualSegments(plan, outputPath) {
  const tempDir = outputPath.replace('.mp4', '_segments');
  ensureDir(tempDir);

  const segmentJobs = buildVisualSegmentJobs(plan, tempDir);
  const tasks = segmentJobs.map((job) => {
    if (job.visualType === 'animation_clip') {
      return transcodeAnimationClip(job, job.segmentPath).then(() => job.segmentPath);
    }
    return renderStaticImageSegment(job, job.segmentPath).then(() => job.segmentPath);
  });

  return Promise.all(tasks).then((segmentPaths) => {
    const concatListPath = outputPath.replace('.mp4', '_concat.txt');
    const concatVideoPath = outputPath.replace('.mp4', '_visual.mp4');
    const concatLines = segmentPaths.map((filePath) => `file '${filePath.replace(/\\/g, '/')}'`).join('\n');
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
    '-vf', `ass=${subtitlePath.replace(/\\/g, '/')}`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-r', String(VIDEO_FPS),
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
        logger.debug('VideoComposer', `FFmpeg 命令：${command.slice(0, 120)}...`)
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
  return buildAudioTimeline(plan).filter(
    (item) => item.audioPath && existsSync(item.audioPath)
  );
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

// ─── FFmpeg 可用性检查 ────────────────────────────────────────
function checkFFmpeg() {
  return new Promise((resolve, reject) => {
    ffmpeg.getAvailableFormats((err) => {
      if (err) {
        reject(new Error(
          'FFmpeg 未安装或不在 PATH 中。\n' +
          '  Windows 安装：winget install Gyan.FFmpeg\n' +
          '  或访问：https://ffmpeg.org/download.html'
        ));
      } else {
        resolve();
      }
    });
  });
}
