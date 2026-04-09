import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, runSequenceQa } from '../src/agents/sequenceQaAgent.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-sequence-qa-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('runSequenceQa passes a readable mp4-like clip with non-zero duration and covered shot ids', async () => {
  await withTempRoot(async (tempRoot) => {
    const videoPath = path.join(tempRoot, 'sequence-pass.mp4');
    fs.writeFileSync(videoPath, 'sequence-video');

    const report = await runSequenceQa(
      [
        {
          sequenceId: 'seq_pass',
          status: 'completed',
          provider: 'runway',
          model: 'gen4_turbo',
          videoPath,
          coveredShotIds: ['shot_001', 'shot_002'],
          targetDurationSec: 4,
          actualDurationSec: 4.1,
          failureCategory: null,
          error: null,
        },
      ],
      {
        videoResults: [{ shotId: 'shot_001' }],
        bridgeClipResults: [{ bridgeId: 'bridge_001' }],
        referenceContext: {
          sequenceId: 'seq_pass',
          shotIds: ['shot_001', 'shot_002'],
        },
        probeVideo: async () => ({ durationSec: 4.1 }),
        evaluateSequenceContinuity: async () => ({
          entryExitCheck: 'pass',
          continuityCheck: 'pass',
        }),
      }
    );

    assert.equal(report.status, 'pass');
    assert.equal(report.passedCount, 1);
    assert.equal(report.fallbackCount, 0);
    assert.equal(report.entries[0].finalDecision, 'pass');
    assert.deepEqual(report.entries[0].coveredShotIds, ['shot_001', 'shot_002']);
    assert.equal(report.entries[0].engineCheck, 'pass');
    assert.equal(report.entries[0].durationCheck, 'pass');
    assert.equal(report.entries[0].entryExitCheck, 'pass');
    assert.equal(report.entries[0].continuityCheck, 'pass');
  });
});

