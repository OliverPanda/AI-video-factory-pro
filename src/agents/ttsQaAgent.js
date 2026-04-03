import fs from 'node:fs';
import path from 'node:path';

import { saveJSON, ensureDir } from '../utils/fileHelper.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function deriveStatus(blockers, warnings) {
  if (blockers.length > 0) return 'block';
  if (warnings.length > 0) return 'warn';
  return 'pass';
}

function levenshteinDistance(source, target) {
  const a = Array.from(source || '');
  const b = Array.from(target || '');
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[a.length][b.length];
}

function normalizeForComparison(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，。！？；：、“”‘’,.!?;:'"()（）]/g, '');
}

function calculateCharacterErrorRate(expectedText, actualText) {
  const normalizedExpected = normalizeForComparison(expectedText);
  const normalizedActual = normalizeForComparison(actualText);

  if (!normalizedExpected) {
    return normalizedActual ? 1 : 0;
  }

  return levenshteinDistance(normalizedExpected, normalizedActual) / normalizedExpected.length;
}

function getVoiceFingerprint(resolution) {
  if (!resolution) {
    return null;
  }

  const provider = resolution?.ttsOptions?.provider || 'env-default';
  const voice = resolution?.ttsOptions?.voice || resolution?.resolvedGender || 'unknown';
  return `${provider}:${voice}`;
}

function getDialogueBudgetMs(shot) {
  if (Number.isFinite(shot?.dialogueDurationMs) && shot.dialogueDurationMs > 0) {
    return shot.dialogueDurationMs;
  }

  if (Number.isFinite(shot?.duration) && shot.duration > 0) {
    return Math.round(shot.duration * 1000);
  }

  return null;
}

function isHighEmotionShot(shot) {
  const emotion = String(shot?.emotion || '').trim().toLowerCase();
  if (!emotion) {
    return false;
  }

  return /怒|哭|喊|吼|激动|崩溃|痛苦|愤怒|震惊|惊讶|恐惧|紧张|压抑|angry|cry|shout|panic|shock|surprise|fear|nervous|intense|emotional/.test(
    emotion
  );
}

function isCloseUpDialogueShot(shot) {
  const cameraType = String(shot?.camera_type || shot?.cameraType || shot?.camera || '')
    .trim()
    .toLowerCase();
  return shot?.isCloseUp === true || shot?.visualSpeechRequired === true || /特写|close[-_\s]?up|cu/.test(cameraType);
}

function buildManualReviewPlan(shots, voiceResolution = []) {
  const dialogueShots = (shots || []).filter((shot) => Boolean(shot?.dialogue && shot.dialogue.trim() !== ''));
  const speakerByShotId = new Map(
    (voiceResolution || []).map((entry) => [entry.shotId, entry?.speakerName || ''])
  );

  const speakerBuckets = new Map();
  for (const shot of dialogueShots) {
    const speakerName = speakerByShotId.get(shot.id) || shot.speaker || '';
    if (!speakerName) {
      continue;
    }

    const bucket = speakerBuckets.get(speakerName) || [];
    bucket.push(shot.id);
    speakerBuckets.set(speakerName, bucket);
  }

  const rankedSpeakers = Array.from(speakerBuckets.entries()).sort((left, right) => right[1].length - left[1].length);
  const protagonistShots = rankedSpeakers[0]?.[1]?.slice(0, 5) || [];
  const supportingShots = rankedSpeakers.slice(1).flatMap(([, shotIds]) => shotIds).slice(0, 3);
  const highEmotionShots = dialogueShots.filter(isHighEmotionShot).map((shot) => shot.id).slice(0, 2);
  const closeUpLipsyncShots = dialogueShots.filter(isCloseUpDialogueShot).map((shot) => shot.id);

  const recommendedShotIds = Array.from(
    new Set([...protagonistShots, ...supportingShots, ...highEmotionShots, ...closeUpLipsyncShots])
  );

  return {
    requiredMinimums: {
      protagonistShots: 5,
      supportingShots: 3,
      highEmotionShots: 2,
      closeUpLipsyncShots: 'all',
    },
    categories: {
      protagonistShots,
      supportingShots,
      highEmotionShots,
      closeUpLipsyncShots,
    },
    recommendedShotIds,
  };
}

