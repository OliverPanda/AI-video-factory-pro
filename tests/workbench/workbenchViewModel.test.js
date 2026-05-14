import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkbenchViewModel } from '../../src/workbench/transformers/workbenchViewModel.js';

test('buildWorkbenchViewModel returns stable workbench contract', () => {
  const model = buildWorkbenchViewModel({
    runJobs: [
      {
        id: 'run_1',
        projectId: 'project_a',
        scriptId: 'script_a',
        episodeId: 'episode_a',
        scriptTitle: '测试脚本',
        episodeTitle: '第一集',
        status: 'completed',
        startedAt: '2026-05-01T10:00:00.000Z',
        finishedAt: '2026-05-01T10:03:00.000Z',
        agentTaskRuns: [],
        artifactRunDir: 'temp/projects/p_a/scripts/s_a/episodes/e_a/runs/r_a',
      },
    ],
    qaOverviewsByRunId: {
      run_1: {
        status: 'warn',
        releasable: true,
        headline: '本轮可继续交付',
        summary: '有 1 个提醒项',
        passCount: 6,
        warnCount: 1,
        blockCount: 0,
        agentSummaries: [],
      },
    },
    artifactSummariesByRunId: {
      run_1: {
        agentDirs: ['01-script-parser'],
        outputFiles: [],
      },
    },
  });

  assert.equal(model.summary.runCount, 1);
  assert.equal(model.currentRun.id, 'run_1');
  assert.equal(model.currentRun.qaOverview.status, 'warn');
  assert.ok(model.currentRun.stages.preproduction);
  assert.deepEqual(model.currentRun.artifactSummary.agentDirs, ['01-script-parser']);
});
