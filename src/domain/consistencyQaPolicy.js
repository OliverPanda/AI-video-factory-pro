const THRESHOLD_MATRIX = {
  lead: {
    anchor: 8.5,
    standard: 8.0,
    complex: 7.5,
  },
  support: {
    anchor: 8.0,
    standard: 7.5,
    complex: 7.0,
  },
};
const DEFAULT_REVIEW_BAND = 0.4;

function toLowerString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizePriority(priority) {
  if (priority === 'lead' || priority === 'support') {
    return priority;
  }

  return 'support';
}

function normalizeShotClass(shotClass) {
  if (shotClass === 'anchor' || shotClass === 'standard' || shotClass === 'complex') {
    return shotClass;
  }

  return 'complex';
}

export function resolveCharacterPriority(card = {}) {
  const priority = card.priority ?? card.characterPriority ?? 'support';
  return normalizePriority(toLowerString(priority));
}

export function classifyShotConsistencyClass(shot = {}) {
  const shotType = toLowerString(shot.shotType);
  const sceneType = toLowerString(shot.sceneType);
  const tags = Array.isArray(shot.tags)
    ? shot.tags.map((tag) => toLowerString(tag)).join(' ')
    : '';
  const notes = toLowerString(shot.notes);
  const searchableText = `${shotType} ${sceneType} ${tags} ${notes}`.trim();

  if (
    shot.isFirstAppearance === true ||
    shot.isKeyDialogue === true ||
    shot.isSingleLeadCloseShot === true ||
    includesAny(searchableText, ['first appearance', 'close-up', 'close up', 'key dialogue'])
  ) {
    return 'anchor';
  }

  if (
    shot.isAction === true ||
    shot.hasOcclusion === true ||
    shot.isLowLight === true ||
    includesAny(searchableText, [
      'action',
      'chase',
      'crowd',
      'occlusion',
      'dark',
      'wide',
      'low light',
    ])
  ) {
    return 'complex';
  }

  return 'standard';
}

export function evaluateConsistencyDecision(input = {}) {
  const hardFailureReasons = Array.isArray(input.hardFailureReasons) ? input.hardFailureReasons : [];

  if (hardFailureReasons.length > 0) {
    return {
      status: 'block',
      threshold: null,
      regenStrategy: 'reanchor_regenerate',
    };
  }

  const priority = normalizePriority(toLowerString(input.characterPriority));
  const shotClass = normalizeShotClass(toLowerString(input.shotConsistencyClass));
  const threshold = THRESHOLD_MATRIX[priority][shotClass] ?? THRESHOLD_MATRIX.support.complex;
  const score = Number.isFinite(input.overallScore) ? input.overallScore : Number.NEGATIVE_INFINITY;
  const softRiskTags = Array.isArray(input.softRiskTags) ? input.softRiskTags : [];
  const reviewBand = Number.isFinite(input.reviewBand) ? Math.max(input.reviewBand, 0) : DEFAULT_REVIEW_BAND;

  // 判定区间（三条线）：
  //   lowConfidenceFloor = threshold - reviewBand        ← 低于此线 → warn
  //   threshold                                          ← 低于此线 → pass_with_review
  //   cleanPassLine = threshold + reviewBand             ← 低于此线 OR 有 softRiskTags → pass_with_review
  // 只有 score ≥ cleanPassLine 且无软风险标签的才直接 pass。
  const lowConfidenceFloor = threshold - reviewBand;
  const cleanPassLine = threshold + reviewBand;
  let status = 'pass';

  if (score < lowConfidenceFloor) {
    status = 'warn';
  } else if (score < cleanPassLine || softRiskTags.length > 0) {
    status = 'pass_with_review';
  }

  return {
    status,
    threshold,
    lowConfidenceFloor,
    reviewBand,
    regenStrategy: status === 'warn' ? 'prompt_tighten' : 'none',
  };
}
