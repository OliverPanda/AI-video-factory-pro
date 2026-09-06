import { normalizeText } from '../../utils/normalization.js';

export const HUMAN_REVIEW_STATUSES = Object.freeze([
  'pending',
  'blocked',
  'approved',
  'rejected',
  'needs_changes',
  'manual_review',
  'unknown',
]);

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeStatus(value) {
  const status = normalizeText(value) || 'pending';
  return HUMAN_REVIEW_STATUSES.includes(status) ? status : 'unknown';
}

export function normalizeHumanReviewRecord(record = {}) {
  return {
    reviewId: normalizeText(record.reviewId) || '',
    blockedStage: normalizeText(record.blockedStage) || '',
    blockingReason: normalizeText(record.blockingReason) || '',
    status: normalizeStatus(record.status),
    reviewerAction: normalizeText(record.reviewerAction) || '',
    resolutionPayload: normalizeObject(record.resolutionPayload),
    resolvedAt: normalizeText(record.resolvedAt) || '',
    taskIds: normalizeStringList(record.taskIds),
  };
}

export function deriveHumanReviewStatus({ queueItems = [], blockedStage = '', fallbackStatus = 'pending' } = {}) {
  const normalizedStatuses = (Array.isArray(queueItems) ? queueItems : [])
    .map((item) => normalizeText(item?.status))
    .filter(Boolean);
  const openStatuses = new Set(['open', 'pending', 'pending_approval']);

  if (normalizedStatuses.some((status) => openStatuses.has(status))) {
    return blockedStage ? 'blocked' : 'pending';
  }
  if (normalizedStatuses.includes('rejected')) {
    return 'rejected';
  }
  if (normalizedStatuses.includes('needs_changes') || normalizedStatuses.includes('manual_review')) {
    return 'needs_changes';
  }
  if (normalizedStatuses.includes('approved') || normalizedStatuses.includes('skipped')) {
    return 'approved';
  }

  return normalizeStatus(fallbackStatus);
}

export default {
  HUMAN_REVIEW_STATUSES,
  normalizeHumanReviewRecord,
  deriveHumanReviewStatus,
};
