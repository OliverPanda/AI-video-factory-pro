/**
 * 配音Agent - 为每段对白生成TTS音频
 */

import path from 'path';
import { textToSpeech } from '../apis/ttsApi.js';
import { ttsQueue, queueWithRetry } from '../utils/queue.js';
import { resolveShotParticipants, resolveShotSpeaker } from './characterRegistry.js';
import logger from '../utils/logger.js';

/**
 * 为所有分镜批量生成配音
 * @param {Array} shots - 分镜列表
 * @param {Array} characterRegistry - 角色档案（获取性别信息）
 * @param {string} audioDir - 音频输出目录
 * @param {Object} options - { voicePresetLoader, projectId, textToSpeech }
 * @returns {Promise<Array<{shotId, audioPath, hasDialogue}>>}
 */
export async function generateAllAudio(shots, characterRegistry, audioDir, options = {}) {
  const {
    voicePresetLoader,
    projectId,
    textToSpeech: runTextToSpeech = textToSpeech,
  } = options;
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

          const participants = resolveShotParticipants(shot, characterRegistry);
          const speaker = resolveShotSpeaker(shot, characterRegistry);
          const speakerName = speaker?.name || '';
          const gender = speaker?.character?.gender || 'female';
          const speakerCard = speaker?.character || null;
          const ttsOptions = { gender };

          if (!speaker?.relation?.isSpeaker && !shot.speaker && participants.length > 1) {
            logger.debug('TTSAgent', `${shot.id} 未指定说话者，默认使用 ${speakerName}（共 ${participants.length} 个角色出场）`);
          }

          if (speakerCard?.voicePresetId && voicePresetLoader) {
            try {
              const preset = await voicePresetLoader(speakerCard.voicePresetId, {
                projectId,
                shot,
                speakerName,
                speakerCard,
              });
              if (preset) {
                for (const key of ['voice', 'rate', 'pitch', 'volume']) {
                  if (preset[key] !== undefined) ttsOptions[key] = preset[key];
                }
              }
            } catch (err) {
              logger.warn('TTSAgent', `${shot.id} 加载语音预设失败，回退性别默认值：${err.message}`);
            }
          }

          logger.step(i + 1, shots.length, `TTS: ${shot.id}`);
          const audioPath = await runTextToSpeech(shot.dialogue, outputPath, ttsOptions);

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
