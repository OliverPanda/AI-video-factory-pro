import fs from 'node:fs';
import path from 'node:path';

import { saveJSON, ensureDir } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import { classifyArtifactReadiness } from '../utils/rootCauseClassifier.js';

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
  const speakersByShotId = groupVoiceResolutionByShotId(voiceResolution);

  const speakerBuckets = new Map();
  for (const shot of dialogueShots) {
    const speakerNames = Array.from(
      new Set(
        (speakersByShotId.get(shot.id) || [])
          .map((entry) => entry?.speakerName || '')
          .filter(Boolean)
      )
    );
    if (speakerNames.length === 0 && shot.speaker) {
      speakerNames.push(shot.speaker);
    }
    if (speakerNames.length === 0) {
      continue;
    }

    for (const speakerName of speakerNames) {
      const bucket = speakerBuckets.get(speakerName) || [];
      if (!bucket.includes(shot.id)) {
        bucket.push(shot.id);
      }
      speakerBuckets.set(speakerName, bucket);
    }
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

function groupVoiceResolutionByShotId(voiceResolution = []) {
  const grouped = new Map();
  for (const entry of voiceResolution || []) {
    if (!entry?.shotId) {
      continue;
    }

    const entries = grouped.get(entry.shotId) || [];
    entries.push(entry);
    grouped.set(entry.shotId, entries);
  }
  return grouped;
}

function joinUniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean))).join(' / ');
}

function summarizeVoiceResolutionForShot(resolutions = []) {
  if (resolutions.length === 0) {
    return null;
  }
  if (resolutions.length === 1) {
    return resolutions[0];
  }

  return {
    shotId: resolutions[0].shotId,
    hasDialogue: resolutions.some((entry) => entry.hasDialogue),
    dialogue: resolutions.map((entry) => entry.dialogue || '').filter(Boolean).join('\n'),
    speakerName: joinUniqueValues(resolutions.map((entry) => entry.speakerName || '')),
    voiceSource: joinUniqueValues(resolutions.map((entry) => entry.voiceSource || '')),
    ttsOptions: {
      provider: joinUniqueValues(resolutions.map((entry) => entry.ttsOptions?.provider || '')),
      voice: joinUniqueValues(resolutions.map((entry) => entry.ttsOptions?.voice || '')),
    },
    usedDefaultVoiceFallback: resolutions.some((entry) => entry.usedDefaultVoiceFallback),
    segments: resolutions.map((entry) => ({
      segmentId: entry.segmentId || null,
      speakerName: entry.speakerName || '',
      voiceSource: entry.voiceSource || '',
      provider: entry.ttsOptions?.provider || '',
      voice: entry.ttsOptions?.voice || '',
      usedDefaultVoiceFallback: Boolean(entry.usedDefaultVoiceFallback),
      dialogue: entry.dialogue || '',
    })),
  };
}

