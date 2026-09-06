import { normalizeText } from '../../utils/normalization.js';

function normalizeStringList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeDecisionRecord(record = {}) {
  return {
    decisionType: normalizeText(record.decisionType) || 'unknown',
    policySource: normalizeText(record.policySource) || 'unknown',
    decisionKey: normalizeText(record.decisionKey) || '',
    timestamp: normalizeText(record.timestamp) || '',
    inputSnapshot: normalizeObject(record.inputSnapshot),
    outputSnapshot: normalizeObject(record.outputSnapshot),
    rationale: normalizeText(record.rationale) || '',
    tags: normalizeStringList(record.tags),
  };
}

export default {
  normalizeDecisionRecord,
};
