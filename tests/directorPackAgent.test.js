import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
import { createDirectorPack, isDirectorPack, normalizeDirectorPack, validateDirectorPack } from '../src/domain/seedanceDirectorProtocol.js';
import { buildDirectorPack, planDirectorPacks } from '../src/agents/directorPackAgent.js';

test('createDirectorPack returns a valid DirectorPack with required fields', () => {
  const directorPack = createDirectorPack({
    scene_id: 'scene_001',
    cinematic_intent: 'Keep the confrontation readable and tense.',
    coverage_strategy: 'clarity_first',
    shot_order_plan: [{ beat_id: 'beat_01', coverage: 'anchor_master', emphasis: 'space_and_power' }],
    entry_master_state: '双方在主通道对峙',
    exit_master_state: '阿哲被逼向货架',
    axis_map: { dominant_axis: 'forward_pressure_axis' },
    blocking_map: [{ beat_id: 'beat_01', subject_positions: ['林岚:foreground', '阿哲:midground'], movement_note: 'pressure_forward' }],
    screen_direction_rules: ['protect forward screen direction'],
    pace_design: { opening: 'measured', middle: 'pressure_build', ending: 'clean_handoff' },
    performance_rules: ['favor grounded reaction time'],
    camera_rules: ['preserve a readable master relationship before cutting tighter'],
    reference_strategy: { keyframe_priority: 'entry_then_turning_point' },
    continuity_locks: ['preserve warehouse geography'],
    candidate_strategy: { variant_count: 2, ranking_focus: ['narrative_clarity'] },
    failure_rewrite_policy: { first_retry: 'tighten_blocking_and_entry_exit' },
  });

  assert.equal(isDirectorPack(directorPack), true);
  assert.equal(directorPack.validation_status, 'valid');
});

test('normalizeDirectorPack fills defaults and validateDirectorPack downgrades incomplete input', () => {
  const normalized = normalizeDirectorPack({
    scene_id: 'scene_002',
    shot_order_plan: [{ beat_id: 'beat_01', coverage: 'anchor_master' }],
    blocking_map: [{ beat_id: 'beat_01', subject_positions: ['林岚:foreground'] }],
  });

  assert.equal(normalized.coverage_strategy, 'clarity_first');
  assert.deepEqual(normalized.pace_design, {
    opening: 'measured',
    middle: 'pressure_build',
    ending: 'clean_handoff',
  });

  const degraded = validateDirectorPack({
    scene_id: 'scene_003',
    shot_order_plan: [{ beat_id: 'beat_01', coverage: 'anchor_master' }],
    blocking_map: [{ beat_id: 'beat_01', subject_positions: ['林岚:foreground'] }],
  });
  assert.equal(degraded.status, 'degraded');
  assert.equal(degraded.issues.includes('continuity_locks must contain at least one lock'), true);
});

test('buildDirectorPack converts scene pack into realistic action-scene directing rules', async () => {
  const scenePack = {
    scene_id: 'scene_001',
    scene_goal: '建立威胁关系并清楚交代谁在掌控局面。',
    start_state: '林岚与阿哲在仓库主通道对峙。',
    end_state: '阿哲被逼退到货架边。',
    location_anchor: '仓库主通道',
    cast: ['林岚', '阿哲'],
    power_shift: 'dominance_established',
    emotional_curve: 'slow_burn_to_spike',
    action_beats: [
      { beat_id: 'beat_01', shot_ids: ['shot_001'], summary: '林岚举枪逼近阿哲' },
      { beat_id: 'beat_02', shot_ids: ['shot_002'], summary: '阿哲后撤半步贴住货架' },
      { beat_id: 'beat_03', shot_ids: ['shot_003'], summary: '林岚停步压住出口', dramatic_turn: 'handoff_ready' },
    ],
    hard_locks: ['keep aisle geography readable'],
    delivery_priority: 'narrative_coherence',
    camera_grammar: { movement: 'restrained' },
  };

  const shots = [
    { id: 'shot_001', characters: ['林岚', '阿哲'] },
    { id: 'shot_002', characters: ['林岚', '阿哲'] },
    { id: 'shot_003', characters: ['林岚'] },
  ];

  const directorPack = buildDirectorPack(scenePack, { shots });
  assert.equal(directorPack.coverage_strategy, 'master_anchor_then_selective_escalation');
  assert.equal(directorPack.axis_map.dominant_axis, 'forward_pressure_axis');
  assert.equal(directorPack.blocking_map.length, 3);
  assert.equal(directorPack.blocking_map[0].subject_positions.includes('林岚:foreground'), true);
  assert.equal(directorPack.candidate_strategy.variant_count, 3);

  const planned = await planDirectorPacks([scenePack], { shots });
  assert.equal(planned.length, 1);
});

