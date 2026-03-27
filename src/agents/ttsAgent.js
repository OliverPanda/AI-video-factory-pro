/**
 * 配音Agent - 为每段对白生成TTS音频
 */

import path from 'path';
import { textToSpeech } from '../apis/ttsApi.js';
import { ttsQueue, queueWithRetry } from '../utils/queue.js';
import logger from '../utils/logger.js';

/**
 * 为所有分镜批量生成配音
 * @param {Array} shots - 分镜列表
 * @param {Array} characterRegistry - 角色档案（获取性别信息）
 * @param {string} audioDir - 音频输出目录
 * @returns {Promise<Array<{shotId, audioPath, hasDialogue}>>}
 */
export async function generateAllAudio(shots, characterRegistry, audioDir) {
  logger.info('TTSAgent', `开始为 ${shots.length} 个分镜生成配音...`);

  const results = await Promise.all(
    shots.map((shot, i) =>
      queueWithRetry(
        ttsQueue,
        async () => {
          const hasDialogue = shot.dialogue && shot.dialogue.trim() !== '';
          const outputPath = path.join(audioDir, `${shot.id}.mp3`);

          if (!hasDialogue) {
            return { shotId: shot.id, audioPath: null, hasDialogue: false };
          }

          // 获取说话角色的性别
          // 优先用 shot.speaker 字段（明确标注说话者），否则取第一个角色
          const speakerName = shot.speaker || shot.characters?.[0];
          const speakerCard = characterRegistry.find((c) => c.name === speakerName);
          const gender = speakerCard?.gender || 'female';
          if (!shot.speaker && shot.characters?.length > 1) {
            logger.debug('TTSAgent', `${shot.id} 未指定说话者，默认使用 ${speakerName}（共 ${shot.characters.length} 个角色出场）`);
          }

          logger.step(i + 1, shots.length, `TTS: ${shot.id}`);
          const audioPath = await textToSpeech(shot.dialogue, outputPath, { gender });

          return { shotId: shot.id, audioPath, hasDialogue: true };
        },
        3,
        shot.id
      ).catch((err) => {
        logger.error('TTSAgent', `${shot.id} 配音失败：${err.message}`);
        return { shotId: shot.id, audioPath: null, hasDialogue: true, error: err.message };
      })
    )
  );

  const successCount = results.filter((r) => r.audioPath).length;
  logger.info('TTSAgent', `配音完成：${successCount} 个有台词分镜成功合成`);
  return results;
}
