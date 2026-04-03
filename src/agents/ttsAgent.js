/**
 * 配音Agent - 为每段对白生成TTS音频
 */

import fs from 'node:fs';
import path from 'path';
import { textToSpeech } from '../apis/ttsApi.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import { ttsQueue, queueWithRetry } from '../utils/queue.js';
import { resolveShotParticipants, resolveShotSpeaker } from './characterRegistry.js';
import logger from '../utils/logger.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function findVoiceCastEntry(speaker, voiceCast = []) {
  if (!speaker || !Array.isArray(voiceCast) || voiceCast.length === 0) {
    return null;
  }

  const speakerCard = speaker.character || {};
  const identifiers = new Set(
    [
      speakerCard.id,
      speakerCard.episodeCharacterId,
      speakerCard.mainCharacterTemplateId,
      speaker.name,
      speakerCard.name,
    ].filter(Boolean)
  );

  return voiceCast.find((entry) =>
    [entry?.characterId, entry?.episodeCharacterId, entry?.displayName, entry?.name]
      .filter(Boolean)
      .some((value) => identifiers.has(value))
  ) || null;
}

function writeTtsArtifacts(results, voiceResolution, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const orderedResults = [...results].sort((left, right) => left.shotId.localeCompare(right.shotId));
  const orderedVoiceResolution = [...voiceResolution].sort((left, right) =>
    left.shotId.localeCompare(right.shotId)
  );

  saveJSON(path.join(artifactContext.inputsDir, 'voice-resolution.json'), orderedVoiceResolution);
  saveJSON(path.join(artifactContext.outputsDir, 'audio.index.json'), orderedResults);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'dialogue-table.md'),
    [
      '| Shot ID | Speaker | Voice | Dialogue | Status | Audio Path |',
      '| --- | --- | --- | --- | --- | --- |',
      ...orderedVoiceResolution.map((entry) =>
        `| ${entry.shotId} | ${entry.speakerName || ''} | ${entry.ttsOptions?.voice || entry.resolvedGender || ''} | ${entry.dialogue || ''} | ${entry.status} | ${entry.audioPath || ''} |`
      ),
    ].join('\n') + '\n'
  );

  const dialogueShotCount = orderedVoiceResolution.filter((entry) => entry.hasDialogue).length;
  const synthesizedCount = orderedResults.filter((entry) => entry.audioPath).length;
  const skippedCount = orderedVoiceResolution.filter((entry) => !entry.hasDialogue).length;
  const failureCount = orderedResults.filter((entry) => entry.error).length;
  const defaultVoiceFallbackCount = orderedVoiceResolution.filter((entry) => entry.usedDefaultVoiceFallback).length;
  const uniqueVoiceCount = new Set(
    orderedVoiceResolution
      .map((entry) => entry.ttsOptions?.voice || null)
      .filter(Boolean)
  ).size;
  const voiceUsage = orderedVoiceResolution.reduce((acc, entry) => {
    const key = entry.ttsOptions?.voice || entry.resolvedGender || 'unresolved';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  saveJSON(path.join(artifactContext.metricsDir, 'tts-metrics.json'), {
    dialogue_shot_count: dialogueShotCount,
    synthesized_count: synthesizedCount,
    skipped_count: skippedCount,
    failure_count: failureCount,
    default_voice_fallback_count: defaultVoiceFallbackCount,
    unique_voice_count: uniqueVoiceCount,
    voice_usage: voiceUsage,
  });

  for (const result of orderedResults.filter((entry) => entry.error)) {
    const resolution = orderedVoiceResolution.find((entry) => entry.shotId === result.shotId) || null;
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
  writeAgentQaSummary(
    {
      agentKey: 'ttsAgent',
      agentName: 'TTS Agent',
      status: failureCount > 0 ? 'warn' : 'pass',
      headline:
        failureCount > 0
          ? `有 ${failureCount} 个对白镜头没有成功生成音频`
          : `已成功合成 ${synthesizedCount} 个对白镜头音频`,
      summary:
        failureCount > 0
          ? '主链路已经跑通，但仍有镜头配音失败，需要结合后续 TTS QA 一起判断是否阻断交付。'
          : '配音产物已准备好，可继续进入 TTS QA 和后续视频合成。',
      passItems: [
        `对白镜头数：${dialogueShotCount}`,
        `成功合成数：${synthesizedCount}`,
      ],
      warnItems: failureCount > 0 ? [`失败镜头数：${failureCount}`] : [],
      nextAction:
        failureCount > 0
          ? '先看失败镜头错误文件，再结合 TTS QA 判断是否允许放行。'
          : '可以继续进入 TTS QA。',
      evidenceFiles: ['0-inputs/voice-resolution.json', '1-outputs/audio.index.json', '2-metrics/tts-metrics.json'],
      metrics: {
        dialogueShotCount,
        synthesizedCount,
        skippedCount,
        failureCount,
        defaultVoiceFallbackCount,
        uniqueVoiceCount,
      },
    },
    artifactContext
  );
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
    voiceCast = [],
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
              voicePresetId: null,
              voiceSource: 'none',
            });
            return { shotId: shot.id, audioPath: null, hasDialogue: false };
          }

          const participants = resolveShotParticipants(shot, characterRegistry);
          const speaker = resolveShotSpeaker(shot, characterRegistry);
          const speakerName = speaker?.name || '';
          const gender = speaker?.character?.gender || 'female';
          const speakerCard = speaker?.character || null;
          const ttsOptions = { gender };
          let usedDefaultVoiceFallback = true;
          let voiceSource = 'gender_fallback';
          const voiceCastEntry = findVoiceCastEntry(speaker, voiceCast);
          const voiceProfile = voiceCastEntry?.voiceProfile || null;

          if (!speaker?.relation?.isSpeaker && !shot.speaker && participants.length > 1) {
            logger.debug('TTSAgent', `${shot.id} 未指定说话者，默认使用 ${speakerName}（共 ${participants.length} 个角色出场）`);
          }

          if (voiceProfile) {
            for (const [sourceKey, targetKey] of [
              ['provider', 'provider'],
              ['voice', 'voice'],
              ['voiceId', 'voice'],
              ['mode', 'mode'],
              ['rate', 'rate'],
              ['pitch', 'pitch'],
              ['volume', 'volume'],
              ['referenceAudio', 'referenceAudio'],
              ['referenceId', 'referenceId'],
              ['referenceText', 'referenceText'],
              ['promptText', 'promptText'],
              ['instructText', 'instructText'],
              ['zeroShotSpeakerId', 'zeroShotSpeakerId'],
            ]) {
              if (voiceProfile[sourceKey] !== undefined && ttsOptions[targetKey] === undefined) {
                ttsOptions[targetKey] = voiceProfile[sourceKey];
              }
            }
            usedDefaultVoiceFallback = false;
            voiceSource = 'voice_cast';
          } else if (speakerCard?.voicePresetId && voicePresetLoader) {
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
                voiceSource = 'voice_preset';
              }
            } catch (err) {
              logger.warn('TTSAgent', `${shot.id} 加载语音预设失败，回退性别默认值：${err.message}`);
              usedDefaultVoiceFallback = true;
              voiceSource = 'gender_fallback';
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
              voicePresetId: speakerCard?.voicePresetId || null,
              voiceSource,
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
          voicePresetId: speaker?.character?.voicePresetId || null,
          voiceSource: 'gender_fallback',
        });
        return { shotId: shot.id, audioPath: null, hasDialogue: true, error: err.message };
      })
    )
  );

  const successCount = results.filter((r) => r.audioPath).length;
  logger.info('TTSAgent', `配音完成：${successCount} 个有台词分镜成功合成`);
  writeTtsArtifacts(results, voiceResolution, options.artifactContext);
  results.voiceResolution = voiceResolution;
  return results;
}
