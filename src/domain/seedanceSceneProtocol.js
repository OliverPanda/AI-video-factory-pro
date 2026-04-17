const REQUIRED_SCENE_PACK_FIELDS = [
  'scene_id',
  'scene_title',
  'scene_goal',
  'dramatic_question',
  'start_state',
  'end_state',
  'location_anchor',
  'time_anchor',
  'cast',
  'power_shift',
  'emotional_curve',
  'action_beats',
  'visual_motif',
  'space_layout',
  'camera_grammar',
  'hard_locks',
  'forbidden_choices',
  'delivery_priority',
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

function normalizeActionBeats(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((beat, index) => {
      if (typeof beat === 'string') {
        const summary = normalizeText(beat);
        if (!summary) {
          return null;
        }
        return {
          beat_id: `beat_${String(index + 1).padStart(2, '0')}`,
          shot_ids: [],
          summary,
          dramatic_turn: null,
        };
      }

      if (!beat || typeof beat !== 'object') {
        return null;
      }

      const summary = normalizeText(beat.summary || beat.action || beat.dialogue || beat.label);
      if (!summary) {
        return null;
      }

      return {
        beat_id: normalizeText(beat.beat_id, `beat_${String(index + 1).padStart(2, '0')}`),
        shot_ids: normalizeStringArray(beat.shot_ids || beat.shotIds),
        summary,
        dramatic_turn: normalizeText(beat.dramatic_turn || beat.dramaticTurn, '') || null,
      };
    })
    .filter(Boolean);
}

function normalizePlainObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...fallback };
  }
  return { ...fallback, ...value };
}

function hasAllRequiredFields(value) {
  return REQUIRED_SCENE_PACK_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

export function normalizeScenePack(input = {}) {
  return {
    scene_id: normalizeText(input.scene_id || input.sceneId),
    scene_title: normalizeText(input.scene_title || input.sceneTitle, 'Untitled Scene'),
    scene_goal: normalizeText(input.scene_goal || input.sceneGoal, 'Keep narrative readable.'),
    dramatic_question: normalizeText(
      input.dramatic_question || input.dramaticQuestion,
      'What changes in this scene?'
    ),
    start_state: normalizeText(input.start_state || input.startState, 'unknown_start'),
    end_state: normalizeText(input.end_state || input.endState, 'unknown_end'),
    location_anchor: normalizeText(input.location_anchor || input.locationAnchor, 'unanchored_location'),
    time_anchor: normalizeText(input.time_anchor || input.timeAnchor, 'unspecified_time'),
    cast: normalizeStringArray(input.cast),
    power_shift: normalizeText(input.power_shift || input.powerShift, 'stable'),
    emotional_curve: normalizeText(input.emotional_curve || input.emotionalCurve, 'steady_tension'),
    action_beats: normalizeActionBeats(input.action_beats || input.actionBeats),
    visual_motif: normalizeText(input.visual_motif || input.visualMotif, 'grounded realism'),
    space_layout: normalizePlainObject(input.space_layout || input.spaceLayout, {
      primary_zone: null,
      secondary_zone: null,
      geography_note: null,
    }),
    camera_grammar: normalizePlainObject(input.camera_grammar || input.cameraGrammar, {
      coverage: 'clarity_first',
      movement: 'restrained',
      lens_bias: 'naturalistic',
    }),
    hard_locks: normalizeStringArray(input.hard_locks || input.hardLocks),
    forbidden_choices: normalizeStringArray(input.forbidden_choices || input.forbiddenChoices),
    delivery_priority: normalizeText(input.delivery_priority || input.deliveryPriority, 'narrative_clarity'),
  };
}

export function validateScenePack(input = {}) {
  const scenePack = normalizeScenePack(input);
  const issues = [];

  if (!scenePack.scene_id) {
    issues.push('scene_id is required');
  }
  if (scenePack.cast.length === 0) {
    issues.push('cast must contain at least one character');
  }
  if (scenePack.action_beats.length === 0) {
    issues.push('action_beats must contain at least one beat');
  }
  if (scenePack.location_anchor === 'unanchored_location') {
    issues.push('location_anchor must be grounded');
  }

  return {
    ok: issues.length === 0,
    issues,
    status: issues.length === 0 ? 'valid' : (scenePack.action_beats.length > 0 ? 'degraded' : 'invalid'),
    scenePack,
  };
}

export function createScenePack(input = {}, options = {}) {
  const validation = validateScenePack(input);

  if (options.strict && !validation.ok) {
    throw new Error(`Invalid ScenePack: ${validation.issues.join('; ')}`);
  }

  return {
    ...validation.scenePack,
    validation_status: validation.status,
    validation_issues: validation.issues,
  };
}

export function isScenePack(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const validation = validateScenePack(value);
  return hasAllRequiredFields(value) && validation.status !== 'invalid';
}

export const SCENE_PACK_FIELDS = REQUIRED_SCENE_PACK_FIELDS;

export const __testables = {
  hasAllRequiredFields,
  normalizeActionBeats,
  normalizeStringArray,
  normalizeText,
};
