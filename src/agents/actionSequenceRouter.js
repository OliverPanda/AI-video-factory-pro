import path from 'node:path';

import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import { createActionSequencePackage } from '../utils/actionSequenceProtocol.js';

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(normalizeArray(values).map((value) => String(value || '').trim()).filter(Boolean))];
}

function buildShotCandidateBuckets(items = []) {
  const buckets = new Map();
  normalizeArray(items).forEach((entry, index) => {
    if (!entry?.shotId) {
      return;
    }
    const bucket = buckets.get(entry.shotId) || [];
    bucket.push({ entry, index });
    buckets.set(entry.shotId, bucket);
  });
  return buckets;
}

function scoreVideoCandidate(result = {}) {
  if (!result?.videoPath) {
    return -Infinity;
  }

  let score = 1;
  if (result.canUseVideo === true) {
    score += 300;
  }
  if (result.qaStatus === 'pass' || result.qaStatus === 'passed') {
    score += 250;
  }
  if (result.finalDecision === 'pass' || result.finalDecision === 'pass_with_enhancement') {
    score += 200;
  }
  if (result.status === 'completed') {
    score += 100;
  }
  return score;
}

function scoreImageCandidate(result = {}) {
  if (!result?.imagePath) {
    return -Infinity;
  }

  let score = 1;
  if (result.success === true) {
    score += 200;
  }
  if (result.status === 'completed' || result.status === 'ready') {
    score += 100;
  }
  return score;
}

function isBridgeApprovedResult(result = {}) {
  if (!result || typeof result !== 'object' || !result.videoPath) {
    return false;
  }

  if (result.canUseBridge === true) {
    return true;
  }
  if (result.qaStatus === 'pass' || result.qaStatus === 'passed') {
    return true;
  }
  if (result.finalDecision === 'pass' || result.finalDecision === 'pass_with_enhancement') {
    return true;
  }
  return false;
}

function scoreBridgeCandidate(result = {}) {
  if (!isBridgeApprovedResult(result)) {
    return -Infinity;
  }

  let score = 1;
  if (result.finalDecision === 'pass') {
    score += 200;
  }
  if (result.finalDecision === 'pass_with_enhancement') {
    score += 150;
  }
  if (result.qaStatus === 'pass' || result.qaStatus === 'passed') {
    score += 100;
  }
  return score;
}

function pickBestCandidate(candidates = [], scoreFn) {
  let bestCandidate = null;
  let bestScore = -Infinity;
  let bestIndex = Infinity;

  for (const candidate of normalizeArray(candidates)) {
    const score = scoreFn(candidate.entry);
    if (
      score > bestScore ||
      (score === bestScore && candidate.index < bestIndex)
    ) {
      bestCandidate = candidate.entry;
      bestScore = score;
      bestIndex = candidate.index;
    }
  }

  return bestCandidate;
}

function hasFullSequenceCoverage(planEntry = {}, bridgeResult = {}) {
  const sequenceShotIds = normalizeArray(planEntry.shotIds);
  const coveredShotIds = new Set(normalizeArray(bridgeResult.coveredShotIds));
  return sequenceShotIds.length > 0 && sequenceShotIds.every((shotId) => coveredShotIds.has(shotId));
}

function buildContinuitySpec(planEntry = {}) {
  const motionTargets = uniqueStrings(planEntry.motionContinuityTargets).join(', ') || 'motion_continuity';
  const subjectTargets = uniqueStrings(planEntry.subjectContinuityTargets).join(', ') || 'subject_continuity';
  const environmentTargets = uniqueStrings(planEntry.environmentContinuityTargets).join(', ') || 'environment_continuity';
  const preserveElements = uniqueStrings(planEntry.mustPreserveElements).join(', ') || 'subject_identity';

  return [
    `motion: ${motionTargets}`,
    `subject: ${subjectTargets}`,
    `environment: ${environmentTargets}`,
    `preserve: ${preserveElements}`,
  ].join(' | ');
}

function buildReferenceImages(sequenceShotIds = [], imageResults = []) {
  const imageBuckets = buildShotCandidateBuckets(imageResults);
  return sequenceShotIds
    .map((shotId) => pickBestCandidate(imageBuckets.get(shotId) || [], scoreImageCandidate) || null)
    .filter((result) => result?.imagePath)
    .map((result) => ({
      type: 'reference_image',
      shotId: result.shotId,
      path: result.imagePath,
      provider: result.provider || null,
      status: result.status || null,
    }));
}

function buildReferenceVideos(sequenceShotIds = [], videoResults = []) {
  const videoBuckets = buildShotCandidateBuckets(videoResults);
  return sequenceShotIds
    .map((shotId) => pickBestCandidate(videoBuckets.get(shotId) || [], scoreVideoCandidate) || null)
    .filter((result) => result?.videoPath && (result.canUseVideo === true || result.qaStatus === 'pass' || result.qaStatus === 'passed' || result.finalDecision === 'pass' || result.finalDecision === 'pass_with_enhancement'))
    .map((result) => ({
      type: 'qa_passed_video',
      shotId: result.shotId,
      path: result.videoPath,
      provider: result.provider || null,
      qaDecision: result.finalDecision || result.qaStatus || result.status || null,
    }));
}