function buildTtsRootCauseView(report, audioResults = [], voiceResolution = []) {
  const audioByShotId = new Map((audioResults || []).map((entry) => [entry.shotId, entry]));
  const resolutionsByShotId = groupVoiceResolutionByShotId(voiceResolution);
  const rootCauseEntries = [];

  for (const entry of report.entries || []) {
    const audioResult = audioByShotId.get(entry.shotId) || {};
    const segmentResolutions = resolutionsByShotId.get(entry.shotId) || [];
    const resolution = summarizeVoiceResolutionForShot(segmentResolutions) || {};

    if (!audioResult?.audioPath) {
      const readiness = classifyArtifactReadiness(audioResult, {
        assetPathField: 'audioPath',
        successField: 'hasDialogue',
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
        missingEvidenceWithoutPath: 'missing_audio_result',
        missingEvidenceWithPath: 'missing_audio_success_flag',
      });

      rootCauseEntries.push({
        shotId: entry.shotId,
        severity: 'block',
        symptomCode: 'missing_audio',
        symptomLabel: '音频缺失',
        rootCauseCode: readiness.rootCauseCode,
        rootCauseLabel: readiness.rootCauseLabel,
        evidence: readiness.evidenceSummary,
        conclusion: `镜头 ${entry.shotId} 缺少可交付音频，应优先排查上游 TTS 生成链路。`,
      });
    }

    for (const segmentResolution of segmentResolutions.length > 0 ? segmentResolutions : [resolution]) {
      if (segmentResolution?.usedDefaultVoiceFallback) {
        rootCauseEntries.push({
          shotId: entry.shotId,
          segmentId: segmentResolution.segmentId || null,
          severity: entry.status === 'block' ? 'block' : 'warn',
          symptomCode: 'fallback_voice_used',
          symptomLabel: '使用 fallback voice',
          rootCauseCode: 'voice_binding_missing_or_unbound',
          rootCauseLabel: '角色未绑定稳定音色',
          evidence: segmentResolution?.voiceSource || 'gender_fallback',
          conclusion: `镜头 ${entry.shotId}${segmentResolution.segmentId ? `/${segmentResolution.segmentId}` : ''} 使用了 fallback voice，应优先补齐角色级语音绑定。`,
        });
      }
    }

    if (Number.isFinite(entry.asrCharacterErrorRate) && entry.asrCharacterErrorRate > 0.03) {
      rootCauseEntries.push({
        shotId: entry.shotId,
        severity: entry.asrCharacterErrorRate > 0.2 ? 'block' : 'warn',
        symptomCode: 'asr_text_drift',
        symptomLabel: 'ASR 转写偏差',
        rootCauseCode: 'tts_content_or_pronunciation_drift',
        rootCauseLabel: 'TTS 内容或发音漂移',
        evidence: `cer=${entry.asrCharacterErrorRate}`,
        conclusion: `镜头 ${entry.shotId} 的文本回写偏差较大，应优先排查发音、停连或文本送入是否漂移。`,
      });
    }
  }

  for (const warning of report.warnings || []) {
    const match = /角色\s+(.+?)\s+存在音色漂移/.exec(String(warning));
    if (!match) continue;
    rootCauseEntries.push({
      shotId: null,
      severity: 'warn',
      symptomCode: 'speaker_voice_drift',
      symptomLabel: '角色音色漂移',
      rootCauseCode: 'voice_binding_inconsistent',
      rootCauseLabel: '同角色音色绑定不一致',
      evidence: warning,
      conclusion: `角色 ${match[1]} 在多个镜头间使用了不同音色，应优先统一项目级声音绑定。`,
    });
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
      rootCauseEntries.some((item) => item.symptomCode === 'missing_audio')
        ? 'TTS QA 出现“音频缺失”时，应先回看上游 TTS 生成结果，而不是只在 QA 层重试。'
        : '',
      rootCauseEntries.some((item) => item.symptomCode === 'fallback_voice_used')
        ? 'TTS QA 出现 fallback voice 时，应优先补角色级声音绑定，再看供应商效果。'
        : '',
      rootCauseEntries.some((item) => item.symptomCode === 'speaker_voice_drift')
        ? '同角色跨镜头音色漂移通常是绑定不一致，而不是单条音频偶发问题。'
        : '',
    ].filter(Boolean),
  };
}

