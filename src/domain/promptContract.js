function normalizeText(value, fallback = '') {
  if (value == null) return fallback;
  if (typeof value === 'object') return fallback;
  return String(value).trim() || fallback;
}

function normalizeStringArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = normalizeText(value);
    return normalized ? [normalized] : [...fallback];
  }
  return [...fallback];
}

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

export function mergePromptPresets(...presets) {
  const normalizedPresets = presets.filter((preset) => preset && typeof preset === 'object' && !Array.isArray(preset));
  const mergedScalar = {};
  for (const preset of normalizedPresets) {
    for (const [key, value] of Object.entries(preset)) {
      if (['hardConstraints', 'softPreferences', 'negativeRules', 'referenceBinding', 'outputSchema'].includes(key)) {
        continue;
      }
      mergedScalar[key] = value;
    }
  }

  const mergedReferenceBinding = Object.assign(
    {},
    ...normalizedPresets.map((preset) =>
      (preset.referenceBinding && typeof preset.referenceBinding === 'object' && !Array.isArray(preset.referenceBinding))
        ? preset.referenceBinding
        : {}
    )
  );
  const mergedOutputSchema = Object.assign(
    {},
    ...normalizedPresets.map((preset) =>
      (preset.outputSchema && typeof preset.outputSchema === 'object' && !Array.isArray(preset.outputSchema))
        ? preset.outputSchema
        : {}
    )
  );

  return buildPromptContract({
    ...mergedScalar,
    hardConstraints: mergeUniqueStrings(...presets.map((preset) => preset?.hardConstraints)),
    softPreferences: mergeUniqueStrings(...presets.map((preset) => preset?.softPreferences)),
    negativeRules: mergeUniqueStrings(...presets.map((preset) => preset?.negativeRules)),
    referenceBinding: Object.keys(mergedReferenceBinding).length > 0 ? mergedReferenceBinding : null,
    outputSchema: Object.keys(mergedOutputSchema).length > 0 ? mergedOutputSchema : null,
  });
}

export function serializePromptContract(contract = {}) {
  const normalized = buildPromptContract(contract);
  const sections = [];

  if (normalized.displayZh) {
    sections.push(`display_zh: ${normalized.displayZh}`);
  }
  if (normalized.displayNegativeZh) {
    sections.push(`display_negative_zh: ${normalized.displayNegativeZh}`);
  }
  if (normalized.executionEn) {
    sections.push(`execution_en: ${normalized.executionEn}`);
  }
  if (normalized.executionNegativeEn) {
    sections.push(`execution_negative_en: ${normalized.executionNegativeEn}`);
  }
  if (normalized.taskRole) {
    sections.push(`task_role: ${normalized.taskRole}`);
  }
  if (normalized.hardConstraints.length > 0) {
    sections.push(`hard_constraints: ${normalized.hardConstraints.join(' | ')}`);
  }
  if (normalized.softPreferences.length > 0) {
    sections.push(`soft_preferences: ${normalized.softPreferences.join(' | ')}`);
  }
  if (normalized.negativeRules.length > 0) {
    sections.push(`negative_rules: ${normalized.negativeRules.join(' | ')}`);
  }
  if (normalized.referenceBinding && Object.keys(normalized.referenceBinding).length > 0) {
    sections.push(`reference_binding: ${JSON.stringify(canonicalizeValue(normalized.referenceBinding))}`);
  }
  if (normalized.outputSchema && Object.keys(normalized.outputSchema).length > 0) {
    sections.push(`output_schema: ${JSON.stringify(canonicalizeValue(normalized.outputSchema))}`);
  }
  if (normalized.tokenBudget != null) {
    sections.push(`token_budget: ${normalized.tokenBudget}`);
  }
  sections.push(`version: ${normalized.version}`);

  return sections.join('\n');
}

export const __testables = {
  mergeUniqueStrings,
  normalizeNullableObject,
  normalizeStringArray,
  normalizeText,
  normalizeTokenBudget,
  canonicalizeValue,
};
