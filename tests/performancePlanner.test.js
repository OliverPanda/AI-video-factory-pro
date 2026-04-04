import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, planPerformance } from '../src/agents/performancePlanner.js';

test('buildPerformancePlanEntry produces the minimum Phase 2 protocol fields', () => {
  const entry = __testables.buildPerformancePlanEntry({
    shotId: 'shot_001',
    order: 1,
    shotType: 'dialogue_medium',
    durationTargetSec: 4,
    cameraIntent: 'slow_push_in',
    visualGoal: '皇后冷眼逼问',
  });

  assert.deepEqual(entry, {
    shotId: 'shot_001',
    order: 1,
    performanceTemplate: 'emotion_push_in',
    subjectBlocking: [],
    actionBeatList: [],
    cameraMovePlan: {
      intent: 'slow_push_in',
      shotType: 'dialogue_medium',
    },
    motionIntensity: 'low',
    tempoCurve: 'steady',
    expressionCue: null,
    providerPromptDirectives: [],
    enhancementHints: [],
    generationTier: 'enhanced',
    variantCount: 2,
  });
});

test('buildPerformancePlan classifies Phase 2 templates from motion plan', () => {
  const plan = __testables.buildPerformancePlan([
    {
      shotId: 'shot_001',
      order: 0,
      shotType: 'dialogue_closeup',
      cameraIntent: 'subtle_push_in',
      visualGoal: '皇后冷眼逼问',
    },
    {
      shotId: 'shot_002',
      order: 1,
      shotType: 'dialogue_medium',
      cameraIntent: 'slow_dolly',
      visualGoal: '二人隔案对峙',
      participants: ['A', 'B'],
    },
    {
      shotId: 'shot_003',
      order: 2,
      shotType: 'insert_impact',
      cameraIntent: 'snap_in',
      visualGoal: '刀锋撞击火花四溅',
    },
    {
      shotId: 'shot_004',
      order: 3,
      shotType: 'fight_wide',
      cameraIntent: 'tracking_pan',
      visualGoal: '回廊中交锋',
    },
    {
      shotId: 'shot_005',
      order: 4,
      shotType: 'ambient_transition',
      cameraIntent: 'slow_drift',
      visualGoal: '殿前风雪掠过',
    },
  ]);

  assert.deepEqual(
    plan.map((entry) => [entry.shotId, entry.performanceTemplate]),
    [
      ['shot_001', 'dialogue_closeup_react'],
      ['shot_002', 'dialogue_two_shot_tension'],
      ['shot_003', 'fight_impact_insert'],
      ['shot_004', 'fight_exchange_medium'],
      ['shot_005', 'ambient_transition_motion'],
    ]
  );
});

test('buildPerformancePlan assigns generationTier and variantCount by template criticality', () => {
  const plan = __testables.buildPerformancePlan([
    {
      shotId: 'shot_001',
      shotType: 'dialogue_closeup',
      cameraIntent: 'subtle_push_in',
      visualGoal: '情绪爆点逼近',
    },
    {
      shotId: 'shot_002',
      shotType: 'insert_impact',
      cameraIntent: 'snap_in',
      visualGoal: '刀锋撞击',
    },
    {
      shotId: 'shot_003',
      shotType: 'ambient_transition',
      cameraIntent: 'slow_drift',
      visualGoal: '宫灯轻晃',
    },
  ]);

  assert.deepEqual(
    plan.map((entry) => [entry.shotId, entry.generationTier, entry.variantCount]),
    [
      ['shot_001', 'enhanced', 2],
      ['shot_002', 'hero', 3],
      ['shot_003', 'base', 1],
    ]
  );
});

test('planPerformance writes performance artifacts and metrics', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-performance-plan-'));

  try {
    const artifactContext = {
      outputsDir: path.join(tempDir, '1-outputs'),
      metricsDir: path.join(tempDir, '2-metrics'),
      manifestPath: path.join(tempDir, 'manifest.json'),
    };

    const plan = await planPerformance(
      [
        {
          shotId: 'shot_001',
          shotType: 'dialogue_closeup',
          cameraIntent: 'subtle_push_in',
          visualGoal: '皇后冷眼逼问',
        },
      ],
      { artifactContext }
    );

    assert.equal(plan.length, 1);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'performance-plan.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'performance-plan-metrics.json')), true);
    assert.equal(fs.existsSync(artifactContext.manifestPath), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
