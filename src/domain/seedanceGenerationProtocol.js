const SHOT_GENERATION_PACK_FIELDS = [
  'task_type',
  'scene_id',
  'shot_id',
  'shot_goal',
  'entry_state',
  'exit_state',
  'timecoded_beats',
  'camera_plan',
  'actor_blocking',
  'space_anchor',
  'character_locks',
  'environment_locks',
  'reference_stack',
  'negative_rules',
  'quality_target',
];

const SEQUENCE_GENERATION_PACK_FIELDS = [
  'task_type',
  'scene_id',
  'sequence_id',
  'sequence_goal',
  'covered_beats',
  'entry_state',
  'mid_state',
  'exit_state',
  'timecoded_multi_beats',
  'axis_rule',
  'blocking_progression',
  'camera_progression',
  'reference_stack',
  'hard_locks',
  'negative_rules',
  'candidate_policy',
];

function normalizeText(value, fallback = '') {
  if (value == null) return fallback;
  return String(value).trim() || fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function normalizePlainObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...fallback };
  }
  return { ...fallback, ...value };
}

function normalizeTimecodedBeats(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((beat, index) => {
      if (!beat || typeof beat !== 'object') return null;
      const summary = normalizeText(beat.summary || beat.action || beat.label);
      if (!summary) return null;
      return {
        at_sec: Number.isFinite(Number(beat.at_sec ?? beat.atSec)) ? Number(beat.at_sec ?? beat.atSec) : index,
        summary,
      };
    })
    .filter(Boolean);
}

function normalizeReferenceStack(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const path = normalizeText(entry.path);
      if (!path) return null;
      return {
        type: normalizeText(entry.type, 'reference_image'),
        path,
        role: normalizeText(entry.role, 'reference'),
      };
    })
    .filter(Boolean);
}

export function createShotGenerationPack(input = {}, options = {}) {
  const pack = {
    task_type: 'shot',
    scene_id: normalizeText(input.scene_id || input.sceneId),
    shot_id: normalizeText(input.shot_id || input.shotId),
    shot_goal: normalizeText(input.shot_goal || input.shotGoal, 'Deliver a readable cinematic beat.'),
    entry_state: normalizeText(input.entry_state || input.entryState, 'unknown_entry'),
    exit_state: normalizeText(input.exit_state || input.exitState, 'unknown_exit'),
    timecoded_beats: normalizeTimecodedBeats(input.timecoded_beats || input.timecodedBeats),
    camera_plan: normalizePlainObject(input.camera_plan || input.cameraPlan, {
      framing: null,
      move_type: null,
      coverage_role: null,
    }),
    actor_blocking: normalizeStringArray(input.actor_blocking || input.actorBlocking),
    space_anchor: normalizeText(input.space_anchor || input.spaceAnchor, 'unanchored_location'),
    character_locks: normalizeStringArray(input.character_locks || input.characterLocks),
    environment_locks: normalizeStringArray(input.environment_locks || input.environmentLocks),
    reference_stack: normalizeReferenceStack(input.reference_stack || input.referenceStack),
    negative_rules: normalizeStringArray(input.negative_rules || input.negativeRules),
    quality_target: normalizeText(input.quality_target || input.qualityTarget, 'narrative_clarity'),
  };

  const issues = [];
  if (!pack.scene_id) issues.push('scene_id is required');
  if (!pack.shot_id) issues.push('shot_id is required');
  if (pack.timecoded_beats.length === 0) issues.push('timecoded_beats must contain at least one beat');
  if (pack.reference_stack.length === 0) issues.push('reference_stack must contain at least one reference');

  if (options.strict && issues.length > 0) {
    throw new Error(`Invalid ShotGenerationPack: ${issues.join('; ')}`);
  }

  return {
    ...pack,
    validation_status: issues.length === 0 ? 'valid' : 'degraded',
    validation_issues: issues,
  };
}

export function createSequenceGenerationPack(input = {}, options = {}) {
  const pack = {
    task_type: 'sequence',
    scene_id: normalizeText(input.scene_id || input.sceneId),
    sequence_id: normalizeText(input.sequence_id || input.sequenceId),
    sequence_goal: normalizeText(input.sequence_goal || input.sequenceGoal, 'Preserve sequence continuity.'),
    covered_beats: normalizeStringArray(input.covered_beats || input.coveredBeats),
    entry_state: normalizeText(input.entry_state || input.entryState, 'unknown_entry'),
    mid_state: normalizeText(input.mid_state || input.midState, 'unknown_mid'),
    exit_state: normalizeText(input.exit_state || input.exitState, 'unknown_exit'),
    timecoded_multi_beats: normalizeTimecodedBeats(input.timecoded_multi_beats || input.timecodedMultiBeats),
    axis_rule: normalizeText(input.axis_rule || input.axisRule, 'protect_screen_direction'),
    blocking_progression: normalizeStringArray(input.blocking_progression || input.blockingProgression),
    camera_progression: normalizeStringArray(input.camera_progression || input.cameraProgression),
    reference_stack: normalizeReferenceStack(input.reference_stack || input.referenceStack),
    hard_locks: normalizeStringArray(input.hard_locks || input.hardLocks),
    negative_rules: normalizeStringArray(input.negative_rules || input.negativeRules),
    candidate_policy: normalizePlainObject(input.candidate_policy || input.candidatePolicy, {
      variant_count: 2,
      ranking_focus: ['narrative_clarity'],
    }),
  };

  const issues = [];
  if (!pack.scene_id) issues.push('scene_id is required');
  if (!pack.sequence_id) issues.push('sequence_id is required');
  if (pack.timecoded_multi_beats.length === 0) issues.push('timecoded_multi_beats must contain at least one beat');
  if (pack.reference_stack.length === 0) issues.push('reference_stack must contain at least one reference');

  if (options.strict && issues.length > 0) {
    throw new Error(`Invalid SequenceGenerationPack: ${issues.join('; ')}`);
  }

  return {
    ...pack,
    validation_status: issues.length === 0 ? 'valid' : 'degraded',
    validation_issues: issues,
  };
}

export { SHOT_GENERATION_PACK_FIELDS, SEQUENCE_GENERATION_PACK_FIELDS };
