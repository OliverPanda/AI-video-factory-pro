import fs from 'node:fs';
import path from 'node:path';

import { classifyArtifactReadiness, linkSymptomToUpstreamRootCause } from './rootCauseClassifier.js';
import { evaluateQualityGate } from '../policy/qualityGatePolicy.js';

export const HARD_VISUAL_BLOCK_REASON_CODES = new Set([
  'anatomy_structure_invalid',
  'anatomy_pose_invalid',
  'limb_structure_invalid',
  'character_identity_corrupted',
  'reference_sheet_background_invalid',
]);

export function normalizeStringList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function classifyImageFailure(result = {}) {
  return classifyArtifactReadiness(result, {
    successField: 'success',
    pathField: 'imagePath',
    timeoutCode: 'image_generation_timeout',
    timeoutLabel: '图像生成超时',
    failureCode: 'image_generation_failed',
    failureLabel: '图像生成失败',
    missingCode: 'image_result_missing',
    missingLabel: '关键帧结果缺失',
    missingReasonCode: 'missing_keyframe_image',
    timeoutReasonCode: 'image_generation_timeout',
    failureReasonCode: 'image_generation_failed',
    missingEvidenceWithoutPath: 'missing_image_result',
    missingEvidenceWithPath: 'missing_success_flag',
  });
}

export function buildVisualEligibilityReport(shots = [], imageResults = []) {
  const imageResultByShotId = new Map(
    (Array.isArray(imageResults) ? imageResults : [])
      .filter((entry) => entry?.shotId)
      .map((entry) => [entry.shotId, entry])
  );

  const entries = (Array.isArray(shots) ? shots : []).map((shot) => {
    const result = imageResultByShotId.get(shot?.id) || null;
    const failure = classifyImageFailure(result || {});
    const decision = failure.isReady ? 'pass' : 'block';
    return {
      shotId: shot?.id || null,
      decision,
      visualEligible: failure.isReady,
      rootCauseCode: failure.rootCauseCode,
      rootCauseLabel: failure.rootCauseLabel,
      reasons: failure.reasons,
      summary: failure.isReady
        ? '关键帧已就绪，可继续进入视频前链路。'
        : `缺少可用于生视频的关键帧，根因：${failure.rootCauseLabel}。`,
      evidence: {
        success: result?.success ?? null,
        imagePath: result?.imagePath || null,
        error: result?.error || result?.reason || null,
        recoveredFromDisk: result?.recoveredFromDisk === true,
        evidenceSummary: failure.evidenceSummary,
      },
    };
  });

  const blockEntries = entries.filter((entry) => entry.decision === 'block');
  return {
    passCount: entries.length - blockEntries.length,
    blockCount: blockEntries.length,
    blockedShotIds: blockEntries.map((entry) => entry.shotId).filter(Boolean),
    entries,
  };
}

export function buildVisualEligibilityTopIssues(visualEligibilityReport = null) {
  return (Array.isArray(visualEligibilityReport?.entries) ? visualEligibilityReport.entries : [])
    .filter((entry) => entry?.decision === 'block')
    .slice(0, 3)
    .map((entry) => {
      const evidence = String(entry?.evidence?.error || entry?.evidence?.evidenceSummary || '').trim();
      return `Visual Eligibility: ${entry.shotId || 'unknown_shot'} block - 缺少关键帧，根因是${entry.rootCauseLabel || '上游图像失败'}${evidence ? `（${evidence}）` : ''}。`;
    });
}

