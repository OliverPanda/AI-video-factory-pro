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
 * @param {Array} imageResults - 图像生成结果（{shotId, imagePath}）
 * @param {Array} audioResults - TTS结果（{shotId, audioPath}）
 * @param {string} outputPath - 最终视频路径（.mp4）
 * @param {Object} options - { title }
 */
export async function composeVideo(shots, imageResults, audioResults, outputPath, options = {}) {
  logger.info('VideoComposer', '开始合成视频...');

  // 提前检查 FFmpeg 是否可用
  await checkFFmpeg();

  ensureDir(path.dirname(outputPath));

  // 构建合成计划（过滤掉图像失败的镜头）
  const plan = buildCompositionPlan(shots, imageResults, audioResults);
  if (plan.length === 0) throw new Error('没有可合成的分镜（所有图像生成失败）');

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

function buildCompositionPlan(shots, imageResults, audioResults) {
  return shots
    .map((shot) => {
      const imgResult = imageResults.find((r) => r.shotId === shot.id);
      const audioResult = audioResults.find((r) => r.shotId === shot.id);
      if (!imgResult?.imagePath || !imgResult.success) return null;
      return {
        shotId: shot.id,
        imagePath: imgResult.imagePath,
        audioPath: audioResult?.audioPath || null,
        dialogue: shot.dialogue || '',
        duration: shot.duration || 3,
      };
    })
    .filter(Boolean);
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
    // 创建 FFmpeg 拼接列表文件
    const concatListPath = outputPath.replace('.mp4', '_concat.txt');
    const concatLines = plan
      .map((item) => `file '${item.imagePath.replace(/\\/g, '/')}'\nduration ${item.duration}`)
      .join('\n');
    fs.writeFileSync(concatListPath, concatLines);

    // 音频文件过滤
    const audioItems = plan.filter((item) => item.audioPath && fs.existsSync(item.audioPath));

    let cmd = ffmpeg();

    // 输入：图像序列（concat demuxer）
    cmd = cmd.input(concatListPath).inputOptions(['-f', 'concat', '-safe', '0']);

    // 输入：音频文件（如果有）
    audioItems.forEach((item) => {
      cmd = cmd.input(item.audioPath);
    });

    // 输出配置
    const outputOptions = [
      '-vf', `scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=decrease,pad=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:(ow-iw)/2:(oh-ih)/2,ass=${subtitlePath.replace(/\\/g, '/')}`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-r', String(VIDEO_FPS),
    ];

    if (audioItems.length > 0) {
      // 混合多段音频
      outputOptions.push('-c:a', 'aac', '-b:a', '128k');
    }

    cmd
      .outputOptions(outputOptions)
      .output(outputPath)
      .on('start', (cmd) => logger.debug('VideoComposer', `FFmpeg 命令：${cmd.slice(0, 100)}...`))
      .on('progress', (p) => {
        if (p.percent) process.stdout.write(`\r[FFmpeg] 进度：${Math.round(p.percent)}%`);
      })
      .on('end', () => {
        process.stdout.write('\n');
        // 清理临时文件（有错误日志版本）
        fs.unlink(concatListPath, (err) => {
          if (err && err.code !== 'ENOENT') {
            logger.warn('VideoComposer', `清理临时文件失败：${err.message}`);
          }
        });
        resolve(outputPath);
      })
      .on('error', (err) => {
        fs.unlink(concatListPath, (unlinkErr) => {
          if (unlinkErr && unlinkErr.code !== 'ENOENT') {
            logger.warn('VideoComposer', `清理临时文件失败：${unlinkErr.message}`);
          }
        });
        reject(new Error(`FFmpeg 合成失败：${err.message}`));
      })
      .run();
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
