/**
 * 配音Agent - 为每段对白生成TTS音频
 */

import fs from 'node:fs';
import path from 'path';
import { textToSpeech } from '../apis/ttsApi.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { ttsQueue, queueWithRetry } from '../utils/queue.js';
import { resolveShotParticipants, resolveShotSpeaker } from './characterRegistry.js';
import logger from '../utils/logger.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function writeTtsArtifacts(results, voiceResolution, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.inputsDir, 'voice-resolution.json'), voiceResolution);
  saveJSON(path.join(artifactContext.outputsDir, 'audio.index.json'), results);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'dialogue-table.md'),
    [
      '| Shot ID | Speaker | Dialogue | Status | Audio Path |',
      '| --- | --- | --- | --- | --- |',
      ...voiceResolution.map((entry) =>
        `| ${entry.shotId} | ${entry.speakerName || ''} | ${entry.dialogue || ''} | ${entry.status} | ${entry.audioPath || ''} |`
      ),
    ].join('\n') + '\n'
  );

  const dialogueShotCount = voiceResolution.filter((entry) => entry.hasDialogue).length;
  const synthesizedCount = results.filter((entry) => entry.audioPath).length;
  const skippedCount = voiceResolution.filter((entry) => !entry.hasDialogue).length;
  const failureCount = results.filter((entry) => entry.error).length;
  const defaultVoiceFallbackCount = voiceResolution.filter((entry) => entry.usedDefaultVoiceFallback).length;

  saveJSON(path.join(artifactContext.metricsDir, 'tts-metrics.json'), {
    dialogue_shot_count: dialogueShotCount,
    synthesized_count: synthesizedCount,
    skipped_count: skippedCount,
    failure_count: failureCount,
    default_voice_fallback_count: defaultVoiceFallbackCount,
  });

  for (const result of results.filter((entry) => entry.error)) {
    const resolution = voiceResolution.find((entry) => entry.shotId === result.shotId) || null;
    saveJSON(path.join(artifactContext.errorsDir, `${result.shotId}-error.json`), {
      ...result,
      voiceResolution: resolution,
    });
  }

  saveJSON(artifactContext.manifestPath, {
    status: failureCount > 0 ? 'completed_with_errors' : 'completed',
    dialogueShotCount,
    synthesizedCount,
    skippedCount,
    failureCount,
    outputFiles: [
      'voice-resolution.json',
      'audio.index.json',
      'dialogue-table.md',
      'tts-metrics.json',
    ],
  });
}

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
  const voiceResolution = [];

  const results = await Promise.all(
    shots.map((shot, i) =>
      queueWithRetry(
        ttsQueue,
        async () => {
          const hasDialogue = shot.dialogue && shot.dialogue.trim() !== '';
          const outputPath = path.join(audioDir, `${shot.id}.mp3`);

          if (!hasDialogue) {
            voiceResolution.push({
              shotId: shot.id,
              hasDialogue: false,
              dialogue: shot.dialogue || '',
              speakerName: '',
              resolvedGender: null,
              ttsOptions: null,
              usedDefaultVoiceFallback: false,
              status: 'skipped',
              audioPath: null,
            });
            return { shotId: shot.id, audioPath: null, hasDialogue: false };
          }

          const participants = resolveShotParticipants(shot, characterRegistry);
          const speaker = resolveShotSpeaker(shot, characterRegistry);
          const speakerName = speaker?.name || '';
          const gender = speaker?.character?.gender || 'female';
          const speakerCard = speaker?.character || null;
          const ttsOptions = { gender };
          let usedDefaultVoiceFallback = !speakerCard?.voicePresetId;

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
                usedDefaultVoiceFallback = false;
              }
            } catch (err) {
              logger.warn('TTSAgent', `${shot.id} 加载语音预设失败，回退性别默认值：${err.message}`);
              usedDefaultVoiceFallback = true;
            }
          }

          logger.step(i + 1, shots.length, `TTS: ${shot.id}`);
          const audioPath = await runTextToSpeech(shot.dialogue, outputPath, ttsOptions);
          voiceResolution.push({
            shotId: shot.id,
            hasDialogue: true,
            dialogue: shot.dialogue,
            speakerName,
            resolvedGender: gender,
            ttsOptions: { ...ttsOptions },
            usedDefaultVoiceFallback,
            status: 'synthesized',
            audioPath,
          });

          return { shotId: shot.id, audioPath, hasDialogue: true };
        },
        3,
        shot.id
      ).catch((err) => {
        logger.error('TTSAgent', `${shot.id} 配音失败：${err.message}`);
        const speaker = resolveShotSpeaker(shot, characterRegistry);
        const gender = speaker?.character?.gender || 'female';
        voiceResolution.push({
          shotId: shot.id,
          hasDialogue: Boolean(shot.dialogue && shot.dialogue.trim() !== ''),
          dialogue: shot.dialogue || '',
          speakerName: speaker?.name || '',
          resolvedGender: gender,
          ttsOptions: { gender },
          usedDefaultVoiceFallback: true,
          status: 'failed',
          audioPath: null,
          error: err.message,
        });
        return { shotId: shot.id, audioPath: null, hasDialogue: true, error: err.message };
      })
    )
  );

  const successCount = results.filter((r) => r.audioPath).length;
  logger.info('TTSAgent', `配音完成：${successCount} 个有台词分镜成功合成`);
  writeTtsArtifacts(results, voiceResolution, options.artifactContext);
  return results;
}
