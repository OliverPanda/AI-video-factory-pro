import { normalizeDecisionRecord } from '../runtime/schemas/decisionRecord.js';

const HARD_VISUAL_BLOCK_REASON_CODES = new Set([
  'anatomy_structure_invalid',
  'anatomy_pose_invalid',
  'limb_structure_invalid',
  'character_identity_corrupted',
  'reference_sheet_background_invalid',
]);

const HARD_PREFLIGHT_BLOCK_REASON_CODES = new Set([
  ...HARD_VISUAL_BLOCK_REASON_CODES,
  'scene_spatial_continuity_break',
]);

function normalizeStringList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function collectHardVisualBlockEntries(entries = [], reasonField = 'reasons') {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) => {
    const reasons = reasonField === 'reasons'
      ? normalizeStringList(entry?.reasons)
      : normalizeStringList([entry?.reason, entry?.decisionReason]);
    const matchedReasons = reasons.filter((reason) => HARD_PREFLIGHT_BLOCK_REASON_CODES.has(reason));
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

function normalizeProviderName(value) {
  return String(value || '').trim().toLowerCase();
}

function isStaticFallbackPackage(item = {}) {
  const provider = normalizeProviderName(item?.preferredProvider || item?.provider);
  return provider === 'static_image' || provider === 'skip' || provider === 'fallback_direct_cut' || provider === 'direct_cut';
}

function canFallbackToStaticImage(item = {}) {
  if (isStaticFallbackPackage(item)) {
    return true;
  }
  const fallbackProviders = Array.isArray(item?.fallbackProviders) ? item.fallbackProviders : [];
  return fallbackProviders.some((provider) => normalizeProviderName(provider) === 'static_image');
}

function buildDecisionSnapshot({
  visualEligibilityReport = null,
  preflightQaReport = null,
  shotPackages = [],
  stoppedBeforeStage = 'generate_video_clips',
  decision,
}) {
  return normalizeDecisionRecord({
    decisionType: 'quality_gate',
    policySource: 'qualityGatePolicy',
    decisionKey: stoppedBeforeStage,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      stoppedBeforeStage,
      visualPassCount: Number(visualEligibilityReport?.passCount || 0),
      visualBlockCount: Number(visualEligibilityReport?.blockCount || 0),
      visualBlockedShotIds: Array.isArray(visualEligibilityReport?.blockedShotIds)
        ? visualEligibilityReport.blockedShotIds.filter(Boolean)
        : [],
      preflightPassCount: Number(preflightQaReport?.passCount || 0),
      preflightWarnCount: Number(preflightQaReport?.warnCount || 0),
      preflightBlockCount: Number(preflightQaReport?.blockCount || 0),
      preflightBlockedShotIds: (Array.isArray(preflightQaReport?.entries) ? preflightQaReport.entries : [])
        .filter((entry) => entry?.decision === 'block')
        .map((entry) => entry?.shotId)
        .filter(Boolean),
      shotPackageCount: Array.isArray(shotPackages) ? shotPackages.length : 0,
    },
    outputSnapshot: {
      status: decision.status,
      reason: decision.reason,
      blockedShotIds: Array.isArray(decision.blockedShotIds) ? decision.blockedShotIds : [],
      source: decision.source || '',
      message: decision.message || '',
    },
    rationale: decision.message || decision.reason || 'quality gate passed',
    tags: [
      'quality-gate',
      decision.status === 'blocked' ? 'blocked' : 'pass',
      decision.source || 'unknown_source',
    ].filter(Boolean),
  });
}

export function evaluateQualityGate({
  visualEligibilityReport = null,
  preflightQaReport = null,
  shotPackages = [],
  stoppedBeforeStage = 'generate_video_clips',
} = {}) {
  const packageByShotId = new Map(
    (Array.isArray(shotPackages) ? shotPackages : [])
      .filter((item) => item?.shotId)
      .map((item) => [item.shotId, item])
  );
  const visualBlockedShotIds = Array.isArray(visualEligibilityReport?.blockedShotIds)
    ? visualEligibilityReport.blockedShotIds.filter(Boolean)
    : [];
  const visualBlockedEntries = (Array.isArray(visualEligibilityReport?.entries) ? visualEligibilityReport.entries : [])
    .filter((entry) => entry?.decision === 'block');

  let decision = null;

  const hardBlockEntries = collectHardVisualBlockEntries(preflightQaReport?.entries, 'reasons');
  if (hardBlockEntries.length > 0) {
    const blockedShotIds = hardBlockEntries.map((entry) => entry.shotId).filter(Boolean);
    decision = {
      status: 'blocked',
      reason: hardBlockEntries.some((entry) => entry.reasons.includes('scene_spatial_continuity_break'))
        ? 'scene_continuity_block'
        : 'hard_visual_block',
      blockedShotIds,
      stoppedBeforeStage,
      message: hardBlockEntries.some((entry) => entry.reasons.includes('scene_spatial_continuity_break'))
        ? `Preflight QA 发现不可继续的视频空间连续性断裂：${hardBlockEntries
          .map((entry) => `${entry.shotId}(${entry.reasons.join(',')})`)
          .join('；')}`
        : `Preflight QA 发现人体结构/参考图硬伤：${hardBlockEntries
          .map((entry) => `${entry.shotId}(${entry.reasons.join(',')})`)
          .join('；')}`,
      source: 'preflight',
    };
  }

  if (!decision) {
    const hasExplicitVisualFailure = visualBlockedEntries.some(
      (entry) => entry?.evidence?.success === false || String(entry?.evidence?.error || '').trim()
    );
    const allBlockedShotsHaveStaticFallback = visualBlockedEntries.length > 0
      && visualBlockedEntries.every((entry) => canFallbackToStaticImage(packageByShotId.get(entry?.shotId)));

    if (
      Number(visualEligibilityReport?.passCount || 0) === 0
      && visualBlockedShotIds.length > 0
      && hasExplicitVisualFailure
      && !allBlockedShotsHaveStaticFallback
    ) {
      decision = {
        status: 'blocked',
        reason: 'no_visual_assets',
        blockedShotIds: visualBlockedShotIds,
        stoppedBeforeStage,
        message: `所有镜头都没有可交付的关键帧：${visualBlockedShotIds.join('、')}`,
        source: 'visual_eligibility',
      };
    }
  }

  if (!decision) {
    const blockingPreflightEntries = (Array.isArray(preflightQaReport?.entries) ? preflightQaReport.entries : [])
      .filter((entry) => entry?.decision === 'block')
      .filter((entry) => !isStaticFallbackPackage(packageByShotId.get(entry?.shotId)));
    if (blockingPreflightEntries.length > 0) {
      const blockedShotIds = blockingPreflightEntries.map((entry) => entry?.shotId).filter(Boolean);
      decision = {
        status: 'blocked',
        reason: 'preflight_block',
        blockedShotIds,
        stoppedBeforeStage,
        message: `生成前质检阻断了后续视觉链路：${blockingPreflightEntries
          .map((entry) => `${entry.shotId || 'unknown_shot'}(${normalizeStringList(entry?.reasons).join(',') || 'block'})`)
          .join('；')}`,
        source: 'preflight',
      };
    }
  }

  if (!decision) {
    decision = {
      status: 'pass',
      reason: '',
      blockedShotIds: [],
      stoppedBeforeStage,
      message: '',
      source: '',
    };
  }

  return {
    executionGate: decision,
    decisionRecord: buildDecisionSnapshot({
      visualEligibilityReport,
      preflightQaReport,
      shotPackages,
      stoppedBeforeStage,
      decision,
    }),
  };
}

export default {
  evaluateQualityGate,
};
