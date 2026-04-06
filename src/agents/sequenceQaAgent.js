import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { probeVideoMetadata } from '../utils/mediaProbe.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasValidCoverageRange(coveredShotIds = []) {
  const normalizedShotIds = normalizeArray(coveredShotIds).filter(Boolean);
  return normalizedShotIds.length >= 2 && new Set(normalizedShotIds).size === normalizedShotIds.length;
}

function isContiguousInShotOrder(coveredShotIds = [], shots = []) {
  const shotOrder = new Map(normalizeArray(shots).map((shot, index) => [shot?.id, index]));
  const indexes = normalizeArray(coveredShotIds).map((shotId) => shotOrder.get(shotId));

  if (indexes.some((index) => !Number.isFinite(index))) {
    return false;
  }

  const sortedIndexes = [...indexes].sort((left, right) => left - right);
  return sortedIndexes.every((index, position) => position === 0 || index === sortedIndexes[position - 1] + 1);
}

async function probeVideo(videoPath) {
  return probeVideoMetadata(videoPath);
}

function isDurationAcceptable(targetDurationSec, actualDurationSec) {
  if (!Number.isFinite(targetDurationSec) || !Number.isFinite(actualDurationSec) || targetDurationSec <= 0) {
    return false;
  }

  const minDuration = Math.max(0.5, targetDurationSec * 0.7);
  const maxDuration = Math.max(targetDurationSec * 1.5, targetDurationSec + 2);
  return actualDurationSec >= minDuration && actualDurationSec <= maxDuration;
}

function defaultEvaluateSequenceContinuity() {
  return {
    entryExitCheck: 'pass',
    continuityCheck: 'pass',
  };
}

function classifyQaFailureCategory({ finalDecision, decisionReason, engineCheck, durationCheck, entryExitCheck, continuityCheck }) {
  if (finalDecision === 'pass') {
    return 'passed';
  }

  if (finalDecision === 'manual_review') {
    return 'manual_review_needed';
  }

  if (decisionReason === 'invalid_coverage_range') {
    return 'coverage_invalid';
  }

  if (
    decisionReason === 'missing_or_empty_video_file' ||
    decisionReason === 'ffprobe_failed'
  ) {
    return 'provider_output_invalid';
  }

  if (
    decisionReason === 'sequence_unavailable' ||
    String(decisionReason || '').startsWith('provider_')
  ) {
    return 'provider_unavailable';
  }

  if (decisionReason === 'continuity_evaluator_failed') {
    return 'quality_evaluator_error';
  }

  if (decisionReason === 'duration_out_of_range' || durationCheck === 'fail') {
    return 'duration_mismatch';
  }

  if (decisionReason === 'entry_exit_check_failed' || entryExitCheck === 'fail') {
    return 'entry_exit_mismatch';
  }

  if (
    decisionReason === 'continuity_check_failed' ||
    decisionReason === 'non_contiguous_coverage' ||
    continuityCheck === 'fail'
  ) {
    return 'continuity_mismatch';
  }

  if (engineCheck !== 'pass') {
    return 'provider_output_invalid';
  }

  return 'unknown';
}

function determineFinalDecision(engineCheck, durationCheck, entryExitCheck, continuityCheck) {
  if (engineCheck !== 'pass' || durationCheck !== 'pass') {
    return {
      finalDecision: 'fail',
      fallbackAction: 'none',
      decisionReason: engineCheck !== 'pass' ? 'engineering_check_failed' : 'duration_out_of_range',
    };
  }

  if (entryExitCheck === 'fail') {
    return {
      finalDecision: 'fail',
      fallbackAction: 'none',
      decisionReason: 'entry_exit_check_failed',
    };
  }

  if (continuityCheck === 'fail') {
    return {
      finalDecision: 'fallback_to_shot_path',
      fallbackAction: 'fallback_to_shot_path',
      decisionReason: 'continuity_check_failed',
    };
  }

  if (entryExitCheck === 'warn' || continuityCheck === 'warn') {
    return {
      finalDecision: 'manual_review',
      fallbackAction: 'manual_review',
      decisionReason: 'sequence_needs_manual_review',
    };
  }

  return {
    finalDecision: 'pass',
    fallbackAction: 'none',
    decisionReason: null,
  };
}