export function buildUpstreamFailureInsights(visualEligibilityReport = null, preflightQaReport = null) {
  const visualBlockedEntries = (Array.isArray(visualEligibilityReport?.entries) ? visualEligibilityReport.entries : [])
    .filter((entry) => entry?.decision === 'block' && entry?.shotId);
  const preflightEntries = Array.isArray(preflightQaReport?.entries) ? preflightQaReport.entries : [];

  return linkSymptomToUpstreamRootCause({
    upstreamEntries: visualBlockedEntries,
    downstreamEntries: preflightEntries,
    symptomCode: 'missing_reference_stack',
    shouldIncludeDownstreamEntry: (entry) => entry?.decision === 'block',
    buildLink: (entry, visualBlock) => ({
      shotId: entry.shotId,
      symptomCode: 'missing_reference_stack',
      symptomLabel: '参考栈缺失',
      rootCauseCode: visualBlock.rootCauseCode,
      rootCauseLabel: visualBlock.rootCauseLabel,
      rootCauseConfidence: 'upstream_primary_candidate',
      conclusion: `该镜头同时存在 missing_reference_stack 与上游${visualBlock.rootCauseLabel}；当前更应优先排查上游关键帧缺失问题。`,
    }),
    learnedPattern:
      '当镜头缺少关键帧且 preflight 报 missing_reference_stack 时，优先排查上游图像失败；参考栈缺失仍可能是并发问题，不应被直接排除。',
  });
}

export function buildUpstreamFailureTopIssues(upstreamFailureInsights = null) {
  return (Array.isArray(upstreamFailureInsights?.entries) ? upstreamFailureInsights.entries : [])
    .slice(0, 2)
    .map((entry) => `Case Memory: ${entry.shotId || 'unknown_shot'} 同时出现 ${entry.symptomCode} 与${entry.rootCauseLabel}，应优先排查上游关键帧失败。`);
}

export function collectHardVisualBlockEntries(entries = [], reasonField = 'reasons') {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const reasons = reasonField === 'reasons'
      ? normalizeStringList(entry?.reasons)
      : normalizeStringList([entry?.reason, entry?.decisionReason]);
    const matchedReasons = reasons.filter((reason) => HARD_VISUAL_BLOCK_REASON_CODES.has(reason));
    if (matchedReasons.length === 0) {
      return [];
    }
    return [
      {
        shotId: entry?.shotId || 'unknown_shot',
        reasons: matchedReasons,
      },
    ];
  });
}

export function assertNoHardVisualBlocks(stageLabel, entries = [], reasonField = 'reasons') {
  const hardBlockEntries = collectHardVisualBlockEntries(entries, reasonField);
  if (hardBlockEntries.length === 0) {
    return;
  }

  const detail = hardBlockEntries
    .map((entry) => `${entry.shotId}(${entry.reasons.join(',')})`)
    .join('；');
  throw new Error(`${stageLabel} 发现人体结构/参考图硬伤，已阻断后续链路：${detail}`);
}

export function buildExecutionGate({
  visualEligibilityReport = null,
  preflightQaReport = null,
  shotPackages = [],
  stoppedBeforeStage = 'generate_video_clips',
} = {}) {
  return evaluateQualityGate({
    visualEligibilityReport,
    preflightQaReport,
    shotPackages,
    stoppedBeforeStage,
  }).executionGate;
}

export function buildExecutionGateTopIssues(executionGate = null) {
  if (executionGate?.status !== 'blocked') {
    return [];
  }
  return [
    `Execution Gate: ${executionGate.message || executionGate.reason || '上游阻断，后续阶段未执行。'}`,
  ];
}

export function buildPreflightTopIssues(preflightQaReport = null) {
  return (Array.isArray(preflightQaReport?.entries) ? preflightQaReport.entries : [])
    .filter((entry) => entry?.decision === 'block' || entry?.decision === 'warn')
    .slice(0, 3)
    .map((entry) => {
      const detail = Array.isArray(entry?.reasonDetails) && entry.reasonDetails.length > 0
        ? entry.reasonDetails.map((item) => `${item.label}，建议：${item.suggestion}`).join('；')
        : (Array.isArray(entry?.reasons) && entry.reasons.length > 0 ? entry.reasons.join(', ') : 'unspecified');
      return `Preflight QA Agent: ${entry.shotId || 'unknown_shot'} ${entry.decision} - ${detail}`;
    });
}

