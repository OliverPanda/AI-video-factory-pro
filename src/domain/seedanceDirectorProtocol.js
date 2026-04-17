const REQUIRED_DIRECTOR_PACK_FIELDS = [
  'scene_id',
  'cinematic_intent',
  'coverage_strategy',
  'shot_order_plan',
  'entry_master_state',
  'exit_master_state',
  'axis_map',
  'blocking_map',
  'screen_direction_rules',
  'pace_design',
  'performance_rules',
  'camera_rules',
  'reference_strategy',
  'continuity_locks',
  'candidate_strategy',
  'failure_rewrite_policy',
];

function normalizeText(value, fallback = '') {
  if (value == null) {
    return fallback;
  }
  return String(value).trim() || fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function normalizePlanArray(value, entryFactory) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => entryFactory(entry, index))
    .filter(Boolean);
}

function normalizePlainObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...fallback };
  }
  return { ...fallback, ...value };
}

export function normalizeDirectorPack(input = {}) {
  return {
    scene_id: normalizeText(input.scene_id || input.sceneId),
    cinematic_intent: normalizeText(
      input.cinematic_intent || input.cinematicIntent,
      'Keep the scene readable and emotionally grounded.'
    ),
    coverage_strategy: normalizeText(input.coverage_strategy || input.coverageStrategy, 'clarity_first'),
    shot_order_plan: normalizePlanArray(input.shot_order_plan || input.shotOrderPlan, (entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      return {
        beat_id: normalizeText(entry.beat_id || entry.beatId, `beat_${String(index + 1).padStart(2, '0')}`),
        coverage: normalizeText(entry.coverage, 'selective'),
        emphasis: normalizeText(entry.emphasis, 'story_information'),
      };
    }),
    entry_master_state: normalizeText(input.entry_master_state || input.entryMasterState, 'unknown_entry'),
    exit_master_state: normalizeText(input.exit_master_state || input.exitMasterState, 'unknown_exit'),
    axis_map: normalizePlainObject(input.axis_map || input.axisMap, {
      dominant_axis: 'front_back',
      protected_screen_direction: 'forward',
      crossing_policy: 'avoid_unmotivated_crossing',
    }),
    blocking_map: normalizePlanArray(input.blocking_map || input.blockingMap, (entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      return {
        beat_id: normalizeText(entry.beat_id || entry.beatId, `beat_${String(index + 1).padStart(2, '0')}`),
        subject_positions: normalizeStringArray(entry.subject_positions || entry.subjectPositions),
        movement_note: normalizeText(entry.movement_note || entry.movementNote, 'hold'),
      };
    }),
    screen_direction_rules: normalizeStringArray(input.screen_direction_rules || input.screenDirectionRules),
    pace_design: normalizePlainObject(input.pace_design || input.paceDesign, {
      opening: 'measured',
      middle: 'pressure_build',
      ending: 'clean_handoff',
    }),
    performance_rules: normalizeStringArray(input.performance_rules || input.performanceRules),
    camera_rules: normalizeStringArray(input.camera_rules || input.cameraRules),
    reference_strategy: normalizePlainObject(input.reference_strategy || input.referenceStrategy, {
      keyframe_priority: 'entry_then_turning_point',
      continuity_reference_mode: 'adjacent_ranked',
    }),
    continuity_locks: normalizeStringArray(input.continuity_locks || input.continuityLocks),
    candidate_strategy: normalizePlainObject(input.candidate_strategy || input.candidateStrategy, {
      variant_count: 2,
      ranking_focus: ['narrative_clarity', 'spatial_readability', 'handoff_quality'],
    }),
    failure_rewrite_policy: normalizePlainObject(input.failure_rewrite_policy || input.failureRewritePolicy, {
      first_retry: 'tighten_blocking_and_entry_exit',
      second_retry: 'simplify_camera_and_reduce_motion',
    }),
  };
}

export function validateDirectorPack(input = {}) {
  const directorPack = normalizeDirectorPack(input);
  const issues = [];

  if (!directorPack.scene_id) {
    issues.push('scene_id is required');
  }
  if (directorPack.shot_order_plan.length === 0) {
    issues.push('shot_order_plan must contain at least one beat');
  }
  if (directorPack.blocking_map.length === 0) {
    issues.push('blocking_map must contain at least one blocking step');
  }
  if (directorPack.continuity_locks.length === 0) {
    issues.push('continuity_locks must contain at least one lock');
  }

  return {
    ok: issues.length === 0,
    issues,
    status: issues.length === 0 ? 'valid' : (directorPack.shot_order_plan.length > 0 ? 'degraded' : 'invalid'),
    directorPack,
  };
}

export function createDirectorPack(input = {}, options = {}) {
  const validation = validateDirectorPack(input);
  if (options.strict && !validation.ok) {
    throw new Error(`Invalid DirectorPack: ${validation.issues.join('; ')}`);
  }
  return {
    ...validation.directorPack,
    validation_status: validation.status,
    validation_issues: validation.issues,
  };
}

export function isDirectorPack(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return REQUIRED_DIRECTOR_PACK_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field))
    && validateDirectorPack(value).status !== 'invalid';
}

export const DIRECTOR_PACK_FIELDS = REQUIRED_DIRECTOR_PACK_FIELDS;
