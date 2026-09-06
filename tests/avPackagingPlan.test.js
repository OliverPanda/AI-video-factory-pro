import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildAvPackagingPlan } from '../src/domain/avPackagingPlan.js';
import { runAvPackaging } from '../src/agents/avPackagingAgent.js';

function makeShots() {
  return [
    {
      id: 'shot_001',
      action: '黑衣人拔刀冲上，刀锋擦出火花',
      dialogue: '别过来',
      durationSec: 2,
      subtitleTone: 'dramatic',
    },
    {
      id: 'shot_002',
      action: '他被重击撞到墙上，局势突然陷入危机',
      durationSec: 3,
      audioMood: 'suspense',
    },
    {
      id: 'shot_003',
      action: '她松了一口气，声音变得温柔',
      durationSec: 4,
      audioMood: 'warm',
    },
  ];
}

test('buildAvPackagingPlan warns without optional BGM or SFX assets but does not block', () => {
  const plan = buildAvPackagingPlan({
    shots: makeShots(),
    options: { assets: {} },
  });

  assert.equal(plan.schemaVersion, 'av-packaging-plan.v1');
  assert.equal(plan.warnings.some((warning) => warning.code === 'audio_assets_missing'), true);
  assert.equal(plan.warnings.every((warning) => warning.blocking === false), true);
  assert.ok(plan.sfxCues.length > 0);
  assert.ok(plan.bgmCues.length > 0);
});

test('buildAvPackagingPlan generates subtitle style profile', () => {
  const plan = buildAvPackagingPlan({
    shots: makeShots(),
    options: {
      subtitleTone: 'dramatic',
      subtitleStyleProfile: {
        fontFamily: 'Noto Sans CJK SC',
      },
    },
  });

  assert.equal(plan.subtitleStyleProfile.format, 'ass');
  assert.equal(plan.subtitleStyleProfile.stylePreset, 'short_drama_dramatic');
  assert.equal(plan.subtitleStyleProfile.fontFamily, 'Noto Sans CJK SC');
  assert.equal(plan.subtitleStyleProfile.fontSize, 56);
  assert.deepEqual(plan.subtitleStyle, plan.subtitleStyleProfile);
});

test('buildAvPackagingPlan creates sword and impact SFX cues for fight sequence', () => {
  const plan = buildAvPackagingPlan({
    shots: makeShots(),
    sequenceClips: [
      {
        sequenceId: 'seq_fight_001',
        sequenceType: 'fight_exchange_sequence',
        sequenceGoal: '保持连续打斗和刀锋冲击',
        coveredShotIds: ['shot_001', 'shot_002'],
      },
    ],
    options: {
      assets: {
        sfx: [
          { assetId: 'sword_whoosh_fast', path: 'assets/audio/sfx/sword.wav', kind: 'sword' },
          { assetId: 'impact_heavy', path: 'assets/audio/sfx/impact.wav', kind: 'impact' },
        ],
      },
    },
  });

  assert.equal(plan.sfxCues.some((cue) => cue.sfxType === 'sword'), true);
  assert.equal(plan.sfxCues.some((cue) => cue.sfxType === 'impact'), true);
  assert.equal(plan.rhythmCues.some((cue) => cue.type === 'impact'), true);
});

test('buildAvPackagingPlan creates BGM cues when emotion changes', () => {
  const plan = buildAvPackagingPlan({
    shots: makeShots(),
    options: {
      assets: {
        bgm: [
          { assetId: 'suspense_loop', path: 'assets/audio/bgm/suspense.mp3', mood: 'suspense' },
          { assetId: 'warm_pad', path: 'assets/audio/bgm/warm.mp3', mood: 'warm' },
        ],
      },
    },
  });

  assert.ok(plan.bgmCues.length >= 2);
  assert.deepEqual(
    plan.bgmCues.map((cue) => cue.mood),
    ['suspense', 'warm']
  );
  assert.equal(plan.bgmCues.every((cue) => cue.duckingHint === 'dialogue_priority'), true);
});

test('buildAvPackagingPlan warns when configured local audio asset paths are missing', () => {
  const missingPath = path.join(os.tmpdir(), 'aivf-missing-audio-asset.mp3');
  const plan = buildAvPackagingPlan({
    shots: makeShots(),
    options: {
      assets: {
        bgm: [{ assetId: 'suspense_loop', path: missingPath, mood: 'suspense' }],
        sfx: [{ assetId: 'sword_whoosh_fast', path: missingPath, kind: 'sword' }],
      },
    },
  });

  assert.equal(plan.bgmCues.some((cue) => cue.path === missingPath && cue.assetExists === false), true);
  assert.equal(plan.sfxCues.some((cue) => cue.path === missingPath && cue.assetExists === false), true);
  assert.equal(plan.warnings.some((warning) => warning.code === 'bgm_asset_missing'), true);
  assert.equal(plan.warnings.some((warning) => warning.code === 'sfx_asset_missing'), true);
  assert.equal(plan.warnings.every((warning) => warning.blocking === false), true);
});

test('buildAvPackagingPlan emits lipsync over sequence over bridge priority hints', () => {
  const plan = buildAvPackagingPlan({
    shots: makeShots(),
    lipsyncReport: {
      completedShotIds: ['shot_001'],
    },
    sequenceClips: [{ sequenceId: 'seq_001', coveredShotIds: ['shot_001', 'shot_002'] }],
    bridgeClips: [{ bridgeId: 'bridge_001', fromShotId: 'shot_002', toShotId: 'shot_003' }],
  });

  const priorities = plan.priorityHints.map((hint) => hint.priority);
  assert.deepEqual(priorities, [...priorities].sort((left, right) => right - left));
  assert.equal(plan.priorityHints.find((hint) => hint.kind === 'lipsync')?.priority, 100);
  assert.equal(plan.priorityHints.find((hint) => hint.kind === 'sequence')?.priority, 70);
  assert.equal(plan.priorityHints.find((hint) => hint.kind === 'bridge')?.priority, 30);
});

test('runAvPackaging writes complete artifacts metrics manifest and qa summary', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-av-packaging-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactContext = {
    outputsDir: path.join(tempRoot, '1-outputs'),
    metricsDir: path.join(tempRoot, '2-metrics'),
    manifestPath: path.join(tempRoot, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

  const plan = await runAvPackaging(
    {
      runId: 'run_av_001',
      shots: makeShots(),
      audioResults: [{ shotId: 'shot_001', audioPath: 'audio/shot_001.mp3' }],
      ttsQaReport: { status: 'pass' },
      lipsyncReport: { completedShotIds: ['shot_001'] },
      sequenceClips: [{ sequenceId: 'seq_001', coveredShotIds: ['shot_001', 'shot_002'] }],
      bridgeClips: [{ bridgeId: 'bridge_001', fromShotId: 'shot_002', toShotId: 'shot_003' }],
      options: { assets: {} },
    },
    { artifactContext }
  );

  assert.equal(plan.runId, 'run_av_001');
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'av-packaging-plan.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'av-packaging-plan.md')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'av-packaging-metrics.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'qa-summary.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'qa-summary.md')), true);
  assert.equal(fs.existsSync(artifactContext.manifestPath), true);

  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
  assert.deepEqual(manifest.outputFiles, [
    'av-packaging-plan.json',
    'av-packaging-plan.md',
    'av-packaging-metrics.json',
  ]);
});