function writeArtifacts(report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.metricsDir, 'tts-qa.json'), report);
  saveJSON(
    path.join(artifactContext.metricsDir, 'tts-root-cause.json'),
    report.rootCauseView || { entries: [], topRootCauses: [], learnedPatterns: [] }
  );
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
  writeTextFile(
    path.join(artifactContext.outputsDir, 'tts-root-cause.md'),
    [
      '# TTS Root Cause View',
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

  saveJSON(artifactContext.manifestPath, {
    status: report.status,
    blockers: report.blockers.length,
    warnings: report.warnings.length,
    outputFiles: ['tts-qa.json', 'tts-root-cause.json', 'asr-report.json', 'voice-cast-report.md', 'manual-review-sample.md', 'tts-root-cause.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'ttsQaAgent',
      agentName: 'TTS QA Agent',
      status: report.status,
      headline:
        report.status === 'pass'
          ? '配音质量检查通过'
          : report.status === 'warn'
            ? `配音可继续交付，但有 ${report.warnings.length} 个风险提醒`
            : `配音被阻断，有 ${report.blockers.length} 个关键问题`,
      summary:
        report.status === 'pass'
          ? `音频存在、时长预算和文本回写都在可接受范围内。${report.rootCauseView?.learnedPatterns?.length ? ` 当前沉淀 ${report.rootCauseView.learnedPatterns.length} 条 TTS 根因经验。` : ''}`
          : report.status === 'warn'
            ? `主链路可继续，但建议先处理或记录这些风险后再交付。${report.rootCauseView?.entries?.length ? ' 可优先查看 tts-root-cause 了解症状与主因。' : ''}`
            : `当前配音结果不满足最小交付要求，需要先修复阻断项。${report.rootCauseView?.entries?.length ? ' 可优先查看 tts-root-cause 了解症状与主因。' : ''}`,
      passItems: [
        `对白镜头数：${report.dialogueShotCount}`,
        `预算通过率：${((report.budgetPassRate || 0) * 100).toFixed(1)}%`,
      ],
      warnItems: report.warnings,
      blockItems: report.blockers,
      nextAction:
        report.status === 'pass'
          ? '可以继续进入 lip-sync 或视频合成。'
          : report.status === 'warn'
            ? '优先抽查 voice-cast-report 和 manual-review-sample。'
            : '先修复阻断镜头，再重新运行配音链路。',
      evidenceFiles: [
        '2-metrics/tts-qa.json',
        '2-metrics/tts-root-cause.json',
        '2-metrics/asr-report.json',
        '1-outputs/voice-cast-report.md',
        '1-outputs/manual-review-sample.md',
        '1-outputs/tts-root-cause.md',
      ],
      metrics: {
        dialogueShotCount: report.dialogueShotCount,
        fallbackCount: report.fallbackCount,
        fallbackRate: report.fallbackRate,
        budgetPassRate: report.budgetPassRate,
        rootCauseCount: report.rootCauseView?.entries?.length || 0,
      },
    },
    artifactContext
  );
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
  const voiceResolutionsByShotId = groupVoiceResolutionByShotId(voiceResolution);

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
    const segmentResolutions = voiceResolutionsByShotId.get(shot.id) || [];
    const resolution = summarizeVoiceResolutionForShot(segmentResolutions);
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
      ...(resolution?.segments ? { segments: resolution.segments } : {}),
    });

    asrEntries.push({
      shotId: shot.id,
      expectedText: shot.dialogue || '',
      transcript,
      characterErrorRate: asrCharacterErrorRate,
      status: entryStatus,
    });

    for (const segmentResolution of segmentResolutions.length > 0 ? segmentResolutions : [resolution]) {
      const speakerName = segmentResolution?.speakerName || '';
      const voiceFingerprint = getVoiceFingerprint(segmentResolution);
      if (speakerName && voiceFingerprint) {
        const knownFingerprints = speakerVoiceFingerprints.get(speakerName) || new Set();
        knownFingerprints.add(voiceFingerprint);
        speakerVoiceFingerprints.set(speakerName, knownFingerprints);
      }
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
  report.rootCauseView = buildTtsRootCauseView(report, audioResults, voiceResolution);

  writeArtifacts(report, artifactContext);
  return report;
}

export const __testables = {
  groupVoiceResolutionByShotId,
  summarizeVoiceResolutionForShot,
  calculateCharacterErrorRate,
  normalizeForComparison,
  buildManualReviewPlan,
};