function formatNotes({
  engineCheck,
  durationCheck,
  entryExitCheck,
  continuityCheck,
  decisionReason,
  referenceContext,
}) {
  const notes = [
    `engine=${engineCheck}`,
    `duration=${durationCheck}`,
    `entryExit=${entryExitCheck}`,
    `continuity=${continuityCheck}`,
  ];

  if (decisionReason) {
    notes.push(`reason=${decisionReason}`);
  }

  const referenceCount = normalizeArray(referenceContext?.videoResults).length + normalizeArray(referenceContext?.bridgeClipResults).length;
  if (referenceCount > 0) {
    notes.push(`references=${referenceCount}`);
  }

  return notes.join('; ');
}

function buildReferenceContext(options) {
  const referenceContext = options.referenceContext || options.context || {};
  const videoResults = normalizeArray(options.videoResults);
  const bridgeClipResults = normalizeArray(options.bridgeClipResults);

  return {
    referenceContext: {
      videoResults,
      bridgeClipResults,
      ...referenceContext,
    },
    videoResults,
    bridgeClipResults,
  };
}

function createEvaluationEntry({
  sequenceId,
  coveredShotIds,
  engineCheck,
  durationCheck,
  entryExitCheck,
  continuityCheck,
  finalDecision,
  fallbackAction,
  decisionReason,
  referenceContext,
}) {
  const qaFailureCategory = classifyQaFailureCategory({
    finalDecision,
    decisionReason,
    engineCheck,
    durationCheck,
    entryExitCheck,
    continuityCheck,
  });

  return {
    sequenceId,
    coveredShotIds,
    engineCheck,
    continuityCheck,
    durationCheck,
    entryExitCheck,
    finalDecision,
    fallbackAction,
    qaFailureCategory,
    notes: formatNotes({
      engineCheck,
      durationCheck,
      entryExitCheck,
      continuityCheck,
      decisionReason,
      referenceContext,
    }),
  };
}