test('runSequenceQa fails empty files pseudo files and abnormal durations', async () => {
  await withTempRoot(async (tempRoot) => {
    const emptyPath = path.join(tempRoot, 'empty.mp4');
    const pseudoPath = path.join(tempRoot, 'pseudo.mp4');
    const badDurationPath = path.join(tempRoot, 'bad-duration.mp4');
    fs.writeFileSync(emptyPath, '');
    fs.writeFileSync(pseudoPath, 'not-a-real-mp4');
    fs.writeFileSync(badDurationPath, 'sequence-video');

    const report = await runSequenceQa(
      [
        {
          sequenceId: 'seq_empty',
          status: 'completed',
          provider: 'runway',
          model: 'gen4_turbo',
          videoPath: emptyPath,
          coveredShotIds: ['shot_010', 'shot_011'],
          targetDurationSec: 4,
          actualDurationSec: 0,
          failureCategory: null,
          error: null,
        },
        {
          sequenceId: 'seq_pseudo',
          status: 'completed',
          provider: 'runway',
          model: 'gen4_turbo',
          videoPath: pseudoPath,
          coveredShotIds: ['shot_012', 'shot_013'],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
        {
          sequenceId: 'seq_duration',
          status: 'completed',
          provider: 'runway',
          model: 'gen4_turbo',
          videoPath: badDurationPath,
          coveredShotIds: ['shot_014', 'shot_015'],
          targetDurationSec: 4,
          actualDurationSec: 20,
          failureCategory: null,
          error: null,
        },
      ],
      {
        probeVideo: async (videoPath) => {
          if (videoPath === pseudoPath) {
            throw new Error('ffprobe parse failed');
          }
          return { durationSec: 20 };
        },
        evaluateSequenceContinuity: async () => ({
          entryExitCheck: 'pass',
          continuityCheck: 'pass',
        }),
      }
    );

    assert.equal(report.entries[0].engineCheck, 'fail');
    assert.equal(report.entries[0].finalDecision, 'fail');
    assert.equal(report.entries[0].qaFailureCategory, 'provider_output_invalid');
    assert.equal(report.entries[0].recommendedAction, 'retry_or_regenerate_provider_output');
    assert.equal(report.entries[1].engineCheck, 'fail');
    assert.equal(report.entries[1].finalDecision, 'fail');
    assert.equal(report.entries[1].qaFailureCategory, 'provider_output_invalid');
    assert.equal(report.entries[1].recommendedAction, 'retry_or_regenerate_provider_output');
    assert.equal(report.entries[2].durationCheck, 'fail');
    assert.equal(report.entries[2].finalDecision, 'fail');
    assert.equal(report.entries[2].qaFailureCategory, 'duration_mismatch');
    assert.equal(report.entries[2].recommendedAction, 'adjust_duration_or_regenerate');
  });
});

test('runSequenceQa allows modest duration compression for long multi-shot sequences', async () => {
  await withTempRoot(async (tempRoot) => {
    const videoPath = path.join(tempRoot, 'sequence-compressed.mp4');
    fs.writeFileSync(videoPath, 'sequence-video');

    const report = await runSequenceQa(
      [
        {
          sequenceId: 'seq_compressed',
          status: 'completed',
          provider: 'sora2',
          model: 'veo3.1-fast',
          videoPath,
          coveredShotIds: ['shot_101', 'shot_102', 'shot_103'],
          targetDurationSec: 12,
          actualDurationSec: 8,
          failureCategory: null,
          error: null,
        },
      ],
      {
        probeVideo: async () => ({ durationSec: 8 }),
        evaluateSequenceContinuity: async () => ({
          entryExitCheck: 'pass',
          continuityCheck: 'pass',
        }),
      }
    );

    assert.equal(report.status, 'pass');
    assert.equal(report.entries[0].durationCheck, 'pass');
    assert.equal(report.entries[0].finalDecision, 'pass');
  });
});

test('runSequenceQa fails sequence clips whose coveredShotIds are too short duplicated or missing', async () => {
  await withTempRoot(async (tempRoot) => {
    const validVideoPath = path.join(tempRoot, 'invalid-coverage.mp4');
    fs.writeFileSync(validVideoPath, 'sequence-video');

    const report = await runSequenceQa(
      [
        {
          sequenceId: 'seq_single_shot',
          status: 'completed',
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
          videoPath: validVideoPath,
          coveredShotIds: ['shot_100'],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
        {
          sequenceId: 'seq_duplicate_shots',
          status: 'completed',
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
          videoPath: validVideoPath,
          coveredShotIds: ['shot_101', 'shot_101'],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
        {
          sequenceId: 'seq_missing_coverage',
          status: 'completed',
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
          videoPath: validVideoPath,
          coveredShotIds: [],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
      ],
      {
        probeVideo: async () => ({ durationSec: 4 }),
        evaluateSequenceContinuity: async () => ({
          entryExitCheck: 'pass',
          continuityCheck: 'pass',
        }),
      }
    );

    assert.equal(report.entries[0].engineCheck, 'fail');
    assert.equal(report.entries[0].finalDecision, 'fail');
    assert.equal(report.entries[0].qaFailureCategory, 'coverage_invalid');
    assert.equal(report.entries[0].recommendedAction, 'fix_sequence_coverage_or_route_back_to_shots');
    assert.match(report.entries[0].notes, /invalid_coverage_range/);
    assert.equal(report.entries[1].engineCheck, 'fail');
    assert.equal(report.entries[1].finalDecision, 'fail');
    assert.equal(report.entries[1].qaFailureCategory, 'coverage_invalid');
    assert.match(report.entries[1].notes, /invalid_coverage_range/);
    assert.equal(report.entries[2].engineCheck, 'fail');
    assert.equal(report.entries[2].finalDecision, 'fail');
    assert.equal(report.entries[2].qaFailureCategory, 'coverage_invalid');
    assert.match(report.entries[2].notes, /invalid_coverage_range/);
  });
});

test('runSequenceQa falls back when coveredShotIds are not contiguous in source shot order', async () => {
  await withTempRoot(async (tempRoot) => {
    const videoPath = path.join(tempRoot, 'non-contiguous.mp4');
    fs.writeFileSync(videoPath, 'sequence-video');

    const report = await runSequenceQa(
      [
        {
          sequenceId: 'seq_non_contiguous',
          status: 'completed',
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
          videoPath,
          coveredShotIds: ['shot_001', 'shot_003'],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
      ],
      {
        shots: [
          { id: 'shot_001' },
          { id: 'shot_002' },
          { id: 'shot_003' },
        ],
        probeVideo: async () => ({ durationSec: 4 }),
        evaluateSequenceContinuity: async () => ({
          entryExitCheck: 'pass',
          continuityCheck: 'pass',
        }),
      }
    );

    assert.equal(report.entries[0].engineCheck, 'pass');
    assert.equal(report.entries[0].continuityCheck, 'fail');
    assert.equal(report.entries[0].finalDecision, 'fallback_to_shot_path');
    assert.equal(report.entries[0].fallbackAction, 'fallback_to_shot_path');
    assert.equal(report.entries[0].qaFailureCategory, 'continuity_mismatch');
    assert.equal(report.entries[0].recommendedAction, 'fallback_to_shots_or_add_bridge_context');
    assert.match(report.entries[0].notes, /non_contiguous_coverage/);
  });
});

test('runSequenceQa fails when entryExitCheck fails and falls back when continuityCheck fails', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = {
      outputsDir: path.join(tempRoot, '1-outputs'),
      metricsDir: path.join(tempRoot, '2-metrics'),
      manifestPath: path.join(tempRoot, 'manifest.json'),
    };
    fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
    fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

    const entryExitPath = path.join(tempRoot, 'entry-exit.mp4');
    const continuityPath = path.join(tempRoot, 'continuity.mp4');
    const manualReviewPath = path.join(tempRoot, 'manual-review.mp4');
    fs.writeFileSync(entryExitPath, 'sequence-video');
    fs.writeFileSync(continuityPath, 'sequence-video');
    fs.writeFileSync(manualReviewPath, 'sequence-video');

    const report = await runSequenceQa(
      [
        {
          sequenceId: 'seq_entry_exit',
          status: 'completed',
          provider: 'runway',
          model: 'gen4_turbo',
          videoPath: entryExitPath,
          coveredShotIds: ['shot_020', 'shot_021'],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
        {
          sequenceId: 'seq_continuity',
          status: 'completed',
          provider: 'runway',
          model: 'gen4_turbo',
          videoPath: continuityPath,
          coveredShotIds: ['shot_022', 'shot_023'],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
        {
          sequenceId: 'seq_manual_review',
          status: 'completed',
          provider: 'runway',
          model: 'gen4_turbo',
          videoPath: manualReviewPath,
          coveredShotIds: ['shot_024', 'shot_025'],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
      ],
      {
        artifactContext,
        probeVideo: async () => ({ durationSec: 4 }),
        evaluateSequenceContinuity: async (result) => {
          if (result.sequenceId === 'seq_entry_exit') {
            return {
              entryExitCheck: 'fail',
              continuityCheck: 'pass',
            };
          }
          if (result.sequenceId === 'seq_manual_review') {
            return {
              entryExitCheck: 'warn',
              continuityCheck: 'pass',
            };
          }
          return {
            entryExitCheck: 'pass',
            continuityCheck: 'fail',
          };
        },
      }
    );

    assert.equal(report.entries[0].finalDecision, 'fail');
    assert.equal(report.entries[0].fallbackAction, 'none');
    assert.equal(report.entries[0].qaFailureCategory, 'entry_exit_mismatch');
    assert.equal(report.entries[0].recommendedAction, 'tighten_entry_exit_constraints');
    assert.equal(report.entries[1].finalDecision, 'fallback_to_shot_path');
    assert.equal(report.entries[1].fallbackAction, 'fallback_to_shot_path');
    assert.equal(report.entries[1].qaFailureCategory, 'continuity_mismatch');
    assert.equal(report.entries[1].recommendedAction, 'fallback_to_shots_or_add_bridge_context');
    assert.equal(report.entries[2].finalDecision, 'manual_review');
    assert.equal(report.entries[2].fallbackAction, 'manual_review');
    assert.equal(report.entries[2].qaFailureCategory, 'manual_review_needed');
    assert.equal(report.entries[2].recommendedAction, 'manual_review_and_select_best_variant');
    assert.equal(report.fallbackCount, 1);
    assert.equal(report.manualReviewCount, 1);
    assert.equal(report.topFailureCategory, 'entry_exit_mismatch');
    assert.equal(report.topRecommendedAction, 'tighten_entry_exit_constraints');
    assert.equal(report.actionBreakdown.tighten_entry_exit_constraints, 1);
    assert.equal(report.actionBreakdown.fallback_to_shots_or_add_bridge_context, 1);
    assert.equal(report.actionBreakdown.manual_review_and_select_best_variant, 1);
    assert.deepEqual(report.fallbackSequenceIds, ['seq_continuity']);
    assert.deepEqual(report.manualReviewSequenceIds, ['seq_manual_review']);
    assert.equal(report.warnings.some((warning) => warning.includes('seq_continuity')), true);

    const qaSummary = fs.readFileSync(path.join(artifactContext.outputsDir, 'qa-summary.md'), 'utf-8');
    assert.equal(qaSummary.includes('回退到 shot path'), true);
    assert.equal(qaSummary.includes('人工复核'), true);
    assert.equal(qaSummary.includes('主要失败类型'), true);
    assert.equal(qaSummary.includes('entry_exit_mismatch'), true);
  });
});

test('runSequenceQa sends soft entry-exit mismatches to manual review instead of hard fail', async () => {
  await withTempRoot(async (tempRoot) => {
    const videoPath = path.join(tempRoot, 'soft-entry-exit.mp4');
    fs.writeFileSync(videoPath, 'sequence-video');

    const [entry] = await __testables.evaluateSequenceClips(
      [
        {
          sequenceId: 'seq_soft_entry_exit',
          status: 'completed',
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
          videoPath,
          coveredShotIds: ['shot_050', 'shot_051'],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
      ],
      {
        probeVideo: async () => ({ durationSec: 4 }),
        evaluateSequenceContinuity: async () => ({
          entryExitCheck: 'fail',
          continuityCheck: 'pass',
          entryExitDecisionReason: 'weak_exit_anchor',
        }),
      }
    );

    assert.equal(entry.finalDecision, 'manual_review');
    assert.equal(entry.fallbackAction, 'manual_review');
    assert.equal(entry.qaFailureCategory, 'manual_review_needed');
    assert.equal(entry.recommendedAction, 'manual_review_and_select_best_variant');
    assert.match(entry.notes, /weak_exit_anchor/);
  });
});

test('runSequenceQa classifies continuity evaluator failures separately from ffprobe failures', async () => {
  await withTempRoot(async (tempRoot) => {
    const videoPath = path.join(tempRoot, 'continuity-failure.mp4');
    fs.writeFileSync(videoPath, 'sequence-video');

    const [entry] = await __testables.evaluateSequenceClips(
      [
        {
          sequenceId: 'seq_eval_fail',
          status: 'completed',
          provider: 'runway',
          model: 'gen4_turbo',
          videoPath,
          coveredShotIds: ['shot_040', 'shot_041'],
          targetDurationSec: 4,
          actualDurationSec: 4,
          failureCategory: null,
          error: null,
        },
      ],
      {
        probeVideo: async () => ({ durationSec: 4 }),
        evaluateSequenceContinuity: async () => {
          throw new Error('continuity evaluator offline');
        },
      }
    );

    assert.equal(entry.engineCheck, 'pass');
    assert.equal(entry.continuityCheck, 'error');
    assert.equal(entry.finalDecision, 'fail');
    assert.equal(entry.fallbackAction, 'none');
    assert.equal(entry.qaFailureCategory, 'quality_evaluator_error');
    assert.equal(entry.recommendedAction, 'inspect_qa_runtime_and_retry');
    assert.equal(entry.notes.includes('continuity_evaluator_failed'), true);
    assert.equal(entry.notes.includes('ffprobe_failed'), false);
  });
});

test('runSequenceQa writes report metrics manifest and qa summary artifacts', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-sequence-qa-artifact-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const artifactContext = {
    outputsDir: path.join(tempRoot, '1-outputs'),
    metricsDir: path.join(tempRoot, '2-metrics'),
    manifestPath: path.join(tempRoot, 'manifest.json'),
  };
  fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
  fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

  const videoPath = path.join(tempRoot, 'sequence-artifact.mp4');
  fs.writeFileSync(videoPath, 'sequence-video');

  const report = await runSequenceQa(
    [
      {
        sequenceId: 'seq_artifact',
        status: 'completed',
        provider: 'runway',
        model: 'gen4_turbo',
        videoPath,
        coveredShotIds: ['shot_030', 'shot_031'],
        targetDurationSec: 4,
        actualDurationSec: 4,
        failureCategory: null,
        error: null,
      },
    ],
    {
      artifactContext,
      actionSequencePackages: [
        {
          sequenceId: 'seq_artifact',
          referenceStrategy: 'video_first',
          sequenceContextSummary: 'sequence type: fight_exchange_sequence | shot coverage: shot_030 -> shot_031',
          providerRequestHints: { referenceTier: 'video', referenceCount: 2 },
        },
      ],
      probeVideo: async () => ({ durationSec: 4 }),
      evaluateSequenceContinuity: async () => ({
        entryExitCheck: 'pass',
        continuityCheck: 'pass',
      }),
    }
  );

  assert.equal(report.passedCount, 1);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'sequence-qa-report.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'sequence-qa-context.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'fallback-sequence-paths.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'sequence-qa-report.md')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'manual-review-sequences.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'sequence-qa-metrics.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'qa-summary.md')), true);
  const context = JSON.parse(fs.readFileSync(path.join(artifactContext.outputsDir, 'sequence-qa-context.json'), 'utf-8'));
  assert.equal(context[0].referenceStrategy, 'video_first');
  assert.equal(context[0].referenceTier, 'video');
  assert.equal(context[0].finalDecision, 'pass');
  assert.equal(context[0].qaFailureCategory, 'passed');
  assert.equal(context[0].recommendedAction, 'keep_sequence_in_main_timeline');
  const markdown = fs.readFileSync(path.join(artifactContext.outputsDir, 'sequence-qa-report.md'), 'utf-8');
  assert.match(markdown, /video_first/);
  assert.match(markdown, /fight_exchange_sequence/);
  assert.match(markdown, /passed/);
  assert.match(markdown, /keep_sequence_in_main_timeline/);
  const metrics = JSON.parse(fs.readFileSync(path.join(artifactContext.metricsDir, 'sequence-qa-metrics.json'), 'utf-8'));
  assert.equal(metrics.topFailureCategory, 'passed');
  assert.equal(metrics.topRecommendedAction, 'keep_sequence_in_main_timeline');
  assert.equal(metrics.actionBreakdown.keep_sequence_in_main_timeline, 1);
  assert.deepEqual(metrics.fallbackSequenceIds, []);
  assert.deepEqual(metrics.manualReviewSequenceIds, []);
  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  assert.equal(manifest.status, 'completed');
  assert.deepEqual(manifest.outputFiles, [
    'sequence-qa-report.json',
    'sequence-qa-context.json',
    'fallback-sequence-paths.json',
    'manual-review-sequences.json',
    'sequence-qa-metrics.json',
    'sequence-qa-report.md',
  ]);
});
