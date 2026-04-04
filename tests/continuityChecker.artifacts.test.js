import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { runContinuityCheck } from '../src/agents/continuityChecker.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { withManagedTempRoot } from './helpers/testArtifacts.js';

test('continuity checker writes reports flagged transitions metrics and manifest', async (t) => {
  await withManagedTempRoot(t, 'aivf-continuity-checker-artifacts', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_continuity_artifacts',
      startedAt: '2026-04-02T07:00:00.000Z',
    });

    const previousImagePath = path.join(tempRoot, 'shot_001.png');
    const currentImagePath = path.join(tempRoot, 'shot_002.png');
    fs.writeFileSync(previousImagePath, 'img-1');
    fs.writeFileSync(currentImagePath, 'img-2');

    const shots = [
      { id: 'shot_001', scene: '咖啡馆', action: '端起咖啡' },
      {
        id: 'shot_002',
        scene: '吧台',
        action: '递出咖啡',
        continuityState: {
          carryOverFromShotId: 'shot_001',
          sceneLighting: 'warm indoor morning',
          cameraAxis: 'screen_left_to_right',
          continuityRiskTags: ['prop continuity'],
        },
      },
    ];
    const imageResults = [
      { shotId: 'shot_001', imagePath: previousImagePath, success: true },
      { shotId: 'shot_002', imagePath: currentImagePath, success: true },
    ];

    const result = await runContinuityCheck(shots, imageResults, {
      threshold: 7,
      artifactContext: ctx.agents.continuityChecker,
      checkTransition: async (previousShot, currentShot) => ({
        previousShotId: previousShot.id,
        shotId: currentShot.id,
        continuityScore: 6,
        violations: ['camera axis drift'],
        repairHints: ['keep characters on original screen sides'],
      }),
    });

    assert.equal(result.reports.length, 1);
    assert.equal(result.flaggedTransitions.length, 1);

    const report = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.continuityChecker.outputsDir, 'continuity-report.json'), 'utf-8')
    );
    assert.equal(report.length, 1);
    assert.equal(report[0].previousShotId, 'shot_001');
    assert.equal(report[0].shotId, 'shot_002');
    assert.equal(report[0].continuityScore, 6);
    assert.equal(report[0].recommendedAction, 'regenerate_prompt_and_image');
    assert.deepEqual(report[0].repairHints, ['keep characters on original screen sides']);
    assert.deepEqual(report[0].hardViolations, []);
    assert.deepEqual(report[0].softWarnings, [
      {
        code: 'camera axis drift',
        severity: 'medium',
        message: 'camera axis drift',
      },
    ]);

    const flagged = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.continuityChecker.outputsDir, 'flagged-transitions.json'), 'utf-8')
    );
    assert.deepEqual(flagged, [
      {
        previousShotId: 'shot_001',
        shotId: 'shot_002',
        triggerSource: 'llm_score',
        hardViolationCodes: [],
        continuityScore: 6,
        violations: ['camera axis drift'],
        repairHints: ['keep characters on original screen sides'],
        recommendedAction: 'regenerate_prompt_and_image',
        repairMethod: 'prompt_regen',
        continuityTargets: ['camera axis drift'],
      },
    ]);

    const repairPlan = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.continuityChecker.outputsDir, 'repair-plan.json'), 'utf-8')
    );
    assert.deepEqual(repairPlan, [
      {
        shotId: 'shot_002',
        previousShotId: 'shot_001',
        recommendedAction: 'regenerate_prompt_and_image',
        repairMethod: 'prompt_regen',
        continuityTargets: ['camera axis drift'],
        repairHints: ['keep characters on original screen sides'],
      },
    ]);

    const repairAttempts = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.continuityChecker.outputsDir, 'repair-attempts.json'), 'utf-8')
    );
    assert.deepEqual(repairAttempts, []);

    const markdown = fs.readFileSync(
      path.join(ctx.agents.continuityChecker.outputsDir, 'continuity-report.md'),
      'utf-8'
    );
    assert.match(markdown, /# Continuity Report/);
    assert.match(markdown, /shot_001 -> shot_002/);

    const metrics = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.continuityChecker.metricsDir, 'continuity-metrics.json'), 'utf-8')
    );
    assert.deepEqual(metrics, {
      checked_transition_count: 1,
      flagged_transition_count: 1,
      avg_continuity_score: 6,
      hard_violation_count: 0,
      soft_warning_count: 1,
      hard_rule_fail_count: 0,
      llm_review_fail_count: 1,
      action_pass_count: 0,
      action_regenerate_count: 1,
      action_manual_review_count: 0,
    });

    const manifest = JSON.parse(fs.readFileSync(ctx.agents.continuityChecker.manifestPath, 'utf-8'));
    assert.deepEqual(manifest, {
      status: 'completed_with_errors',
      checkedTransitionCount: 1,
      flaggedTransitionCount: 1,
      outputFiles: [
        'continuity-report.json',
        'flagged-transitions.json',
        'repair-plan.json',
        'repair-attempts.json',
        'continuity-report.md',
        'continuity-metrics.json',
      ],
    });
  }, 'continuity-checker');
});