export async function evaluateSequenceClips(sequenceClipResults = [], options = {}) {
  const entries = [];
  const probe = options.probeVideo || probeVideo;
  const evaluateSequenceContinuity =
    options.evaluateSequenceContinuity ||
    options.evaluateContinuity ||
    options.evaluateSequenceRules ||
    options.evaluator ||
    (async () => defaultEvaluateSequenceContinuity());
  const { referenceContext, videoResults, bridgeClipResults } = buildReferenceContext(options);
  const shots = normalizeArray(options.shots);

  for (const result of sequenceClipResults) {
    const coveredShotIds = normalizeArray(result.coveredShotIds);

    if (!hasValidCoverageRange(coveredShotIds)) {
      const engineCheck = 'fail';
      const durationCheck = 'unknown';
      const entryExitCheck = 'unknown';
      const continuityCheck = 'unknown';
      entries.push(
        createEvaluationEntry({
          sequenceId: result.sequenceId,
          coveredShotIds,
          engineCheck,
          continuityCheck,
          durationCheck,
          entryExitCheck,
          ...determineFinalDecision(engineCheck, durationCheck, entryExitCheck, continuityCheck),
          decisionReason: 'invalid_coverage_range',
          referenceContext,
        })
      );
      continue;
    }

    if (result.status !== 'completed' || !result.videoPath) {
      const engineCheck = 'fail';
      const durationCheck = 'unknown';
      const entryExitCheck = 'unknown';
      const continuityCheck = 'unknown';
      const failureReason = result.failureCategory || result.reason || 'sequence_unavailable';

      entries.push(
        createEvaluationEntry({
          sequenceId: result.sequenceId,
          coveredShotIds,
          engineCheck,
          continuityCheck,
          durationCheck,
          entryExitCheck,
          ...determineFinalDecision(engineCheck, durationCheck, entryExitCheck, continuityCheck),
          decisionReason: failureReason,
          referenceContext,
        })
      );
      continue;
    }

    if (!fs.existsSync(result.videoPath) || fs.statSync(result.videoPath).size === 0) {
      const engineCheck = 'fail';
      const durationCheck = 'unknown';
      const entryExitCheck = 'unknown';
      const continuityCheck = 'unknown';
      const failureReason = 'missing_or_empty_video_file';

      entries.push(
        createEvaluationEntry({
          sequenceId: result.sequenceId,
          coveredShotIds,
          engineCheck,
          continuityCheck,
          durationCheck,
          entryExitCheck,
          ...determineFinalDecision(engineCheck, durationCheck, entryExitCheck, continuityCheck),
          decisionReason: failureReason,
          referenceContext,
        })
      );
      continue;
    }

    try {
      const probeResult = await probe(result.videoPath);
      const durationCheck = isDurationAcceptable(result.targetDurationSec, probeResult.durationSec) ? 'pass' : 'fail';
      if (durationCheck !== 'pass') {
        const engineCheck = 'pass';
        const entryExitCheck = 'unknown';
        const continuityCheck = 'unknown';
        entries.push(
          createEvaluationEntry({
            sequenceId: result.sequenceId,
            coveredShotIds,
            engineCheck,
            continuityCheck,
            durationCheck,
            entryExitCheck,
            ...determineFinalDecision(engineCheck, durationCheck, entryExitCheck, continuityCheck),
            decisionReason: 'duration_out_of_range',
            referenceContext,
          })
        );
        continue;
      }

      const engineCheck = 'pass';
      let continuityEvaluation;
      try {
        continuityEvaluation = {
          ...defaultEvaluateSequenceContinuity(),
          ...(await evaluateSequenceContinuity(result, {
            ...options,
            probeResult,
            referenceContext,
          })),
        };
        if (shots.length > 0 && !isContiguousInShotOrder(coveredShotIds, shots)) {
          continuityEvaluation = {
            ...continuityEvaluation,
            continuityCheck: 'fail',
            continuityDecisionReason: 'non_contiguous_coverage',
          };
        }
      } catch (error) {
        entries.push(
          createEvaluationEntry({
            sequenceId: result.sequenceId,
            coveredShotIds,
            engineCheck,
            continuityCheck: 'error',
            durationCheck,
            entryExitCheck: 'error',
            finalDecision: 'fail',
            fallbackAction: 'none',
            decisionReason: 'continuity_evaluator_failed',
            referenceContext,
          })
        );
        continue;
      }

      const decision = determineFinalDecision(
        engineCheck,
        durationCheck,
        continuityEvaluation.entryExitCheck,
        continuityEvaluation.continuityCheck
      );

      entries.push(
        createEvaluationEntry({
          sequenceId: result.sequenceId,
          coveredShotIds,
          engineCheck,
          continuityCheck: continuityEvaluation.continuityCheck,
          durationCheck,
          entryExitCheck: continuityEvaluation.entryExitCheck,
          ...decision,
          decisionReason: continuityEvaluation.continuityDecisionReason || decision.decisionReason,
          referenceContext,
        })
      );
    } catch (error) {
      const engineCheck = 'fail';
      const durationCheck = 'unknown';
      const entryExitCheck = 'unknown';
      const continuityCheck = 'unknown';
      entries.push(
        createEvaluationEntry({
          sequenceId: result.sequenceId,
          coveredShotIds,
          engineCheck,
          continuityCheck,
          durationCheck,
          entryExitCheck,
          ...determineFinalDecision(engineCheck, durationCheck, entryExitCheck, continuityCheck),
          decisionReason: 'ffprobe_failed',
          referenceContext,
        })
      );
    }
  }

  return entries;
}