test('directorPackAgent enforces cinematic invariants for axis blocking and handoff discipline', () => {
  const directorPack = buildDirectorPack(
    {
      scene_id: 'scene_qa',
      scene_goal: '建立威胁关系并清楚交代谁在掌控局面。',
      start_state: '林岚与阿哲在仓库主通道对峙。',
      end_state: '阿哲被逼退到货架边。',
      location_anchor: '仓库主通道',
      cast: ['林岚', '阿哲'],
      power_shift: 'dominance_established',
      emotional_curve: 'slow_burn_to_spike',
      action_beats: [
        { beat_id: 'beat_01', shot_ids: ['shot_001'], summary: '林岚举枪逼近阿哲' },
        { beat_id: 'beat_02', shot_ids: ['shot_002'], summary: '阿哲后撤半步贴住货架' },
      ],
      hard_locks: ['keep aisle geography readable'],
      delivery_priority: 'narrative_coherence',
      camera_grammar: { movement: 'restrained' },
    },
    {
      shots: [
        { id: 'shot_001', characters: ['林岚', '阿哲'] },
        { id: 'shot_002', characters: ['林岚', '阿哲'] },
      ],
    }
  );

  assert.equal(directorPack.entry_master_state.includes('对峙'), true);
  assert.equal(directorPack.exit_master_state.includes('货架边'), true);
  assert.equal(directorPack.axis_map.crossing_policy, 'avoid_unmotivated_crossing');
  assert.equal(directorPack.screen_direction_rules.some((rule) => rule.includes('entry and exit vectors')), true);
  assert.equal(directorPack.blocking_map.every((entry) => entry.subject_positions.length >= 2), true);
  assert.equal(directorPack.continuity_locks.some((item) => item.includes('geography')), true);
});

test('runEpisodePipeline stores directorPacks after scenePacks without changing current delivery path', async () => {
  const savedStates = [];
  const director = createDirector({
    initDirs: () => ({ root: '/tmp/director-pack', images: '/tmp/director-pack/images', audio: '/tmp/director-pack/audio', output: '/tmp/director-pack/output' }),
    generateJobId: () => 'job_director_pack',
    loadJSON: () => null,
    saveJSON: (_file, payload) => {
      savedStates.push(JSON.parse(JSON.stringify(payload)));
    },
    loadProject: () => ({ id: 'project_1', name: '仓库暗战' }),
    loadScript: () => ({ id: 'script_1', title: '第一卷', characters: [{ name: '林岚' }, { name: '阿哲' }] }),
    loadEpisode: () => ({
      id: 'episode_1',
      title: '第1集',
      shots: [
        { id: 'shot_001', scene: '仓库主通道', action: '林岚举枪逼近阿哲', dialogue: '把箱子放下。', characters: ['林岚', '阿哲'], duration: 3 },
        { id: 'shot_002', scene: '仓库侧门', action: '阿哲撞门冲出', dialogue: '', characters: ['阿哲'], duration: 3 },
      ],
    }),
    createRunJob: () => ({}),
    appendAgentTaskRun: () => {},
    finishRunJob: () => {},
    buildCharacterRegistry: async () => [],
    generateCharacterRefSheets: async () => [],
    generateAllPrompts: async () => [],
    generateAllImages: async () => [],
    runConsistencyCheck: async () => ({ reports: [], needsRegeneration: [] }),
    runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
    normalizeDialogueShots: async (shots) => shots,
    generateAllAudio: async () => [],
    runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
    runLipsync: async () => ({ results: [], report: { status: 'pass', blockers: [], warnings: [] } }),
    planMotion: async (shots) => shots.map((shot, index) => ({ shotId: shot.id, order: index, shotType: 'dialogue_medium', durationTargetSec: shot.duration || 3, cameraIntent: 'slow_dolly', cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' }, videoGenerationMode: 'sora2_image_to_video', visualGoal: shot.scene })),
    planPerformance: async (motionPlan) => motionPlan.map((entry) => ({ shotId: entry.shotId, performanceTemplate: 'dialogue_two_shot_tension', generationTier: 'enhanced', variantCount: 2 })),
    routeVideoShots: async () => [],
    runSeedanceVideo: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
    runSora2Video: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
    runMotionEnhancer: async () => [],
    runShotQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
    planBridgeShots: async () => [],
    routeBridgeShots: async () => [],
    generateBridgeClips: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
    runBridgeQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
    planActionSequences: async () => [],
    routeActionSequencePackages: async () => [],
    generateSequenceClips: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
    runSequenceQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
    composeVideo: async () => '/tmp/final-video.mp4',
  });

  await director.runEpisodePipeline({
    projectId: 'project_1',
    scriptId: 'script_1',
    episodeId: 'episode_1',
    options: {},
  });

  const finalState = [...savedStates].reverse()[0];
  assert.equal(Array.isArray(finalState.scenePacks), true);
  assert.equal(Array.isArray(finalState.directorPacks), true);
  assert.equal(finalState.directorPacks.length, 2);
});