export function buildSeedanceInferenceTopIssues(seedancePromptMetrics = null) {
  if (!seedancePromptMetrics) {
    return [];
  }

  const issues = [];
  if (seedancePromptMetrics.inferredCoverageCount > 0) {
    issues.push(`Seedance Prompt Agent: 有 ${seedancePromptMetrics.inferredCoverageCount} 个镜头的 coverage 依赖系统兜底推断。`);
  }
  if (seedancePromptMetrics.inferredBlockingCount > 0) {
    issues.push(`Seedance Prompt Agent: 有 ${seedancePromptMetrics.inferredBlockingCount} 个镜头的 blocking 依赖系统兜底推断。`);
  }
  if (seedancePromptMetrics.inferredContinuityCount > 0) {
    issues.push(`Seedance Prompt Agent: 有 ${seedancePromptMetrics.inferredContinuityCount} 个镜头的 continuity locks 依赖系统兜底推断。`);
  }
  return issues.slice(0, 2);
}

export function isSeedanceInferenceOverThreshold(seedancePromptMetrics = null) {
  if (!seedancePromptMetrics || !Number.isFinite(seedancePromptMetrics.promptPackageCount) || seedancePromptMetrics.promptPackageCount <= 0) {
    return false;
  }

  const inferredShotCount = Math.max(
    Number(seedancePromptMetrics.inferredCoverageCount || 0),
    Number(seedancePromptMetrics.inferredBlockingCount || 0),
    Number(seedancePromptMetrics.inferredContinuityCount || 0)
  );
  const threshold = Math.max(1, Math.ceil(Number(seedancePromptMetrics.promptPackageCount) * 0.5));
  return inferredShotCount >= threshold;
}

export function shouldBlockFormalDeliveryForSeedanceInference(pipelineSummary = {}) {
  return pipelineSummary?.seedance_inference_delivery_gate === 'block_formal_delivery';
}

export function normalizeRunDebugText(value) {
  return String(value || '').trim();
}

