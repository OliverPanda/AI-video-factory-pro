import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
import { createScenePack, isScenePack, normalizeScenePack, validateScenePack } from '../src/domain/seedanceSceneProtocol.js';
import { __testables, planSceneGrammar } from '../src/agents/sceneGrammarAgent.js';

test('createScenePack returns a valid ScenePack with required fields', () => {
  const scenePack = createScenePack({
    scene_id: 'scene_001',
    scene_title: 'Warehouse Standoff',
    scene_goal: 'Make the power balance legible.',
    dramatic_question: 'Who controls the aisle?',
    start_state: 'Two sides face each other across the aisle.',
    end_state: 'One side gains initiative and forces a retreat.',
    location_anchor: '废旧仓库主通道',
    time_anchor: 'night',
    cast: ['林岚', '阿哲'],
    power_shift: 'dominance_established',
    emotional_curve: 'slow_burn_to_spike',
    action_beats: ['对峙', '举枪逼近', '后撤'],
    visual_motif: 'dust and sodium-vapor light',
    space_layout: { primary_zone: '主通道', geography_note: '叉车在右侧，出口在后方' },
    camera_grammar: { coverage: 'clarity_first', movement: 'restrained', lens_bias: 'naturalistic' },
    hard_locks: ['keep aisle geography readable'],
    forbidden_choices: ['random axis flips'],
    delivery_priority: 'narrative_clarity',
  });

  assert.equal(isScenePack(scenePack), true);
  assert.equal(scenePack.validation_status, 'valid');
  assert.deepEqual(scenePack.validation_issues, []);
});

test('normalizeScenePack normalizes optional arrays strings and object defaults', () => {
  const scenePack = normalizeScenePack({
    scene_id: 'scene_002',
    cast: [' 林岚 ', null, '阿哲', ''],
    action_beats: [' 逼近 ', { summary: ' 停步试探 ', shot_ids: [' shot_003 ', ''] }],
    hard_locks: [' keep wardrobe continuity ', ''],
    camera_grammar: { movement: 'controlled_follow' },
  });

  assert.deepEqual(scenePack.cast, ['林岚', '阿哲']);
  assert.deepEqual(scenePack.action_beats, [
    {
      beat_id: 'beat_01',
      shot_ids: [],
      summary: '逼近',
      dramatic_turn: null,
    },
    {
      beat_id: 'beat_02',
      shot_ids: ['shot_003'],
      summary: '停步试探',
      dramatic_turn: null,
    },
  ]);
  assert.deepEqual(scenePack.hard_locks, ['keep wardrobe continuity']);
  assert.deepEqual(scenePack.camera_grammar, {
    coverage: 'clarity_first',
    movement: 'controlled_follow',
    lens_bias: 'naturalistic',
  });
});

test('validateScenePack downgrades incomplete scene structure and strict mode rejects invalid data', () => {
  const degraded = createScenePack({
    scene_id: 'scene_003',
    cast: ['林岚'],
    action_beats: ['仓皇逃离'],
  });

  assert.equal(degraded.validation_status, 'degraded');
  assert.equal(degraded.validation_issues.includes('location_anchor must be grounded'), true);

  assert.throws(
    () =>
      createScenePack(
        {
          scene_title: 'broken',
          cast: [],
          action_beats: [],
        },
        { strict: true }
      ),
    /Invalid ScenePack/
  );

  const validation = validateScenePack({ scene_id: 'scene_004', cast: [], action_beats: [] });
  assert.equal(validation.status, 'invalid');
});

test('groupShotsIntoScenes splits warehouse confrontation and escape into separate scene packs', async () => {
  const shots = [
    {
      id: 'shot_001',
      scene: '仓库主通道',
      time: '夜',
      action: '林岚举枪逼近阿哲',
      dialogue: '把箱子放下。',
      characters: ['林岚', '阿哲'],
      duration: 4,
    },
    {
      id: 'shot_002',
      scene: '仓库主通道',
      time: '夜',
      action: '阿哲后撤半步贴住货架',
      dialogue: '你先冷静。',
      characters: ['林岚', '阿哲'],
      duration: 3,
    },
    {
      id: 'shot_003',
      scene: '仓库侧门',
      time: '夜',
      action: '阿哲撞开侧门冲进雨里',
      dialogue: '',
      characters: ['阿哲'],
      duration: 3,
    },
    {
      id: 'shot_004',
      scene: '仓库外雨巷',
      time: '夜',
      action: '林岚追出门口停在灯下',
      dialogue: '',
      characters: ['林岚'],
      duration: 3,
    },
  ];

  const groups = __testables.groupShotsIntoScenes(shots);
  assert.equal(groups.length, 3);

  const scenePacks = await planSceneGrammar(shots);
  assert.equal(scenePacks.length, 3);
  assert.equal(scenePacks[0].location_anchor, '仓库主通道');
  assert.equal(scenePacks[0].scene_goal, '建立威胁关系并清楚交代谁在掌控局面。');
  assert.equal(scenePacks[0].dramatic_question, '这一轮对峙里谁先压制住对方？');
  assert.equal(scenePacks[0].delivery_priority, 'character_readability');
  assert.deepEqual(scenePacks[0].cast, ['林岚', '阿哲']);
  assert.equal(scenePacks[1].location_anchor, '仓库侧门');
  assert.equal(scenePacks[1].power_shift, 'pressure_to_escape');
  assert.equal(scenePacks[2].location_anchor, '仓库外雨巷');
});

test('sceneGrammarAgent preserves cinematic invariants for space time and handoff readability', async () => {
  const shots = [
    { id: 'shot_a', scene: '仓库主通道', time: '夜', action: '林岚举枪逼近阿哲', dialogue: '', characters: ['林岚', '阿哲'], duration: 4 },
    { id: 'shot_b', scene: '仓库主通道', time: '夜', action: '阿哲后撤半步贴住货架', dialogue: '', characters: ['林岚', '阿哲'], duration: 3 },
  ];

  const scenePacks = await planSceneGrammar(shots);
  assert.equal(scenePacks.length, 1);
  assert.equal(scenePacks[0].location_anchor, '仓库主通道');
  assert.equal(scenePacks[0].time_anchor, '夜');
  assert.equal(scenePacks[0].start_state.includes('林岚举枪逼近阿哲'), true);
  assert.equal(scenePacks[0].end_state.includes('阿哲后撤半步贴住货架'), true);
  assert.equal(scenePacks[0].action_beats.at(-1).dramatic_turn, 'handoff_ready');
  assert.equal(scenePacks[0].hard_locks.some((item) => item.includes('readable')), true);
});

test('runEpisodePipeline stores scenePacks before motion planning without changing downstream flow', async () => {
  const savedStates = [];
  const director = createDirector({
    initDirs: () => ({ root: '/tmp/scene-grammar', images: '/tmp/scene-grammar/images', audio: '/tmp/scene-grammar/audio', output: '/tmp/scene-grammar/output' }),
    generateJobId: () => 'job_scene_pack',
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

  const stateWithScenePacks = [...savedStates].reverse().find((state) => Array.isArray(state.scenePacks));
  assert.ok(stateWithScenePacks);
  assert.equal(stateWithScenePacks.scenePacks.length, 2);
  assert.equal(stateWithScenePacks.motionPlan.length, 2);
});
