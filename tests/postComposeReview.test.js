import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildPostComposeReview } from '../src/domain/postComposeReview.js';
import { runPostComposeReview } from '../src/agents/postComposeReviewAgent.js';

function baseInput(overrides = {}) {
  return {
    projectId: 'happyhorse',
    runId: 'run_post_001',
    composeResult: {
      finalVideoPath: 'outputs/final.mp4',
      status: 'completed',
    },
    composePlan: {
      path: 'artifacts/compose-plan.json',
      timeline: [
        { type: 'shot', id: 'shot_001', shotId: 'shot_001', clipPath: 'clips/shot_001.mp4', startMs: 0, endMs: 3000 },
        { type: 'sequence', id: 'seq_001', sequenceId: 'seq_001', startMs: 3000, endMs: 8000 },
        { type: 'bridge', id: 'bridge_001', bridgeId: 'bridge_001', startMs: 8000, endMs: 10000 },
      ],
    },
    shotQaReport: { status: 'pass', items: [] },
    bridgeQaReport: { status: 'pass', items: [] },
    sequenceQaReport: { status: 'pass', items: [] },
    ttsQaReport: { status: 'pass', items: [] },
    lipsyncReport: { status: 'pass', items: [] },
    crossVideoConsistencyReport: { status: 'pass', reviewItems: [] },
    avPackagingPlan: { warnings: [] },
    costGovernanceReport: { status: 'pass', warnings: [], blockers: [] },
    ...overrides,
  };
}

test('TTS warning creates audio packaging edit task without provider execution', () => {
  const input = baseInput({
    ttsQaReport: {
      status: 'warn',
      warnings: [{ shotId: 'shot_001', code: 'low_volume', message: 'voice is too quiet' }],
    },
  });
  const before = structuredClone(input);

  const review = buildPostComposeReview(input);

  assert.equal(review.editTaskPack.executionMode, 'manual_only');
  assert.equal(review.editTaskPack.manualExecutionRequired, true);
  assert.equal(
    review.editTaskPack.tasks.some((task) => ['adjust_audio_packaging', 'manual_review'].includes(task.action)),
    true
  );
  assert.deepEqual(input, before);
});

test('shot QA failure creates regenerate_shot task', () => {
  const review = buildPostComposeReview(
    baseInput({
      shotQaReport: {
        status: 'fail',
        failures: [{ shotId: 'shot_001', message: 'blurred frame', severity: 'blocker' }],
      },
    })
  );

  const task = review.editTaskPack.tasks.find((item) => item.action === 'regenerate_shot');
  assert.equal(task.targetRef.type, 'shot');
  assert.equal(task.targetRef.id, 'shot_001');
  assert.equal(task.approvalRequired, true);
  assert.ok(task.idempotencyKey.includes('regenerate_shot:shot_001'));
});

test('sequence QA manual review creates sequence regeneration or manual review task', () => {
  const review = buildPostComposeReview(
    baseInput({
      sequenceQaReport: {
        status: 'manual_review',
        items: [{ sequenceId: 'seq_001', status: 'manual_review', message: 'entrance pose uncertain' }],
      },
    })
  );

  assert.equal(
    review.editTaskPack.tasks.some(
      (task) =>
        ['regenerate_sequence', 'manual_review'].includes(task.action) &&
        task.targetRef.type === 'sequence' &&
        task.targetRef.id === 'seq_001'
    ),
    true
  );
});

test('compose static fallback creates replace_clip or regenerate_shot task', () => {
  const review = buildPostComposeReview(
    baseInput({
      composePlan: {
        path: 'artifacts/compose-plan.json',
        timeline: [
          {
            type: 'shot',
            id: 'shot_002',
            shotId: 'shot_002',
            sourceType: 'static_image_fallback',
            fallbackReason: 'provider timeout',
            startMs: 0,
            endMs: 3000,
          },
        ],
      },
    })
  );

  assert.equal(
    review.editTaskPack.tasks.some(
      (task) => ['replace_clip', 'regenerate_shot'].includes(task.action) && task.targetRef.id === 'shot_002'
    ),
    true
  );
});

