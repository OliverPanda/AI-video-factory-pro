import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables, planMotion } from '../src/agents/motionPlanner.js';

test('buildMotionPlan covers phase1 shot types with deterministic rules', () => {
  const plan = __testables.buildMotionPlan([
    { id: 'shot_close', dialogue: '你终于来了', camera_type: '特写', duration: 3 },
    { id: 'shot_medium', dialogue: '先退下', camera_type: '中景', durationSec: 4 },
    { id: 'shot_fight', action: '两人打斗混战', camera_type: '广角', duration: 5 },
    { id: 'shot_impact', action: '挥剑击中铠甲，火星四溅', duration: 2 },
    { id: 'shot_ambient', scene: '宫殿夜色空镜', action: '风吹灯影', duration: 3 },
  ]);

  assert.deepEqual(
    plan.map((item) => ({ shotId: item.shotId, shotType: item.shotType })),
    [
      { shotId: 'shot_close', shotType: 'dialogue_closeup' },
      { shotId: 'shot_medium', shotType: 'dialogue_medium' },
      { shotId: 'shot_fight', shotType: 'fight_wide' },
      { shotId: 'shot_impact', shotType: 'insert_impact' },
      { shotId: 'shot_ambient', shotType: 'ambient_transition' },
    ]
  );
  assert.equal(plan[0].cameraSpec.moveType, 'subtle_push_in');
  assert.equal(plan[2].videoGenerationMode, 'sora2_image_to_video');
});

test('planMotion returns motion plan entries with required phase1 fields', async () => {
  const motionPlan = await planMotion([
    { id: 'shot_001', scene: '回廊', action: '停步转身', dialogue: '跟我来', duration: 3 },
  ]);

  assert.equal(motionPlan.length, 1);
  assert.deepEqual(Object.keys(motionPlan[0]), [
    'shotId',
    'order',
    'shotType',
    'durationTargetSec',
    'cameraIntent',
    'cameraSpec',
    'videoGenerationMode',
    'visualGoal',
  ]);
});