function buildReport(entries = []) {
  const passedEntries = entries.filter((entry) => entry.finalDecision === 'pass');
  const fallbackEntries = entries.filter((entry) => entry.finalDecision === 'fallback_to_shot_path');
  const manualReviewEntries = entries.filter((entry) => entry.finalDecision === 'manual_review');
  const failEntries = entries.filter((entry) => entry.finalDecision === 'fail');

  return {
    status: failEntries.length > 0 ? 'fail' : fallbackEntries.length > 0 || manualReviewEntries.length > 0 ? 'warn' : 'pass',
    entries,
    passedCount: passedEntries.length,
    fallbackCount: fallbackEntries.length,
    manualReviewCount: manualReviewEntries.length,
    warnings: entries
      .filter((entry) => entry.finalDecision !== 'pass')
      .map((entry) => `${entry.sequenceId}:${entry.fallbackAction !== 'none' ? entry.fallbackAction : entry.finalDecision}`),
    blockers: failEntries.map((entry) => `${entry.sequenceId}:${entry.notes}`),
  };
}

function buildSequenceQaContext(report, actionSequencePackages = []) {
  const packageMap = new Map(
    normalizeArray(actionSequencePackages).map((entry) => [entry?.sequenceId, entry])
  );

  return report.entries.map((entry) => {
    const sequencePackage = packageMap.get(entry.sequenceId) || {};
    return {
      sequenceId: entry.sequenceId,
      finalDecision: entry.finalDecision,
      fallbackAction: entry.fallbackAction,
      qaFailureCategory: entry.qaFailureCategory || null,
      coveredShotIds: normalizeArray(entry.coveredShotIds),
      referenceStrategy: sequencePackage.referenceStrategy || null,
      referenceTier: sequencePackage.providerRequestHints?.referenceTier || null,
      referenceCount: sequencePackage.providerRequestHints?.referenceCount ?? null,
      generationMode: sequencePackage.providerRequestHints?.generationMode || null,
      sequenceContextSummary: sequencePackage.sequenceContextSummary || null,
      notes: entry.notes || null,
    };
  });
}

