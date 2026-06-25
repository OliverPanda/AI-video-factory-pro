import { normalizeText, normalizeStringArray } from '../utils/normalization.js';

function normalizeNullableObject(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'object' || Array.isArray(value)) return fallback;
  return { ...value };
}

function mergeUniqueStrings(...values) {
  return [...new Set(values.flatMap((value) => normalizeStringArray(value)))];
}

function normalizeTokenBudget(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function canonicalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalizeValue(value[key]);
  }
  return sorted;
}

export function buildPromptContract(input = {}) {
  const hardConstraints = normalizeStringArray(input.hardConstraints);
  const softPreferences = normalizeStringArray(input.softPreferences);
  const negativeRules = normalizeStringArray(input.negativeRules);
  const referenceBinding = normalizeNullableObject(input.referenceBinding, null);
  const outputSchema = normalizeNullableObject(input.outputSchema, null);

  return {
    version: normalizeText(input.version, 'v1'),
    taskRole: normalizeText(input.taskRole, 'general_prompt'),
    displayZh: normalizeText(input.displayZh, ''),
    displayNegativeZh: normalizeText(input.displayNegativeZh, ''),
    executionEn: normalizeText(input.executionEn, ''),
    executionNegativeEn: normalizeText(input.executionNegativeEn, ''),
    hardConstraints,
    softPreferences,
    referenceBinding,
    negativeRules,
    outputSchema,
    tokenBudget: normalizeTokenBudget(input.tokenBudget, null),
  };
}

export const __testables = {
  mergeUniqueStrings,
  normalizeNullableObject,
  normalizeStringArray,
  normalizeText,
  normalizeTokenBudget,
  canonicalizeValue,
};
