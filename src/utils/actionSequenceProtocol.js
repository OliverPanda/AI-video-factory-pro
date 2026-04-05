export const ACTION_SEQUENCE_PLAN_FIELDS = [
  'sequenceId',
  'shotIds',
  'sequenceType',
  'sequenceGoal',
  'durationTargetSec',
  'cameraFlowIntent',
  'motionContinuityTargets',
  'subjectContinuityTargets',
  'environmentContinuityTargets',
  'mustPreserveElements',
  'entryConstraint',
  'exitConstraint',
  'generationMode',
  'preferredProvider',
  'fallbackStrategy',
];

export const ACTION_SEQUENCE_PACKAGE_FIELDS = [
  'sequenceId',
  'shotIds',
  'durationTargetSec',
  'referenceImages',
  'referenceVideos',
  'bridgeReferences',
  'visualGoal',
  'cameraSpec',
  'continuitySpec',
  'entryFrameHint',
  'exitFrameHint',
  'audioBeatHints',
  'preferredProvider',
  'fallbackProviders',
  'qaRules',
];

export const SEQUENCE_CLIP_RESULT_FIELDS = [
  'sequenceId',
  'status',
  'provider',
  'model',
  'videoPath',
  'coveredShotIds',
  'targetDurationSec',
  'actualDurationSec',
  'failureCategory',
  'error',
];

export const SEQUENCE_QA_ENTRY_FIELDS = [
  'sequenceId',
  'coveredShotIds',
  'engineCheck',
  'continuityCheck',
  'durationCheck',
  'entryExitCheck',
  'finalDecision',
  'fallbackAction',
  'notes',
];

export const SEQUENCE_QA_REPORT_FIELDS = [
  'status',
  'entries',
  'passedCount',
  'fallbackCount',
  'manualReviewCount',
  'warnings',
  'blockers',
];

function defineShape(fields, input = {}, defaults = {}) {
  const output = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      output[field] = input[field];
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(defaults, field)) {
      output[field] = defaults[field];
      continue;
    }
    output[field] = null;
  }
  return output;
}

function hasAllFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasArrayFields(value, arrayFields) {
  return arrayFields.every((field) => Array.isArray(value[field]));
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value) {
  return value === null || typeof value === 'number';
}

function hasStringFields(value, stringFields) {
  return stringFields.every((field) => isNullableString(value[field]));
}

function hasNumberFields(value, numberFields) {
  return numberFields.every((field) => isNullableNumber(value[field]));
}

export function createActionSequencePlanEntry(input = {}) {
  return defineShape(ACTION_SEQUENCE_PLAN_FIELDS, input, {
    shotIds: [],
    motionContinuityTargets: [],
    subjectContinuityTargets: [],
    environmentContinuityTargets: [],
    mustPreserveElements: [],
  });
}

export const createActionSequencePlan = createActionSequencePlanEntry;

export function createActionSequencePackage(input = {}) {
  return defineShape(ACTION_SEQUENCE_PACKAGE_FIELDS, input, {
    shotIds: [],
    referenceImages: [],
    referenceVideos: [],
    bridgeReferences: [],
    audioBeatHints: [],
    fallbackProviders: [],
    qaRules: [],
  });
}

export function createSequenceClipResult(input = {}) {
  return defineShape(SEQUENCE_CLIP_RESULT_FIELDS, input, {
    coveredShotIds: [],
    failureCategory: null,
    error: null,
  });
}

export function createSequenceQaEntry(input = {}) {
  return defineShape(SEQUENCE_QA_ENTRY_FIELDS, input, {
    coveredShotIds: [],
  });
}

export function createSequenceQaReport(input = {}) {
  const entries = Array.isArray(input?.entries)
    ? input.entries.map((entry) => createSequenceQaEntry(entry))
    : [];

  return defineShape(SEQUENCE_QA_REPORT_FIELDS, {
    ...input,
    entries,
  }, {
    entries: [],
    warnings: [],
    blockers: [],
  });
}

export function isActionSequencePlanEntry(value) {
  return (
    hasAllFields(value, ACTION_SEQUENCE_PLAN_FIELDS) &&
    hasArrayFields(value, [
      'shotIds',
      'motionContinuityTargets',
      'subjectContinuityTargets',
      'environmentContinuityTargets',
      'mustPreserveElements',
    ]) &&
    hasStringFields(value, [
      'sequenceId',
      'sequenceType',
      'sequenceGoal',
      'cameraFlowIntent',
      'entryConstraint',
      'exitConstraint',
      'generationMode',
      'preferredProvider',
      'fallbackStrategy',
    ]) &&
    hasNumberFields(value, ['durationTargetSec'])
  );
}

export const isActionSequencePlan = isActionSequencePlanEntry;

export function isActionSequencePackage(value) {
  return (
    hasAllFields(value, ACTION_SEQUENCE_PACKAGE_FIELDS) &&
    hasArrayFields(value, [
      'shotIds',
      'referenceImages',
      'referenceVideos',
      'bridgeReferences',
      'audioBeatHints',
      'fallbackProviders',
      'qaRules',
    ]) &&
    hasStringFields(value, [
      'sequenceId',
      'visualGoal',
      'cameraSpec',
      'continuitySpec',
      'entryFrameHint',
      'exitFrameHint',
      'preferredProvider',
    ]) &&
    hasNumberFields(value, ['durationTargetSec'])
  );
}

export function isSequenceClipResult(value) {
  return (
    hasAllFields(value, SEQUENCE_CLIP_RESULT_FIELDS) &&
    hasArrayFields(value, ['coveredShotIds']) &&
    hasStringFields(value, ['sequenceId', 'status', 'provider', 'model', 'videoPath', 'failureCategory', 'error']) &&
    hasNumberFields(value, ['targetDurationSec', 'actualDurationSec'])
  );
}

export function isSequenceQaReport(value) {
  return (
    hasAllFields(value, SEQUENCE_QA_REPORT_FIELDS) &&
    hasStringFields(value, ['status']) &&
    hasNumberFields(value, ['passedCount', 'fallbackCount', 'manualReviewCount']) &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry) =>
        isPlainObject(entry) &&
        hasAllFields(entry, SEQUENCE_QA_ENTRY_FIELDS) &&
        Array.isArray(entry.coveredShotIds) &&
        hasStringFields(entry, [
          'sequenceId',
          'engineCheck',
          'continuityCheck',
          'durationCheck',
          'entryExitCheck',
          'finalDecision',
          'fallbackAction',
          'notes',
        ])
    ) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.blockers)
  );
}

export default {
  ACTION_SEQUENCE_PLAN_FIELDS,
  ACTION_SEQUENCE_PACKAGE_FIELDS,
  SEQUENCE_CLIP_RESULT_FIELDS,
  SEQUENCE_QA_ENTRY_FIELDS,
  SEQUENCE_QA_REPORT_FIELDS,
  createActionSequencePlanEntry,
  createActionSequencePlan,
  createActionSequencePackage,
  createSequenceClipResult,
  createSequenceQaEntry,
  createSequenceQaReport,
  isActionSequencePlanEntry,
  isActionSequencePlan,
  isActionSequencePackage,
  isSequenceClipResult,
  isSequenceQaReport,
};
