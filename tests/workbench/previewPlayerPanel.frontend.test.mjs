import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPreviewPlayerErrorState } from '../../views/src/components/review/PreviewPlayerPanelState.ts';

test('buildPreviewPlayerErrorState returns friendly message and artifact link when video load fails', () => {
  const review = {
    runId: 'run_latest',
    projectId: 'project_demo',
    projectTitle: '演示项目',
    scriptId: 'script_demo',
    scriptTitle: '第一季',
    episodeId: 'episode_demo',
    episodeTitle: '第一集',
    status: 'warn',
    createdAt: '2026-06-20T08:00:00.000Z',
    finalVideoUrl: '/artifacts/run_latest/final.mp4',
    artifactRunDir: 'artifacts/run_latest',
    reviewSummary: {
      status: 'warn',
      totalFindings: 1,
      blockingFindings: 0,
      taskCount: 0,
      manualTaskCount: 0,
    },
    findings: [],
    tasks: [],
  };

  assert.deepEqual(buildPreviewPlayerErrorState(review, 'HTTP 404'), {
    message: '无法加载成片视频',
    detail: 'HTTP 404',
    artifactHref: '/artifacts/run_latest',
    artifactLabel: '查看 Artifact',
  });
});