test('composer array compose plan creates timeline-aware edit task', () => {
  const review = buildPostComposeReview(
    baseInput({
      composePlan: [
        {
          visualType: 'static_image',
          shotId: 'shot_002',
          imagePath: 'frames/shot_002.png',
          fallbackReason: 'missing video clip',
          duration: 3,
          startSec: 4,
          endSec: 7,
        },
      ],
    })
  );

  const task = review.editTaskPack.tasks.find((item) => item.targetRef.id === 'shot_002');
  assert.equal(['replace_clip', 'regenerate_shot'].includes(task.action), true);
  assert.equal(task.targetRef.timelineStartMs, 4000);
  assert.equal(task.targetRef.timelineEndMs, 7000);
});

test('clean inputs approve without human review items', () => {
  const review = buildPostComposeReview(baseInput());

  assert.equal(review.report.status, 'approved');
  assert.equal(review.editTaskPack.reviewSummary.status, 'approved');
  assert.equal(review.editTaskPack.tasks.some((task) => task.action === 'approve'), true);
  assert.equal(review.editTaskPack.humanReview.items.length, 0);
});

test('null upstream reports are treated as missing evidence instead of crashing', () => {
  const review = buildPostComposeReview(
    baseInput({
      shotQaReport: null,
      bridgeQaReport: null,
      sequenceQaReport: null,
      ttsQaReport: null,
      lipsyncReport: null,
      crossVideoConsistencyReport: null,
      avPackagingPlan: null,
      costGovernanceReport: null,
    })
  );

  assert.equal(review.report.status, 'approved');
  assert.equal(review.editTaskPack.tasks.some((task) => task.action === 'approve'), true);
});

test('cross-video and cost governance review items become manual candidate tasks', () => {
  const review = buildPostComposeReview(
    baseInput({
      crossVideoConsistencyReport: {
        status: 'warn',
        reviewItems: [
          {
            clipId: 'seq_001',
            dimension: 'pose_mismatch',
            severity: 'warn',
            recommendedAction: 'regenerate_sequence',
            message: 'boundary pose mismatch',
          },
        ],
      },
      costGovernanceReport: {
        status: 'block',
        blockers: ['budget exhausted'],
      },
    })
  );

  assert.equal(review.editTaskPack.tasks.some((task) => task.action === 'regenerate_sequence'), true);
  assert.equal(review.editTaskPack.tasks.some((task) => ['manual_review', 'skip'].includes(task.action)), true);
  assert.equal(review.editTaskPack.tasks.every((task) => task.status !== 'executing'), true);
});

test('runPostComposeReview writes complete artifacts', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-post-compose-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactContext = {
    outputsDir: path.join(tempRoot, '1-outputs'),
    metricsDir: path.join(tempRoot, '2-metrics'),
    manifestPath: path.join(tempRoot, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

  const result = await runPostComposeReview(
    baseInput({
      shotQaReport: {
        status: 'fail',
        failures: [{ shotId: 'shot_001', message: 'blurred frame' }],
      },
    }),
    { artifactContext }
  );

  assert.equal(result.status, 'needs_review');
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'post-compose-review.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'post-compose-review.md')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'edit-task-pack.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'edit-task-pack.md')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'post-compose-review-metrics.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'qa-summary.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'qa-summary.md')), true);
  assert.equal(fs.existsSync(artifactContext.manifestPath), true);

  const pack = JSON.parse(fs.readFileSync(path.join(artifactContext.outputsDir, 'edit-task-pack.json'), 'utf-8'));
  assert.equal(pack.executionMode, 'manual_only');
  assert.equal(pack.manualExecutionRequired, true);
  assert.equal(pack.tasks.some((task) => task.action === 'regenerate_shot'), true);

  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed_with_warnings');
});
