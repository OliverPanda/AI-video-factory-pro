import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { runContinuityCheck } from '../src/agents/continuityChecker.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-continuity-artifacts-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('continuity checker writes reports flagged transitions metrics and manifest', async () => {
  await withTempRoot(async (tempRoot) => {
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
    assert.deepEqual(report, [
      {
        previousShotId: 'shot_001',
        shotId: 'shot_002',
        continuityScore: 6,
        violations: ['camera axis drift'],
        repairHints: ['keep characters on original screen sides'],
      },
    ]);

    const flagged = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.continuityChecker.outputsDir, 'flagged-transitions.json'), 'utf-8')
    );
    assert.deepEqual(flagged, [
      {
        previousShotId: 'shot_001',
        shotId: 'shot_002',
        continuityScore: 6,
        violations: ['camera axis drift'],
        repairHints: ['keep characters on original screen sides'],
      },
    ]);

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
    });

    const manifest = JSON.parse(fs.readFileSync(ctx.agents.continuityChecker.manifestPath, 'utf-8'));
    assert.deepEqual(manifest, {
      status: 'completed_with_errors',
      checkedTransitionCount: 1,
      flaggedTransitionCount: 1,
      outputFiles: [
        'continuity-report.json',
        'flagged-transitions.json',
        'continuity-report.md',
        'continuity-metrics.json',
      ],
    });
  });
});