export function buildRunDebugSignals({ runJob = null, stateSnapshot = null, agentSummaries = [] } = {}) {
  const agentTaskRuns = Array.isArray(runJob?.agentTaskRuns) ? runJob.agentTaskRuns : [];
  const stepCounts = new Map();

  for (const taskRun of agentTaskRuns) {
    const step = String(taskRun?.step || '').trim();
    if (!step) {
      continue;
    }
    stepCounts.set(step, (stepCounts.get(step) || 0) + 1);
  }

  const cachedSteps = agentTaskRuns.filter((item) => item?.status === 'cached').map((item) => item.step);
  const skippedSteps = agentTaskRuns.filter((item) => item?.status === 'skipped').map((item) => item.step);
  const failedSteps = agentTaskRuns.filter((item) => item?.status === 'failed').map((item) => item.step);
  const manualReviewSteps = agentTaskRuns.filter((item) => item?.status === 'manual_review').map((item) => item.step);
  const retriedSteps = [...stepCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([step]) => step);
  const failedAgentSummaries = Array.isArray(agentSummaries)
    ? agentSummaries.filter((item) => item?.status === 'block').map((item) => item.agentName || item.agentKey || 'unknown')
    : [];
  const manualReviewAgentSummaries = Array.isArray(agentSummaries)
    ? agentSummaries.filter((item) => {
        if (item?.status !== 'warn') {
          return false;
        }
        const nextActions = Array.isArray(item?.nextActions) ? item.nextActions : [];
        const warningText = `${item.headline || ''} ${item.summary || ''} ${nextActions.join(' ')}`;
        return /人工复核|manual review/i.test(warningText) || Number(item?.metrics?.manualReviewCount || 0) > 0;
      }).map((item) => item.agentName || item.agentKey || 'unknown')
    : [];

  const stopStage =
    normalizeRunDebugText(stateSnapshot?.executionGate?.stoppedBeforeStage) ||
    failedSteps[0] ||
    failedAgentSummaries[0] ||
    (stateSnapshot?.stoppedBeforeVideoAt ? 'stop_before_video' : '') ||
    '';
  const stopReason =
    normalizeRunDebugText(stateSnapshot?.executionGate?.message) ||
    normalizeRunDebugText(stateSnapshot?.executionGate?.reason) ||
    normalizeRunDebugText(stateSnapshot?.lastError) ||
    normalizeRunDebugText(runJob?.error) ||
    (stateSnapshot?.stoppedBeforeVideoAt ? 'stopped_before_video' : '') ||
    (stateSnapshot?.pipelineSummary?.seedance_inference_delivery_gate === 'block_formal_delivery'
      ? 'seedance_inference_gate'
      : '') ||
    '';

  return {
    status:
      normalizeRunDebugText(stateSnapshot?.executionGate?.status) ||
      normalizeRunDebugText(runJob?.status) ||
      (normalizeRunDebugText(stateSnapshot?.lastError) ? 'failed' : normalizeRunDebugText(stateSnapshot?.completedAt) ? 'completed' : 'running'),
    stopStage,
    stopReason,
    whereFailed: stopStage,
    lastError: normalizeRunDebugText(stateSnapshot?.lastError) || normalizeRunDebugText(runJob?.error) || '',
    completedAt: normalizeRunDebugText(stateSnapshot?.completedAt) || normalizeRunDebugText(runJob?.finishedAt) || '',
    failedAt: normalizeRunDebugText(stateSnapshot?.failedAt) || '',
    stoppedBeforeVideoAt: normalizeRunDebugText(stateSnapshot?.stoppedBeforeVideoAt) || '',
    previewOutputPath: normalizeRunDebugText(stateSnapshot?.previewOutputPath) || '',
    cachedSteps,
    skippedSteps,
    retriedSteps,
    manualReviewSteps: [...new Set([...manualReviewSteps, ...manualReviewAgentSummaries])],
    failedSteps: [...new Set([...failedSteps, ...failedAgentSummaries])],
    visualBlockedShotIds: Array.isArray(stateSnapshot?.visualEligibilityReport?.blockedShotIds)
      ? stateSnapshot.visualEligibilityReport.blockedShotIds
      : [],
    upstreamFailureShotIds: Array.isArray(stateSnapshot?.upstreamFailureInsights?.matchedShotIds)
      ? stateSnapshot.upstreamFailureInsights.matchedShotIds
      : [],
    executionGate: stateSnapshot?.executionGate || null,
    caseMemoryFindings: [
      normalizeRunDebugText(stateSnapshot?.upstreamFailureInsights?.learnedPattern),
    ].filter(Boolean),
    retriedCount: retriedSteps.length,
  };
}

function mapManifestStatusToQaStatus(status) {
  if (status === 'failed') return 'block';
  if (status === 'completed_with_errors') return 'warn';
  if (status === 'completed') return 'pass';
  return 'pending';
}