function writeArtifacts(report, artifactContext, options = {}) {
  if (!artifactContext) {
    return;
  }

  const fallbackEntries = report.entries.filter((entry) => entry.finalDecision === 'fallback_to_shot_path');
  const manualReviewEntries = report.entries.filter((entry) => entry.finalDecision === 'manual_review');
  const contextEntries = buildSequenceQaContext(report, options.actionSequencePackages);

  saveJSON(path.join(artifactContext.outputsDir, 'sequence-qa-report.json'), report);
  saveJSON(path.join(artifactContext.outputsDir, 'sequence-qa-context.json'), contextEntries);
  saveJSON(path.join(artifactContext.outputsDir, 'fallback-sequence-paths.json'), fallbackEntries);
  saveJSON(path.join(artifactContext.outputsDir, 'manual-review-sequences.json'), manualReviewEntries);
  saveJSON(path.join(artifactContext.metricsDir, 'sequence-qa-metrics.json'), {
    passedCount: report.passedCount,
    fallbackCount: report.fallbackCount,
    manualReviewCount: report.manualReviewCount,
    failCount: report.entries.filter((entry) => entry.finalDecision === 'fail').length,
    failureCategoryBreakdown: report.entries.reduce((acc, entry) => {
      const key = entry.qaFailureCategory || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  });
  writeTextFile(
    path.join(artifactContext.outputsDir, 'sequence-qa-report.md'),
    [
      '| Sequence ID | Engine | Continuity | Duration | Entry/Exit | Decision | Category | Fallback | Reference Strategy | Reference Tier | Notes |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...report.entries.map((entry) => {
        const contextEntry = contextEntries.find((item) => item.sequenceId === entry.sequenceId) || {};
        const notes = [contextEntry.sequenceContextSummary, entry.notes || ''].filter(Boolean).join(' || ');
        return `| ${entry.sequenceId} | ${entry.engineCheck} | ${entry.continuityCheck} | ${entry.durationCheck} | ${entry.entryExitCheck} | ${entry.finalDecision} | ${entry.qaFailureCategory || ''} | ${entry.fallbackAction} | ${contextEntry.referenceStrategy || ''} | ${contextEntry.referenceTier || ''} | ${notes} |`;
      }),
      '',
    ].join('\n')
  );
  saveJSON(artifactContext.manifestPath, {
    status: report.status === 'pass' ? 'completed' : 'completed_with_errors',
    passedCount: report.passedCount,
    fallbackCount: report.fallbackCount,
    manualReviewCount: report.manualReviewCount,
    failCount: report.entries.filter((entry) => entry.finalDecision === 'fail').length,
    outputFiles: [
      'sequence-qa-report.json',
      'sequence-qa-context.json',
      'fallback-sequence-paths.json',
      'manual-review-sequences.json',
      'sequence-qa-metrics.json',
      'sequence-qa-report.md',
    ],
  });
  writeAgentQaSummary(
    {
      agentKey: 'sequenceQaAgent',
      agentName: 'Sequence QA Agent',
      status: report.status,
      headline:
        report.status === 'pass'
          ? `所有 ${report.passedCount} 个 sequence clip 通过工程与连续性验收`
          : report.manualReviewCount > 0 && report.fallbackCount > 0
            ? `${report.fallbackCount} 个 sequence clip 回退到 shot path，${report.manualReviewCount} 个需人工复核`
            : report.fallbackCount > 0
            ? `${report.fallbackCount} 个 sequence clip 回退到 shot path`
            : report.manualReviewCount > 0
              ? `${report.manualReviewCount} 个 sequence clip 需人工复核`
              : `${report.entries.filter((entry) => entry.finalDecision === 'fail').length} 个 sequence clip 未通过验收`,
      summary:
        report.status === 'pass'
          ? 'sequence clip 可直接覆盖对应 shot。'
          : report.manualReviewCount > 0 && report.fallbackCount > 0
            ? '部分 sequence clip 需要回退到 shot path，另有部分需要人工复核。'
            : report.fallbackCount > 0
              ? '部分 sequence clip 需要回退到 shot path。'
              : report.manualReviewCount > 0
                ? '部分 sequence clip 需要人工复核。'
                : '部分 sequence clip 未通过验收。',
      passItems: [`通过 sequence clip 数：${report.passedCount}`],
      warnItems: report.warnings,
      blockItems: report.blockers,
      nextAction:
        report.status === 'pass'
          ? '将通过 QA 的 sequence clip 写入主 timeline。'
          : report.manualReviewCount > 0 && report.fallbackCount > 0
            ? '将 finalDecision === pass 的 sequence clip 写入主 timeline；fallback_to_shot_path 的片段回退到 shot path；manual_review 的片段先人工复核。'
            : report.fallbackCount > 0
              ? '将 finalDecision === pass 的 sequence clip 写入主 timeline；fallback_to_shot_path 的片段回退到 shot path。'
              : report.manualReviewCount > 0
                ? '将 finalDecision === pass 的 sequence clip 写入主 timeline；manual_review 的片段先人工复核。'
                : '仅将 finalDecision === pass 的 sequence clip 写入主 timeline。',
      evidenceFiles: ['1-outputs/sequence-qa-report.json', '2-metrics/sequence-qa-metrics.json'],
      metrics: {
        passedCount: report.passedCount,
        fallbackCount: report.fallbackCount,
        manualReviewCount: report.manualReviewCount,
        failCount: report.entries.filter((entry) => entry.finalDecision === 'fail').length,
      },
    },
    artifactContext
  );
}

export async function runSequenceQa(sequenceClipResults = [], options = {}) {
  const entries = await evaluateSequenceClips(sequenceClipResults, options);
  const report = buildReport(entries);
  writeArtifacts(report, options.artifactContext, {
    actionSequencePackages: options.actionSequencePackages,
  });
  return report;
}

export const __testables = {
  buildReport,
  buildSequenceQaContext,
  classifyQaFailureCategory,
  determineFinalDecision,
  evaluateSequenceClips,
  hasValidCoverageRange,
  isContiguousInShotOrder,
  isDurationAcceptable,
  probeVideo,
};

export default {
  runSequenceQa,
};