function buildBridgeReferences(planEntry = {}, bridgeClipResults = []) {
  return normalizeArray(bridgeClipResults)
    .filter((result) => isBridgeApprovedResult(result))
    .filter((result) => hasFullSequenceCoverage(planEntry, result))
    .map((result) => ({
      type: 'qa_passed_bridge_clip',
      sequenceId: result.sequenceId || planEntry.sequenceId,
      bridgeId: result.bridgeId || null,
      shotIds: normalizeArray(result.coveredShotIds),
      path: result.videoPath,
      provider: result.provider || null,
      qaDecision: result.finalDecision || result.qaStatus || result.status || null,
    }))
    .filter((entry) => Boolean(entry.path));
}

function buildAudioBeatHints(sequenceShotIds = [], performancePlan = []) {
  const performanceIndex = buildShotCandidateBuckets(performancePlan);
  const hints = [];

  for (const shotId of normalizeArray(sequenceShotIds)) {
    const entry = pickBestCandidate(performanceIndex.get(shotId) || [], () => 0);
    if (!entry) {
      continue;
    }
    for (const hint of normalizeArray(entry.audioBeatHints)) {
      if (hint) {
        hints.push(String(hint));
      }
    }
  }

  return uniqueStrings(hints);
}

function selectReferenceTier(referenceVideos, bridgeReferences, referenceImages) {
  if (referenceVideos.length > 0) {
    return 'video';
  }
  if (bridgeReferences.length > 0) {
    return 'bridge';
  }
  if (referenceImages.length > 0) {
    return 'image';
  }
  return 'skip';
}

function buildFallbackProviders(referenceTier) {
  if (referenceTier === 'video') {
    return ['bridge_clip', 'image'];
  }
  if (referenceTier === 'bridge') {
    return ['image'];
  }
  return [];
}

function buildQaRules(referenceTier) {
  const rules = [
    'prefer_qa_passed_video_then_bridge_then_image',
    'do_not_emit_invalid_provider_request',
    'skip_when_no_valid_reference_material',
  ];

  if (referenceTier !== 'skip') {
    rules.push(`reference_tier:${referenceTier}`);
  }

  return rules;
}

function buildReferenceStrategy(referenceTier) {
  if (referenceTier === 'video') {
    return 'video_first';
  }
  if (referenceTier === 'bridge') {
    return 'bridge_first';
  }
  if (referenceTier === 'image') {
    return 'image_first';
  }
  return 'skip_generation';
}

function buildSequenceContextSummary(planEntry = {}, sequenceShotIds = [], referenceTier = 'skip', audioBeatHints = []) {
  const summaryParts = [
    `sequence type: ${planEntry.sequenceType || 'unknown_sequence'}`,
    `shot coverage: ${normalizeArray(sequenceShotIds).join(' -> ') || 'none'}`,
    `camera flow: ${planEntry.cameraFlowIntent || 'unspecified'}`,
    `reference tier: ${referenceTier}`,
  ];

  const continuityTargets = [
    ...uniqueStrings(planEntry.motionContinuityTargets),
    ...uniqueStrings(planEntry.subjectContinuityTargets),
    ...uniqueStrings(planEntry.environmentContinuityTargets),
  ];
  if (continuityTargets.length > 0) {
    summaryParts.push(`continuity targets: ${continuityTargets.join(', ')}`);
  }
  if (planEntry.entryConstraint) {
    summaryParts.push(`entry: ${planEntry.entryConstraint}`);
  }
  if (planEntry.exitConstraint) {
    summaryParts.push(`exit: ${planEntry.exitConstraint}`);
  }
  if (audioBeatHints.length > 0) {
    summaryParts.push(`audio beat hints: ${audioBeatHints.join(', ')}`);
  }

  return summaryParts.join(' | ');
}

function buildProviderRequestHints(planEntry = {}, referenceTier = 'skip', referenceCount = 0, audioBeatHints = []) {
  return {
    sequenceType: planEntry.sequenceType || null,
    generationMode: planEntry.generationMode || null,
    referenceTier,
    referenceCount,
    hasAudioBeatHints: audioBeatHints.length > 0,
    audioBeatHints,
    durationTargetSec: Number.isFinite(Number(planEntry.durationTargetSec)) ? Number(planEntry.durationTargetSec) : null,
    preferredProvider: planEntry.preferredProvider || 'seedance',
    fallbackStrategy: planEntry.fallbackStrategy || null,
  };
}

