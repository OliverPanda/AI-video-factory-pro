import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { getEpisodeDir } from '../src/utils/fileHelper.js';
import { appendAgentTaskRun, createRunJob, finishRunJob } from '../src/utils/jobStore.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-job-store-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('jobStore persists run jobs and agent task runs under the episode hierarchy', async () => {
  await withTempRoot(async (tempRoot) => {
    const storeOptions = { baseTempDir: tempRoot };

    createRunJob(
      {
        id: 'run_job_1',
        jobId: 'job_1',
        projectId: 'project_1',
        scriptId: 'script_1',
        episodeId: 'episode_1',
        style: 'comic',
        scriptTitle: '测试剧本',
        episodeTitle: '第一集',
      },
      storeOptions
    );

    appendAgentTaskRun(
      {
        id: 'run_job_1',
        projectId: 'project_1',
        scriptId: 'script_1',
        episodeId: 'episode_1',
      },
      {
        id: 'run_job_1_generate_prompts',
        step: 'generate_prompts',
        agent: 'director',
        status: 'completed',
        detail: '生成图像Prompt',
      },
      storeOptions
    );

    finishRunJob(
      {
        id: 'run_job_1',
        projectId: 'project_1',
        scriptId: 'script_1',
        episodeId: 'episode_1',
      },
      {
        status: 'completed',
      },
      storeOptions
    );

    const runJobPath = path.join(
      getEpisodeDir('project_1', 'script_1', 'episode_1', tempRoot),
      'run-jobs',
      'run_job_1.json'
    );
    const saved = JSON.parse(fs.readFileSync(runJobPath, 'utf-8'));

    assert.equal(saved.id, 'run_job_1');
    assert.equal(saved.jobId, 'job_1');
    assert.equal(saved.status, 'completed');
    assert.equal(saved.style, 'comic');
    assert.equal(saved.scriptTitle, '测试剧本');
    assert.equal(saved.episodeTitle, '第一集');
    assert.equal(saved.agentTaskRuns.length, 1);
    assert.equal(saved.agentTaskRuns[0].id, 'run_job_1_generate_prompts');
    assert.equal(saved.agentTaskRuns[0].step, 'generate_prompts');
    assert.equal(saved.agentTaskRuns[0].agent, 'director');
    assert.equal(saved.agentTaskRuns[0].status, 'completed');
    assert.equal(saved.agentTaskRuns[0].detail, '生成图像Prompt');
    assert.equal(saved.agentTaskRuns[0].error, null);
    assert.match(saved.startedAt, /\d{4}-\d{2}-\d{2}T/);
    assert.match(saved.finishedAt, /\d{4}-\d{2}-\d{2}T/);
    assert.match(saved.agentTaskRuns[0].startedAt, /\d{4}-\d{2}-\d{2}T/);
    assert.match(saved.agentTaskRuns[0].finishedAt, /\d{4}-\d{2}-\d{2}T/);
  });
});