export function readJSONSafe(loadJSONFn, filePath, fallback) {
  try {
    const loaded = loadJSONFn(filePath);
    if (loaded !== null && loaded !== undefined) {
      return loaded;
    }
  } catch {
    // fall through to direct file read
  }

  try {
    if (filePath && fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch {
    // ignore
  }

  return fallback;
}

export function collectRunQaOverview(loadJSONFn, artifactContext, options = {}) {
  if (!artifactContext?.agents) {
    return null;
  }

  const runManifest = readJSONSafe(loadJSONFn, artifactContext.manifestPath, null);
  const stateSnapshot = artifactContext.runDir
    ? readJSONSafe(loadJSONFn, path.join(artifactContext.runDir, 'state.snapshot.json'), null)
    : null;
  const runJob = runManifest?.runJobId
    && artifactContext.episodeDir
    ? readJSONSafe(
        loadJSONFn,
        path.join(artifactContext.episodeDir, 'run-jobs', `${runManifest.runJobId}.json`),
        null
      )
    : null;

  const agentNameMap = {
    scriptParser: 'Script Parser',
    characterRegistry: 'Character Registry',
    characterRefSheetGenerator: 'Character Reference Sheet Generator',
    characterAssetGovernance: 'Character Asset Governance',
    promptEngineer: 'Prompt Engineer',
    imageGenerator: 'Image Generator',
    consistencyChecker: 'Consistency Checker',
    continuityChecker: 'Continuity Checker',
    ttsAgent: 'TTS Agent',
    ttsQaAgent: 'TTS QA Agent',
    lipsyncAgent: 'Lip-sync Agent',
    motionPlanner: 'Motion Planner',
    performancePlanner: 'Performance Planner',
    videoRouter: 'Video Router',
    videoGenerationAgent: 'Video Generation Agent',
    sora2VideoAgent: 'Fallback Video Adapter',
    fallbackVideoAgent: 'Fallback Video Adapter',
    seedanceVideoAgent: 'Seedance Video Agent',
    motionEnhancer: 'Motion Enhancer',
    shotQaAgent: 'Shot QA Agent',
    bridgeShotPlanner: 'Bridge Shot Planner',
    bridgeShotRouter: 'Bridge Shot Router',
    bridgeClipGenerator: 'Bridge Clip Generator',
    bridgeQaAgent: 'Bridge QA Agent',
    actionSequencePlanner: 'Action Sequence Planner',
    actionSequenceRouter: 'Action Sequence Router',
    sequenceClipGenerator: 'Sequence Clip Generator',
    sequenceQaAgent: 'Sequence QA Agent',
    storyboardContextAgent: 'Storyboard Context Memory',
    crossVideoConsistencyChecker: 'Cross Video Consistency Checker',
    crossVideoConsistencyAgent: 'Cross Video Consistency Checker',
    avPackagingAgent: 'AV Packaging Agent',
    videoComposer: 'Video Composer',
    postComposeReviewAgent: 'Post Compose Review Agent',
    costGovernance: 'Cost Governance',
    humanReviewQueue: 'Human Review Queue',
  };

  const orderedKeys = [
    'scriptParser',
    'characterRegistry',
    'characterRefSheetGenerator',
    'characterAssetGovernance',
    'promptEngineer',
    'imageGenerator',
    'consistencyChecker',
    'continuityChecker',
    'ttsAgent',
    'ttsQaAgent',
    'lipsyncAgent',
    'motionPlanner',
    'performancePlanner',
    'videoRouter',
    'videoGenerationAgent',
    'sora2VideoAgent',
    'fallbackVideoAgent',
    'seedanceVideoAgent',
    'motionEnhancer',
    'shotQaAgent',
    'bridgeShotPlanner',
    'bridgeShotRouter',
    'bridgeClipGenerator',
    'bridgeQaAgent',
    'actionSequencePlanner',
    'actionSequenceRouter',
    'sequenceClipGenerator',
    'sequenceQaAgent',
    'storyboardContextAgent',
    'crossVideoConsistencyChecker',
    'avPackagingAgent',
    'videoComposer',
    'postComposeReviewAgent',
    'costGovernance',
    'humanReviewQueue',
  ];

  const agentSummaries = orderedKeys
    .map((agentKey) => {
      const ctx = artifactContext.agents[agentKey];
      if (!ctx) return null;

      const qaSummary = readJSONSafe(loadJSONFn, path.join(ctx.metricsDir, 'qa-summary.json'), null);
      if (qaSummary) {
        return qaSummary;
      }

      const manifest = readJSONSafe(loadJSONFn, ctx.manifestPath, null);
      if (!manifest || manifest.status === 'pending') {
        return null;
      }

      return {
        agentKey,
        agentName: agentNameMap[agentKey] || agentKey,
        status: mapManifestStatusToQaStatus(manifest.status),
        headline: `执行状态：${manifest.status}`,
        summary: '当前只有执行层信息，尚未生成更详细的小白 QA 摘要。',
        passItems: [],
        warnItems: [],
        blockItems: [],
        nextActions: ['如需详细判断，请继续查看该 agent 的 manifest 和核心产物。'],
        nextAction: '如需详细判断，请继续查看该 agent 的 manifest 和核心产物。',
        evidenceFiles: ['manifest.json'],
        artifacts: [{ path: 'manifest.json', label: 'manifest.json', kind: 'file' }],
        inputSnapshot: null,
        outputSnapshot: null,
        metrics: {},
      };
    })
    .filter(Boolean);

  const passCount = agentSummaries.filter((item) => item.status === 'pass').length;
  const warnCount = agentSummaries.filter((item) => item.status === 'warn').length;
  const blockCount = agentSummaries.filter((item) => item.status === 'block').length;
  const inferenceOverThreshold = isSeedanceInferenceOverThreshold(options.seedancePromptMetrics);
  const releasable = options.releasable ?? blockCount === 0;
  let status = blockCount > 0 ? 'block' : (warnCount > 0 || inferenceOverThreshold) ? 'warn' : 'pass';
  let topIssues = [
    ...agentSummaries
      .filter((item) => item.status === 'block')
      .flatMap((item) => (item.blockItems || []).slice(0, 2).map((issue) => `${item.agentName}: ${issue}`)),
    ...normalizeStringList(options.extraTopIssues),
    ...agentSummaries
      .filter((item) => item.status === 'warn')
      .flatMap((item) => (item.warnItems || []).slice(0, 2).map((issue) => `${item.agentName}: ${issue}`)),
  ].slice(0, 5);

  if (!releasable) {
    status = 'block';
    topIssues = topIssues.length > 0 ? topIssues : ['Director: 本轮运行未完成，当前不能交付'];
  }

  const headline =
    status === 'pass'
      ? '本轮主要 agent 都已达标'
      : status === 'warn'
        ? inferenceOverThreshold
          ? '本轮可继续交付，但 Seedance 输入补全占比过高'
          : `本轮可继续交付，但有 ${warnCount} 个 agent 需要留意`
        : `本轮有 ${blockCount} 个 agent 处于阻断状态`;

  const summary =
    status === 'pass'
      ? '核心成果物已经齐备，当前没有明显阻断问题。'
      : status === 'warn'
        ? inferenceOverThreshold
          ? '主要链路已经跑通，但过多镜头仍依赖系统自动补导演信息，说明上游输入质量不够稳。'
          : '主要链路已经跑通，但仍有风险项需要研发或人工复查。'
        : '至少有一个关键 agent 未达标，需要先修复后再交付。';

  const summaryWithContext = options.summaryAppend
    ? `${summary} ${options.summaryAppend}`.trim()
    : summary;
  const runDebug = buildRunDebugSignals({
    runJob,
    stateSnapshot,
    agentSummaries,
  });

  return {
    status,
    releasable,
    headline,
    summary: summaryWithContext,
    passCount,
    warnCount,
    blockCount,
    agentSummaries,
    topIssues,
    runDebug,
  };
}

export default {
  HARD_VISUAL_BLOCK_REASON_CODES,
  normalizeStringList,
  buildVisualEligibilityReport,
  buildVisualEligibilityTopIssues,
  buildUpstreamFailureInsights,
  buildUpstreamFailureTopIssues,
  buildExecutionGate,
  buildExecutionGateTopIssues,
  collectHardVisualBlockEntries,
  assertNoHardVisualBlocks,
  buildPreflightTopIssues,
  buildSeedanceInferenceTopIssues,
  isSeedanceInferenceOverThreshold,
  shouldBlockFormalDeliveryForSeedanceInference,
  normalizeRunDebugText,
  buildRunDebugSignals,
  readJSONSafe,
  collectRunQaOverview,
};