function buildActionSequencePackage(planEntry = {}, options = {}) {
  const sequenceShotIds = normalizeArray(planEntry.shotIds);
  const durationTargetSec = Number(planEntry.durationTargetSec);
  const referenceVideos = buildReferenceVideos(sequenceShotIds, options.videoResults);
  const bridgeReferences = buildBridgeReferences(planEntry, options.bridgeClipResults);
  const referenceImages = buildReferenceImages(sequenceShotIds, options.imageResults);
  const referenceTier = selectReferenceTier(referenceVideos, bridgeReferences, referenceImages);
  const audioBeatHints = buildAudioBeatHints(sequenceShotIds, options.performancePlan);
  const selectedReferenceCount =
    referenceTier === 'video'
      ? referenceVideos.length
      : referenceTier === 'bridge'
        ? bridgeReferences.length
        : referenceTier === 'image'
          ? referenceImages.length
          : 0;

  return createActionSequencePackage({
    sequenceId: planEntry.sequenceId,
    shotIds: sequenceShotIds,
    durationTargetSec: Number.isFinite(durationTargetSec) ? durationTargetSec : 0,
    referenceImages: referenceTier === 'image' ? referenceImages : [],
    referenceVideos: referenceTier === 'video' ? referenceVideos : [],
    bridgeReferences: referenceTier === 'bridge' ? bridgeReferences : [],
    referenceStrategy: buildReferenceStrategy(referenceTier),
    visualGoal: planEntry.sequenceGoal || '',
    cameraSpec: planEntry.cameraFlowIntent || '',
    continuitySpec: buildContinuitySpec(planEntry),
    sequenceContextSummary: buildSequenceContextSummary(planEntry, sequenceShotIds, referenceTier, audioBeatHints),
    entryFrameHint: planEntry.entryConstraint || '',
    exitFrameHint: planEntry.exitConstraint || '',
    audioBeatHints,
    preferredProvider: referenceTier === 'skip' ? 'skip' : planEntry.preferredProvider || 'seedance',
    fallbackProviders: buildFallbackProviders(referenceTier),
    providerRequestHints: buildProviderRequestHints(planEntry, referenceTier, selectedReferenceCount, audioBeatHints),
    qaRules: buildQaRules(referenceTier),
  });
}

function buildActionSequencePackages(actionSequencePlan = [], options = {}) {
  return normalizeArray(actionSequencePlan).map((planEntry) => buildActionSequencePackage(planEntry, options));
}

function buildMetrics(actionSequencePackages = []) {
  return {
    plannedSequenceCount: actionSequencePackages.length,
    referenceTierBreakdown: actionSequencePackages.reduce((acc, entry) => {
      const tier = entry.preferredProvider === 'skip'
        ? 'skip'
        : entry.referenceVideos.length > 0
          ? 'video'
          : entry.bridgeReferences.length > 0
            ? 'bridge'
            : 'image';
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {}),
    skippedCount: actionSequencePackages.filter((entry) => entry.preferredProvider === 'skip').length,
  };
}

function writeArtifacts(actionSequencePackages, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = buildMetrics(actionSequencePackages);
  saveJSON(path.join(artifactContext.outputsDir, 'action-sequence-packages.json'), actionSequencePackages);
  saveJSON(path.join(artifactContext.metricsDir, 'action-sequence-routing-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: metrics.skippedCount > 0 ? 'completed_with_warnings' : 'completed',
    plannedSequenceCount: actionSequencePackages.length,
    skippedCount: metrics.skippedCount,
    outputFiles: ['action-sequence-packages.json', 'action-sequence-routing-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'actionSequenceRouter',
      agentName: 'Action Sequence Router',
      status: metrics.skippedCount > 0 ? 'warn' : 'pass',
      headline:
        metrics.skippedCount > 0
          ? `已路由 ${actionSequencePackages.length} 个 action sequence，其中 ${metrics.skippedCount} 个需要 skip`
          : `已完成 ${actionSequencePackages.length} 个 action sequence 路由`,
      summary:
        metrics.skippedCount > 0
          ? '当前会优先采用通过 QA 的 videoResults，其次 bridgeClipResults，最后才回退到 imageResults；缺少关键参考时会直接 skip。'
          : '当前已按参考优先级生成 action sequence package，并避免发出无效 provider request。',
      passItems: [`路由序列数：${actionSequencePackages.length}`],
      warnItems:
        metrics.skippedCount > 0
          ? actionSequencePackages
              .filter((entry) => entry.preferredProvider === 'skip')
              .map((entry) => `${entry.sequenceId}:skip`)
          : [],
      nextAction: '可以继续进入 sequence clip generation。',
      evidenceFiles: ['1-outputs/action-sequence-packages.json', '2-metrics/action-sequence-routing-metrics.json'],
      metrics,
    },
    artifactContext
  );
}

export async function routeActionSequencePackages(actionSequencePlan = [], options = {}) {
  const actionSequencePackages = buildActionSequencePackages(actionSequencePlan, options);
  writeArtifacts(actionSequencePackages, options.artifactContext);
  return actionSequencePackages;
}

export const __testables = {
  buildActionSequencePackage,
  buildActionSequencePackages,
  buildAudioBeatHints,
  buildBridgeReferences,
  buildContinuitySpec,
  buildFallbackProviders,
  buildProviderRequestHints,
  buildReferenceImages,
  buildReferenceStrategy,
  buildReferenceVideos,
  buildSequenceContextSummary,
  hasFullSequenceCoverage,
  isBridgeApprovedResult,
  selectReferenceTier,
  scoreImageCandidate,
  scoreVideoCandidate,
};

export default {
  routeActionSequencePackages,
};