function writeArtifacts(report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.metricsDir, 'tts-qa.json'), report);
  saveJSON(
    path.join(artifactContext.metricsDir, 'asr-report.json'),
    report.asrReport || { status: 'not_run', entries: [] }
  );
  writeTextFile(
    path.join(artifactContext.outputsDir, 'voice-cast-report.md'),
    [
      '| Shot ID | Speaker | Voice Source | Provider | Fallback | Duration Δms | ASR CER | Status |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...report.entries.map((entry) =>
        `| ${entry.shotId} | ${entry.speakerName || ''} | ${entry.voiceSource || ''} | ${entry.provider || ''} | ${entry.usedDefaultVoiceFallback ? 'yes' : 'no'} | ${entry.durationDeltaMs ?? ''} | ${entry.asrCharacterErrorRate ?? ''} | ${entry.status} |`
      ),
    ].join('\n') + '\n'
  );
  writeTextFile(
    path.join(artifactContext.outputsDir, 'manual-review-sample.md'),
    [
      '# Manual Review Sample',
      '',
      `- 主角抽查：${report.manualReviewPlan?.categories?.protagonistShots?.join(', ') || '无'}`,
      `- 配角抽查：${report.manualReviewPlan?.categories?.supportingShots?.join(', ') || '无'}`,
      `- 高情绪台词：${report.manualReviewPlan?.categories?.highEmotionShots?.join(', ') || '无'}`,
      `- Close-up / 强检镜头：${report.manualReviewPlan?.categories?.closeUpLipsyncShots?.join(', ') || '无'}`,
      `- 建议总样本：${report.manualReviewPlan?.recommendedShotIds?.join(', ') || '无'}`,
      '',
    ].join('\n')
  );

  saveJSON(artifactContext.manifestPath, {
    status: report.status,
    blockers: report.blockers.length,
    warnings: report.warnings.length,
    outputFiles: ['tts-qa.json', 'asr-report.json', 'voice-cast-report.md', 'manual-review-sample.md'],
  });
}

