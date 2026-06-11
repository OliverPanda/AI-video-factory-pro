import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { checkCrossVideoConsistency } from '../src/domain/crossVideoConsistency.js';
import { buildAvPackagingPlan } from '../src/domain/avPackagingPlan.js';
import { buildPostComposeReview } from '../src/domain/postComposeReview.js';

function happyHorseInput(overrides = {}) {
  return {
    projectKey: 'HappyHorse',
    videoMetadata: [
      {
        videoId: 'video_001',
        provider: 'happyhorse',
        firstShotId: 'shot_001',
        lastShotId: 'shot_001',
        characters: [{ id: 'hero', appearanceSummary: 'red cloak' }],
        scenes: [{ id: 'hall', location: 'main hall', lighting: 'warm' }],
        exitPose: 'standing',
        requiredReferenceIds: ['ref_hero'],
      },
      {
        videoId: 'video_002',
        provider: 'happyhorse',
        firstShotId: 'shot_002',
        lastShotId: 'shot_002',
        characters: [{ id: 'hero', appearanceSummary: 'red cloak' }],
        scenes: [{ id: 'hall', location: 'main hall', lighting: 'warm' }],
        entryPose: 'standing',
        requiredReferenceIds: ['ref_hero'],
      },
    ],
    contextMemory: {
      characters: [{ id: 'hero', appearanceSummary: 'red cloak' }],
      scenes: [{ id: 'hall', location: 'main hall', lighting: 'warm' }],
    },
    videoResults: [
      { shotId: 'shot_001', videoId: 'video_001', provider: 'happyhorse', referenceIds: ['ref_hero'] },
      { shotId: 'shot_002', videoId: 'video_002', provider: 'happyhorse', referenceIds: ['ref_hero'] },
    ],
    sequenceClipResults: [],
    bridgeClipResults: [],
    lipsyncResults: [],
    ...overrides,
  };
}

test('HappyHorse context memory is writable only for HappyHorse provider evidence', () => {
  const passReport = checkCrossVideoConsistency(happyHorseInput());
  assert.equal(passReport.contextMemoryPatch.writeAllowed, true);

  const blockReport = checkCrossVideoConsistency(
    happyHorseInput({
      videoProvider: 'seedance',
      videoResults: [
        { shotId: 'shot_001', videoId: 'video_001', provider: 'seedance', referenceIds: ['ref_hero'] },
        { shotId: 'shot_002', videoId: 'video_002', provider: 'seedance', referenceIds: ['ref_hero'] },
      ],
    })
  );
  assert.equal(blockReport.status, 'block');
  assert.equal(blockReport.contextMemoryPatch.writeAllowed, false);
  assert.equal(blockReport.contextMemoryPatch.reason, 'non_happyhorse_provider');
});

test('metadata-only Seedance provider evidence blocks HappyHorse memory writes', () => {
  const report = checkCrossVideoConsistency(
    happyHorseInput({
      videoResults: [
        { shotId: 'shot_001', videoId: 'video_001', referenceIds: ['ref_hero'] },
        { shotId: 'shot_002', videoId: 'video_002', referenceIds: ['ref_hero'] },
      ],
      videoMetadata: happyHorseInput().videoMetadata.map((item) => ({ ...item, provider: 'seedance' })),
    })
  );

  assert.equal(report.status, 'block');
  assert.equal(report.contextMemoryPatch.reason, 'non_happyhorse_provider');
});

test('configured but missing AV assets create non-blocking packaging warnings', () => {
  const missingPath = path.join(os.tmpdir(), 'aivf-missing-post-processing-asset.mp3');
  const plan = buildAvPackagingPlan({
    shots: [
      { id: 'shot_001', action: '拔刀冲击，气氛紧张', durationSec: 2, audioMood: 'suspense' },
    ],
    options: {
      assets: {
        bgm: [{ assetId: 'suspense_loop', path: missingPath, mood: 'suspense' }],
        sfx: [{ assetId: 'sword_whoosh', path: missingPath, kind: 'sword' }],
      },
    },
  });

  assert.equal(plan.warnings.some((warning) => warning.code === 'bgm_asset_missing'), true);
  assert.equal(plan.warnings.some((warning) => warning.code === 'sfx_asset_missing'), true);
  assert.equal(plan.warnings.every((warning) => warning.blocking === false), true);
  assert.equal(plan.bgmCues.some((cue) => cue.path === missingPath && cue.assetExists === false), true);
  assert.equal(plan.sfxCues.some((cue) => cue.path === missingPath && cue.assetExists === false), true);
});

test('post-compose review consumes composer array compose plan with timeline ranges', () => {
  const review = buildPostComposeReview({
    projectId: 'project_1',
    runId: 'run_1',
    composeResult: { status: 'completed', finalVideoPath: 'output/final.mp4' },
    composePlan: [
      {
        visualType: 'static_image',
        shotId: 'shot_002',
        imagePath: 'frames/shot_002.png',
        fallbackReason: 'missing generated video',
        startSec: 4,
        endSec: 7,
        duration: 3,
      },
    ],
    shotQaReport: { status: 'pass', items: [] },
    bridgeQaReport: { status: 'pass', items: [] },
    sequenceQaReport: { status: 'pass', items: [] },
    ttsQaReport: { status: 'pass', items: [] },
    lipsyncReport: { status: 'pass', items: [] },
    crossVideoConsistencyReport: { status: 'pass', reviewItems: [] },
    avPackagingPlan: { warnings: [] },
    costGovernanceReport: { status: 'pass', warnings: [], blockers: [] },
  });

  const task = review.editTaskPack.tasks.find((item) => item.targetRef.id === 'shot_002');
  assert.equal(task.action, 'replace_clip');
  assert.equal(task.targetRef.timelineStartMs, 4000);
  assert.equal(task.targetRef.timelineEndMs, 7000);
  assert.equal(review.editTaskPack.executionMode, 'manual_only');
  assert.equal(review.report.executionBoundary.automaticProviderCalls, false);
});