export async function runTtsQa(shots, audioResults, voiceResolution = [], options = {}) {
  const {
    artifactContext,
    getAudioDurationMs = async () => null,
    transcribeAudio = async () => null,
    asrWarnThreshold = 0.03,
    asrBlockThreshold = 0.2,
  } = options;

  const audioResultByShotId = new Map((audioResults || []).map((entry) => [entry.shotId, entry]));
  const voiceResolutionByShotId = new Map((voiceResolution || []).map((entry) => [entry.shotId, entry]));

  const blockers = [];
  const warnings = [];
  let dialogueShotCount = 0;
  let fallbackCount = 0;
  let budgetCheckedCount = 0;
  let budgetPassingCount = 0;
  const entries = [];
  const asrEntries = [];
  const speakerVoiceFingerprints = new Map();

  for (const shot of shots || []) {
    const hasDialogue = Boolean(shot?.dialogue && shot.dialogue.trim() !== '');
    if (!hasDialogue) {
      continue;
    }

    dialogueShotCount += 1;
    const audioResult = audioResultByShotId.get(shot.id) || null;
    const resolution = voiceResolutionByShotId.get(shot.id) || null;
    const budgetMs = getDialogueBudgetMs(shot);
    let audioDurationMs = null;
    let durationDeltaMs = null;
    let transcript = null;
    let asrCharacterErrorRate = null;
    let entryStatus = 'pass';

    if (!audioResult?.audioPath) {
      blockers.push(`镜头 ${shot.id} 音频缺失`);
      entryStatus = 'block';
    } else {
      if (budgetMs !== null) {
        audioDurationMs = await getAudioDurationMs(audioResult.audioPath, { shot, audioResult, resolution });
        if (Number.isFinite(audioDurationMs)) {
          durationDeltaMs = Math.abs(audioDurationMs - budgetMs);
          budgetCheckedCount += 1;
          if (durationDeltaMs <= 300) {
            budgetPassingCount += 1;
          } else {
            warnings.push(`镜头 ${shot.id} 音频时长偏差 ${durationDeltaMs}ms`);
            entryStatus = 'warn';
          }
        }
      }

      transcript = await transcribeAudio(audioResult.audioPath, { shot, audioResult, resolution });
      if (typeof transcript === 'string' && transcript.trim() !== '') {
        asrCharacterErrorRate = Number(
          calculateCharacterErrorRate(shot.dialogue, transcript).toFixed(4)
        );

        if (asrCharacterErrorRate > asrBlockThreshold) {
          blockers.push(`镜头 ${shot.id} ASR 转写偏差过大`);
          entryStatus = 'block';
        } else if (asrCharacterErrorRate > asrWarnThreshold && entryStatus !== 'block') {
          warnings.push(`镜头 ${shot.id} ASR 转写偏差 ${(asrCharacterErrorRate * 100).toFixed(1)}%`);
          entryStatus = 'warn';
        }
      }
    }

    if (resolution?.usedDefaultVoiceFallback) {
      fallbackCount += 1;
      warnings.push(`镜头 ${shot.id} 使用了 fallback voice`);
      if (entryStatus === 'pass') {
        entryStatus = 'warn';
      }
    }

    entries.push({
      shotId: shot.id,
      speakerName: resolution?.speakerName || '',
      voiceSource: resolution?.voiceSource || '',
      provider: resolution?.ttsOptions?.provider || '',
      usedDefaultVoiceFallback: Boolean(resolution?.usedDefaultVoiceFallback),
      audioDurationMs,
      budgetMs,
      durationDeltaMs,
      transcript,
      asrCharacterErrorRate,
      status: entryStatus,
    });

    asrEntries.push({
      shotId: shot.id,
      expectedText: shot.dialogue || '',
      transcript,
      characterErrorRate: asrCharacterErrorRate,
      status: entryStatus,
    });

    const speakerName = resolution?.speakerName || '';
    const voiceFingerprint = getVoiceFingerprint(resolution);
    if (speakerName && voiceFingerprint) {
      const knownFingerprints = speakerVoiceFingerprints.get(speakerName) || new Set();
      knownFingerprints.add(voiceFingerprint);
      speakerVoiceFingerprints.set(speakerName, knownFingerprints);
    }
  }

  const fallbackRate = dialogueShotCount === 0 ? 0 : fallbackCount / dialogueShotCount;
  const budgetPassRate = budgetCheckedCount === 0 ? 1 : budgetPassingCount / budgetCheckedCount;

  if (fallbackCount > 1 && blockers.length === 0) {
    warnings.push(`fallback 使用率 ${(fallbackRate * 100).toFixed(1)}%`);
  }

  for (const [speakerName, fingerprints] of speakerVoiceFingerprints.entries()) {
    if (fingerprints.size > 1) {
      warnings.push(`角色 ${speakerName} 存在音色漂移：${Array.from(fingerprints).join(' -> ')}`);
    }
  }

  const status = deriveStatus(blockers, warnings);
  const manualReviewPlan = buildManualReviewPlan(shots, voiceResolution);
  const report = {
    status,
    blockers,
    warnings,
    dialogueShotCount,
    fallbackCount,
    fallbackRate,
    budgetCheckedCount,
    budgetPassingCount,
    budgetPassRate,
    asrReport: {
      status: asrEntries.length > 0 ? 'completed' : 'not_run',
      warnThreshold: asrWarnThreshold,
      blockThreshold: asrBlockThreshold,
      entries: asrEntries,
    },
    manualReviewPlan,
    entries,
  };

  writeArtifacts(report, artifactContext);
  return report;
}

export const __testables = {
  calculateCharacterErrorRate,
  normalizeForComparison,
  buildManualReviewPlan,
};
