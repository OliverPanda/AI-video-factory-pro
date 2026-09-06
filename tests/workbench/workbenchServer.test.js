import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { createWorkbenchServer } from '../../src/workbench/http/router.js';
import { createWorkbenchServer as createFastifyWorkbenchServer } from '../../src/app/workbench/server.js';

const postProcessingFixturesDir = path.resolve('tests/fixtures/post-processing');

async function requestJson(port, pathname, options = {}) {
  const response = await requestRaw(port, pathname, options);

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    payload: JSON.parse(response.text || '{}'),
  };
}

async function requestRaw(port, pathname, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.stringify(options.body) : null;

  const response = await new Promise((resolve, reject) => {
    const request = http.request(
      `http://127.0.0.1:${port}${pathname}`,
      {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      },
      (result) => {
        const chunks = [];
        result.on('data', (chunk) => {
          chunks.push(chunk);
        });
        result.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode: result.statusCode,
            headers: result.headers,
            text: buffer.toString('utf8'),
            buffer,
          });
        });
      }
    );
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });

  return response;
}

async function collectSseEvents(port, pathname, options = {}) {
  return await new Promise((resolve, reject) => {
    const events = [];
    let settled = false;
    let buffer = '';
    const req = http.request(
      `http://127.0.0.1:${port}${pathname}`,
      {
        method: 'GET',
        headers: options.headers || {},
      },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += String(chunk);
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || '';
          for (const block of blocks.filter(Boolean)) {
            const eventMatch = block.match(/event:\s*(.+)/);
            const dataMatch = block.match(/data:\s*(.+)/);
            if (eventMatch && dataMatch) {
              events.push({
                event: eventMatch[1].trim(),
                data: JSON.parse(dataMatch[1]),
              });
            }
          }
          if (!settled && events.some((entry) => entry.event === 'done')) {
            settled = true;
            req.destroy();
          }
        });
        res.on('close', () => {
          if (!settled) {
            settled = true;
          }
          resolve(events);
        });
        res.on('end', () => {
          if (!settled) {
            settled = true;
          }
          resolve(events);
        });
      }
    );
    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    req.end();
  });
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function readFixtureJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(postProcessingFixturesDir, fileName), 'utf8'));
}

async function withServer(server, callback) {
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    return await callback(server.address().port);
  } finally {
    server.close();
  }
}

function createReviewRunFixture(workspaceRoot) {
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_happyhorse',
    'scripts',
    'script_1',
    'episodes',
    'episode_1'
  );
  const runDir = path.join(workspaceRoot, 'artifacts', 'run_post_loop_fixture');
  const runJob = {
    id: 'run_post_loop_fixture',
    projectId: 'project_happyhorse',
    scriptId: 'script_1',
    episodeId: 'episode_1',
    scriptTitle: '第一季',
    episodeTitle: '第一集',
    status: 'completed',
    startedAt: '2026-06-19T00:00:00.000Z',
    finishedAt: '2026-06-19T00:10:00.000Z',
    artifactRunDir: runDir,
  };

  writeJson(path.join(episodeDir, 'run-jobs', `${runJob.id}.json`), runJob);
  writeJson(path.join(episodeDir, 'episode.json'), {
    id: 'episode_1',
    projectId: 'project_happyhorse',
    scriptId: 'script_1',
    title: '第一集',
    shots: [
      { id: 'shot_001', scene: '马厩', dialogue: '别怕', durationSec: 3 },
      { id: 'shot_002', scene: '门外', dialogue: '冲出去', durationSec: 4 },
    ],
    episodeCharacters: [
      { id: 'char_hero', name: '主角', personality: '冷静', roleType: 'lead' },
    ],
    scenes: [
      { id: 'scene_stable', name: '马厩', lighting: 'warm' },
    ],
    voices: [
      { id: 'voice_hero', speaker: '主角', provider: 'minimax' },
    ],
  });
  writeJson(path.join(runDir, 'qa-overview.json'), {
    status: 'warn',
    headline: '需要人工复核 3 项',
    agentSummaries: [{ agentName: 'postComposeReview', status: 'warn', headline: '待处理任务' }],
  });
  writeJson(path.join(runDir, 'state.snapshot.json'), {
    scriptData: {
      shots: [
        { id: 'shot_001', scene: '马厩', dialogue: '别怕', durationSec: 3, duration: 3 },
        { id: 'shot_002', scene: '门外', dialogue: '冲出去', durationSec: 4, duration: 4 },
      ],
    },
    imageResults: [
      { shotId: 'shot_001', imagePath: 'images/shot_001.png', success: true },
      { shotId: 'shot_002', imagePath: 'images/shot_002.png', success: true },
    ],
    videoResults: [
      { shotId: 'shot_001', videoPath: 'video/shot_001.mp4', status: 'completed' },
      { shotId: 'shot_002', videoPath: 'video/shot_002.mp4', status: 'completed' },
    ],
    audioResults: [
      { shotId: 'shot_001', audioPath: 'audio/shot_001.mp3' },
      { shotId: 'shot_002', audioPath: 'audio/shot_002.mp3' },
    ],
    sequenceClipResults: [
      {
        id: 'sequence_main',
        shotIds: ['shot_001', 'shot_002'],
        videoPath: 'video/sequence_main.mp4',
        startSec: 0,
        endSec: 7,
      },
    ],
    bridgeClipResults: [
      {
        id: 'bridge_001',
        fromShotId: 'shot_001',
        toShotId: 'shot_002',
        videoPath: 'video/bridge_001.mp4',
        startSec: 2.8,
        endSec: 3.2,
      },
    ],
  });
  writeJson(
    path.join(runDir, '10b-post-compose-review', '1-outputs', 'post-compose-review.json'),
    readFixtureJson('post-compose-review.json')
  );
  writeJson(
    path.join(runDir, '10b-post-compose-review', '1-outputs', 'edit-task-pack.json'),
    readFixtureJson('edit-task-pack.json')
  );
  writeJson(
    path.join(runDir, '12-human-review-queue', '1-outputs', 'human-review-queue.json'),
    readFixtureJson('human-review-queue.json')
  );
  fs.mkdirSync(path.join(runDir, 'output'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'output', 'final.mp4'), Buffer.from('0123456789abcdef'));

  return { tempProjectsDir, runDir };
}

function seedBillingLedger(runDir, entries) {
  writeJson(path.join(runDir, 'billing-ledger.json'), entries);
}

function createLiveStateReviewRunFixture(workspaceRoot) {
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const jobId = 'job_live_review';
  const episodeDir = path.join(
    tempProjectsDir,
    'project_live',
    'scripts',
    'script_live',
    'episodes',
    'episode_live'
  );
  const runDir = path.join(workspaceRoot, 'artifacts', 'run_live_review');
  const outputPath = path.join(workspaceRoot, 'output', 'project_live', 'episode_live', 'final-video.mp4');
  const runJob = {
    id: 'run_live_review',
    projectId: 'project_live',
    scriptId: 'script_live',
    episodeId: 'episode_live',
    jobId,
    scriptTitle: 'Live State',
    episodeTitle: 'Live Episode',
    status: 'failed',
    startedAt: '2026-06-23T00:00:00.000Z',
    finishedAt: '2026-06-23T00:10:00.000Z',
    artifactRunDir: runDir,
  };

  writeJson(path.join(episodeDir, 'run-jobs', `${runJob.id}.json`), runJob);
  writeJson(path.join(episodeDir, 'episode.json'), {
    id: 'episode_live',
    projectId: 'project_live',
    scriptId: 'script_live',
    title: 'Live Episode',
    shots: [{ id: 'shot_001', scene: '控制室', dialogue: '继续', durationSec: 2 }],
  });
  writeJson(path.join(runDir, 'qa-overview.json'), {
    status: 'block',
    headline: '旧 artifacts 仍是失败状态',
  });
  writeJson(path.join(workspaceRoot, 'temp', jobId, 'state.json'), {
    completedAt: '2026-06-23T00:20:00.000Z',
    outputPath,
    audioVoiceResolution: [
      {
        shotId: 'shot_001',
        segmentId: 'seg_001',
        speakerName: '主角',
        hasDialogue: true,
        dialogue: '继续',
        audioPath: path.join(workspaceRoot, 'temp', jobId, 'audio', 'shot_001.mp3'),
        voiceSource: 'voice-cast',
        usedDefaultVoiceFallback: false,
      },
    ],
    postComposeReview: {
      report: {
        schemaVersion: 'post-compose-review.v1',
        projectId: 'project_live',
        runId: 'run_live_review',
        status: 'needs_review',
        summary: { taskCount: 1 },
      },
      editTaskPack: {
        schemaVersion: 'edit-task-pack.v1',
        projectId: 'project_live',
        runId: 'run_live_review',
        finalVideoRef: 'review-final-video.mp4',
        tasks: [{ id: 'edit_task_live', status: 'pending_approval', action: 'manual_review' }],
        humanReview: { items: [{ id: 'post_compose_edit_task_live', taskId: 'edit_task_live', status: 'open' }] },
      },
    },
    humanReviewQueue: {
      status: 'open',
      items: [{ id: 'post_compose_edit_task_live', taskId: 'edit_task_live', status: 'open' }],
    },
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from('live-final-video'));
  fs.mkdirSync(runDir, { recursive: true });

  return { tempProjectsDir, outputPath };
}

test('GET /api/workbench returns 200 and json', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/workbench`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();

  assert.equal(body.statusCode, 200);
  assert.equal(JSON.parse(body.text).summary.runCount, 2);
});

test('GET /api/projects returns project summaries', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/projects`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();

  const payload = JSON.parse(body.text);
  assert.equal(body.statusCode, 200);
  assert.equal(payload.length, 2);
  assert.equal(payload[0].id, 'project_x');
});

test('GET /api/runs/:runId/qa returns QA payload', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/runs/run_fixture_recent/qa`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();

  const payload = JSON.parse(body.text);
  assert.equal(body.statusCode, 200);
  assert.equal(payload.status, 'warn');
  assert.equal(payload.agentSummaries.length, 1);
});

test('GET /api/runs/:runId/artifacts returns artifact summary', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/runs/run_fixture_recent/artifacts`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();

  const payload = JSON.parse(body.text);
  assert.equal(body.statusCode, 200);
  assert.ok(Array.isArray(payload.agentDirs));
});

test('GET /api/runs/:runId returns runtime journal when present', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-run-runtime-journal-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  writeJson(path.join(runDir, 'runtime-journal.json'), {
    runtimeVersion: 1,
    status: 'completed',
    updatedAt: '2026-06-27T00:00:00.000Z',
    stages: [
      { stage: 'character', status: 'completed', outputKeys: ['characterRegistry'] },
      { stage: 'compose', status: 'completed', outputKeys: ['finalOutputPath'] },
    ],
    decisions: [
      {
        decisionType: 'video_provider_selection',
        policySource: 'videoProviderPolicy',
        decisionKey: 'shot_001',
        timestamp: '2026-06-27T00:00:00.000Z',
        inputSnapshot: { shotId: 'shot_001', requestedProvider: 'seedance', hasReferenceImage: true },
        outputSnapshot: { preferredProvider: 'seedance', fallbackProviders: [] },
        rationale: 'reference image available, using requested provider seedance',
        tags: ['video-routing', 'reference-available'],
      },
    ],
  });

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/runs/run_post_loop_fixture`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();
  fs.rmSync(workspaceRoot, { recursive: true, force: true });

  const payload = JSON.parse(body.text);
  assert.equal(body.statusCode, 200);
  assert.equal(Boolean(payload.runState), true);
  assert.equal(payload.runState.run.status, 'completed');
  assert.equal(Array.isArray(payload.runState.stageRuns), true);
  assert.equal(Array.isArray(payload.runState.decisionRecords), true);
  assert.equal(payload.runtimeJournal.status, 'completed');
  assert.equal(payload.runtimeJournal.stages.length, 2);
  assert.equal(payload.runtimeJournal.stages[0].stage, 'character');
  assert.equal(payload.runtimeJournal.decisions.length, 1);
  assert.equal(payload.runtimeJournal.decisions[0].decisionType, 'video_provider_selection');
  assert.equal(payload.controlPlane.status, 'completed');
  assert.equal(payload.controlPlane.currentStage, 'compose');
  assert.equal(payload.controlPlane.currentStageStatus, 'completed');
  assert.equal(Array.isArray(payload.controlPlane.decisionTrail), true);
  assert.equal(payload.controlPlane.decisionTrail.length, 1);
  assert.equal(Array.isArray(payload.controlPlane.availableActions), true);
  // P2 单轨收敛：实验轨专属 action 已移除，控制面仅剩人审 action
  assert.equal(
    payload.controlPlane.availableActions.some(
      (item) => item.kind === 'rerun_stage' || item.kind === 'resume_runtime'
    ),
    false
  );
});

test('GET /api/runs/:runId/review returns aggregated post-processing review payload', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-aggregate-'));
  const { tempProjectsDir } = createReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs/run_post_loop_fixture/review');

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.run.id, 'run_post_loop_fixture');
  assert.equal(response.payload.postComposeReview.schemaVersion, 'post-compose-review.v1');
  assert.equal(response.payload.editTaskPack.tasks.length, 3);
  assert.equal(response.payload.humanReviewQueue.items.length, 3);
});

test('GET /api/runs/:runId/review falls back to live job state after a successful resume', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-live-state-'));
  const { tempProjectsDir } = createLiveStateReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  const response = await withServer(server, (port) =>
    requestJson(port, '/api/runs/run_live_review/review')
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.run.status, 'completed');
  assert.equal(response.payload.run.finishedAt, '2026-06-23T00:20:00.000Z');
  assert.equal(response.payload.postComposeReview.schemaVersion, 'post-compose-review.v1');
  assert.equal(response.payload.editTaskPack.tasks[0].id, 'edit_task_live');
  assert.equal(response.payload.humanReviewQueue.items[0].taskId, 'edit_task_live');
});

test('GET /api/runs/:runId/review ignores live state fallback when jobId is unsafe', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-live-state-unsafe-job-'));
  const { tempProjectsDir } = createLiveStateReviewRunFixture(workspaceRoot);
  const runJobPath = path.join(
    tempProjectsDir,
    'project_live',
    'scripts',
    'script_live',
    'episodes',
    'episode_live',
    'run-jobs',
    'run_live_review.json'
  );
  const runJob = JSON.parse(fs.readFileSync(runJobPath, 'utf8'));
  runJob.jobId = 'projects';
  writeJson(runJobPath, runJob);
  writeJson(path.join(workspaceRoot, 'temp', 'projects', 'state.json'), {
    postComposeReview: {
      report: { schemaVersion: 'post-compose-review.v1', status: 'should_not_load' },
    },
  });

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  const response = await withServer(server, (port) =>
    requestJson(port, '/api/runs/run_live_review/review')
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.postComposeReview, null);
  assert.equal(response.payload.editTaskPack, null);
});

test('GET /api/runs/:runId/review/clips returns timeline-ready clip groups', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-clips-'));
  const { tempProjectsDir } = createReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs/run_post_loop_fixture/review/clips');

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(Array.isArray(response.payload.clips.shot), true);
  assert.equal(Array.isArray(response.payload.clips.sequence), true);
  assert.equal(Array.isArray(response.payload.clips.bridge), true);
  assert.equal(Array.isArray(response.payload.clips.audio), true);
  assert.deepEqual(
    response.payload.clips.shot.map((clip) => [clip.id, clip.startSec, clip.endSec]),
    [
      ['shot_001', 0, 3],
      ['shot_002', 3, 7],
    ]
  );
  assert.equal(response.payload.clips.sequence[0].id, 'sequence_main');
  assert.equal(response.payload.clips.bridge[0].startSec, 2.8);
  assert.equal(response.payload.clips.audio[1].endSec, 7);
});

test('GET storyboard returns live state snapshot for resumed runs', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-storyboard-live-state-'));
  const { tempProjectsDir } = createLiveStateReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  const response = await withServer(server, (port) =>
    requestJson(port, '/api/projects/project_live/scripts/script_live/episodes/episode_live/storyboard?runId=run_live_review')
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.snapshot.audioVoiceResolution[0].speakerName, '主角');
});

test('PUT /api/runs/:runId/review/tasks/:taskId persists approved skipped manual_review and needs_changes statuses', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-task-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const approvedResponse = await requestJson(port, '/api/runs/run_post_loop_fixture/review/tasks/edit_task_001', {
    method: 'PUT',
    body: { status: 'approved' },
  });
  const skippedResponse = await requestJson(port, '/api/runs/run_post_loop_fixture/review/tasks/edit_task_002', {
    method: 'PUT',
    body: { status: 'skipped' },
  });
  const manualReviewResponse = await requestJson(port, '/api/runs/run_post_loop_fixture/review/tasks/edit_task_003', {
    method: 'PUT',
    body: { status: 'manual_review' },
  });
  const needsChangesResponse = await requestJson(port, '/api/runs/run_post_loop_fixture/review/tasks/edit_task_003', {
    method: 'PUT',
    body: { status: 'needs_changes' },
  });

  server.close();

  const savedTaskPack = JSON.parse(
    fs.readFileSync(path.join(runDir, '10b-post-compose-review', '1-outputs', 'edit-task-pack.json'), 'utf8')
  );
  const savedStatuses = Object.fromEntries(savedTaskPack.tasks.map((task) => [task.id, task.status]));

  assert.equal(approvedResponse.statusCode, 200);
  assert.equal(approvedResponse.payload.task.status, 'approved');
  assert.equal(skippedResponse.statusCode, 200);
  assert.equal(skippedResponse.payload.task.status, 'skipped');
  assert.equal(manualReviewResponse.statusCode, 200);
  assert.equal(manualReviewResponse.payload.task.status, 'manual_review');
  assert.equal(needsChangesResponse.statusCode, 200);
  assert.equal(needsChangesResponse.payload.task.status, 'needs_changes');
  assert.deepEqual(savedStatuses, {
    edit_task_001: 'approved',
    edit_task_002: 'skipped',
    edit_task_003: 'needs_changes',
  });
});

test('GET /api/logs returns global aggregation when projectId is missing', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-logs-global-overview-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  seedBillingLedger(runDir, [
    {
      id: 'image_bill_global_1',
      runId: 'run_post_loop_fixture',
      projectId: 'project_happyhorse',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      shotId: 'shot_001',
      category: 'image',
      provider: 'laozhang',
      operation: 'generate_image',
      currency: 'CNY',
      amount: 2.4,
      status: 'billed',
      timestamp: '2026-06-19T00:05:00.000Z',
      requestedAt: '2026-06-19T00:04:00.000Z',
      finishedAt: '2026-06-19T00:05:00.000Z',
      imagePath: 'images/shot_001.png',
      billingRef: 'img-global-1',
    },
  ]);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  const response = await withServer(server, (port) => requestJson(port, '/api/logs'));

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.scope.projectId, null);
  assert.equal(response.payload.scope.runCount, 1);
  assert.equal(response.payload.costSummary.total, 0);
  assert.equal(response.payload.costSummary.hasRealBilling, false);
  assert.equal(response.payload.imageLogs.length, 0);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test('GET /api/logs aggregates billed and unknown ledger entries by project', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-logs-overview-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  seedBillingLedger(runDir, [
    {
      id: 'image_bill_1',
      runId: 'run_post_loop_fixture',
      projectId: 'project_happyhorse',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      shotId: 'shot_001',
      category: 'image',
      provider: 'laozhang',
      operation: 'generate_image',
      currency: 'CNY',
      amount: 1.5,
      status: 'billed',
      timestamp: '2026-06-19T00:05:00.000Z',
      requestedAt: '2026-06-19T00:04:00.000Z',
      finishedAt: '2026-06-19T00:05:00.000Z',
      imagePath: 'images/shot_001.png',
      promptSummary: '主角在马厩',
      referenceCount: 2,
      billingRef: 'img-bill-1',
      metadata: {
        gatewaySync: {
          rawPayload: {
            created_at: 1782704754,
            content: '大小 1080x1920, 生成数量 1, 模型价格 0.3',
            model_name: 'qwen-image-edit',
            group: 'default',
            token_name: '380425169@qq.com的初始令牌',
            use_time: 26,
            is_stream: false,
            ip: '54.95.147.198',
            other: {
              model_price: 0.3,
              request_id: 'B202606290345286254782068268d9d6TThg7qrWMA',
              request_path: '/v1/images/edits',
              path: '/v1/images/edits',
              usages: {
                prompt_tokens: 1,
                completion_tokens: 0,
                total_tokens: 1,
              },
            },
          },
        },
      },
    },
    {
      id: 'video_unknown_1',
      runId: 'run_post_loop_fixture',
      projectId: 'project_happyhorse',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      shotId: 'shot_002',
      category: 'video',
      provider: 'seedance',
      operation: 'generate_video',
      currency: 'CNY',
      amount: null,
      status: 'unknown',
      timestamp: '2026-06-19T00:08:00.000Z',
      requestedAt: '2026-06-19T00:07:00.000Z',
      finishedAt: null,
      videoPath: 'video/shot_002.mp4',
      durationSec: 4,
      billingRef: 'video-unknown-1',
    },
  ]);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  const response = await withServer(server, (port) =>
    requestJson(port, '/api/logs?projectId=project_happyhorse')
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.scope.projectId, 'project_happyhorse');
  assert.equal(response.payload.scope.runCount, 1);
  assert.equal(response.payload.costSummary.total, 1.5);
  assert.equal(response.payload.costSummary.hasRealBilling, true);
  assert.equal(response.payload.costSummary.billedCount, 1);
  assert.equal(response.payload.costSummary.unknownCount, 0);
  assert.equal(response.payload.costSummary.byCategory.image, 1.5);
  assert.equal(response.payload.billingLogs.length, 1);
  assert.equal(response.payload.billingLogs[0].modelName, 'qwen-image-edit');
  assert.equal(response.payload.billingLogs[0].typeLabel, '消费');
  assert.equal(response.payload.billingLogs[0].ip, '54.95.147.198');
  assert.equal(response.payload.billingLogs[0].detail.includes('模型价格 0.3'), true);
  assert.equal(response.payload.imageLogs.length, 1);
  assert.equal(response.payload.videoLogs.length, 0);
  assert.equal(response.payload.imageLogs[0].provider, 'laozhang');
  assert.equal(response.payload.imageLogs[0].operation, 'generate_image');
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

test('GET /api/logs filters to a single run and keeps unknown-only billing as non-real', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-logs-single-run-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  seedBillingLedger(runDir, [
    {
      id: 'video_unknown_1',
      runId: 'run_post_loop_fixture',
      projectId: 'project_happyhorse',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      shotId: 'shot_001',
      category: 'video',
      provider: 'sora2',
      operation: 'generate_video',
      currency: 'CNY',
      amount: null,
      status: 'unknown',
      timestamp: '2026-06-19T00:08:00.000Z',
      requestedAt: '2026-06-19T00:07:00.000Z',
      finishedAt: null,
      videoPath: 'video/shot_001.mp4',
      durationSec: 3,
      billingRef: 'video-unknown-1',
    },
  ]);

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await requestJson(port, '/api/logs?projectId=project_happyhorse&runId=run_post_loop_fixture');
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.scope.runId, 'run_post_loop_fixture');
    assert.equal(response.payload.costSummary.total, 0);
    assert.equal(response.payload.costSummary.hasRealBilling, false);
    assert.equal(response.payload.costSummary.unknownCount, 0);
    assert.equal(response.payload.videoLogs.length, 0);
  } finally {
    server.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('GET /api/logs/runs returns sorted run options for a project', async () => {
  const server = createFastifyWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await requestJson(port, '/api/logs/runs?projectId=project_x');
    assert.equal(response.statusCode, 200);
    assert.equal(Array.isArray(response.payload), true);
    assert.equal(response.payload.length > 0, true);
    assert.equal(typeof response.payload[0].id, 'string');
    assert.equal(typeof response.payload[0].scriptTitle, 'string');
    assert.equal('runKey' in response.payload[0], true);
  } finally {
    server.close();
  }
});

test('POST /api/logs/sync backfills ledger from gateway logs', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-logs-sync-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  const previousFetch = global.fetch;
  const previousEnv = {
    GATEWAY_SYNC_FAMILY: process.env.GATEWAY_SYNC_FAMILY,
    GATEWAY_SYNC_BASE_URL: process.env.GATEWAY_SYNC_BASE_URL,
    GATEWAY_SYNC_API_KEY: process.env.GATEWAY_SYNC_API_KEY,
    GATEWAY_SYNC_PATH: process.env.GATEWAY_SYNC_PATH,
  };

  process.env.GATEWAY_SYNC_FAMILY = 'openai_compat';
  process.env.GATEWAY_SYNC_BASE_URL = 'https://gateway.example';
  process.env.GATEWAY_SYNC_API_KEY = 'gateway-token';
  process.env.GATEWAY_SYNC_PATH = '/usage';
  seedBillingLedger(runDir, [
    {
      id: 'image_unknown_1',
      runId: 'run_post_loop_fixture',
      projectId: 'project_happyhorse',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      shotId: 'shot_001',
      category: 'image',
      provider: 'openai_compat',
      operation: 'generate_image',
      requestId: 'req_sync_1',
      billingRef: 'req_sync_1',
      currency: 'CNY',
      amount: null,
      status: 'unknown',
    },
  ]);

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      items: [
        {
          request_id: 'req_sync_1',
          total_cost: 5.5,
          currency: 'CNY',
          status: 'success',
          finished_at: '2026-06-29T00:00:00.000Z',
        },
      ],
    }),
  });

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await requestJson(port, '/api/logs/sync', {
      method: 'POST',
      body: { projectId: 'project_happyhorse', runId: 'run_post_loop_fixture' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.matchedCount, 1);

    const after = await requestJson(port, '/api/logs?projectId=project_happyhorse&runId=run_post_loop_fixture');
    assert.equal(after.payload.costSummary.total, 5.5);
    assert.equal(after.payload.costSummary.hasRealBilling, true);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    server.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('POST /api/logs/sync auto-detects apilio family when only base url is switched', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-logs-sync-apilio-auto-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  const previousFetch = global.fetch;
  const previousEnv = {
    GATEWAY_SYNC_FAMILY: process.env.GATEWAY_SYNC_FAMILY,
    GATEWAY_SYNC_BASE_URL: process.env.GATEWAY_SYNC_BASE_URL,
    GATEWAY_SYNC_API_KEY: process.env.GATEWAY_SYNC_API_KEY,
    GATEWAY_SYNC_PATH: process.env.GATEWAY_SYNC_PATH,
  };

  process.env.GATEWAY_SYNC_FAMILY = 'auto';
  process.env.GATEWAY_SYNC_BASE_URL = 'https://api.apilio.ai';
  process.env.GATEWAY_SYNC_API_KEY = 'gateway-token';
  process.env.GATEWAY_SYNC_PATH = '/usage';
  seedBillingLedger(runDir, [
    {
      id: 'image_unknown_apilio_1',
      runId: 'run_post_loop_fixture',
      projectId: 'project_happyhorse',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      shotId: 'shot_001',
      category: 'image',
      provider: 'openai_compat',
      operation: 'generate_image',
      requestId: 'B202606290345286254782068268d9d6TThg7qrWMA',
      billingRef: 'B202606290345286254782068268d9d6TThg7qrWMA',
      currency: 'CNY',
      amount: null,
      status: 'unknown',
    },
  ]);

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        page: 1,
        page_size: 10,
        total: 1,
        items: [
          {
            created_at: 1782704754,
            content: '大小 1080x1920, 生成数量 1, 模型价格 0.3',
            model_name: 'qwen-image-edit',
            other: {
              billing_source: 'wallet',
              host: 'api.apilio.ai',
              model_price: 0.3,
              path: '/v1/images/edits',
              request_id: 'B202606290345286254782068268d9d6TThg7qrWMA',
              request_path: '/v1/images/edits',
            },
          },
        ],
      },
      success: true,
      message: '',
    }),
  });

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await requestJson(port, '/api/logs/sync', {
      method: 'POST',
      body: { projectId: 'project_happyhorse', runId: 'run_post_loop_fixture' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.gatewayFamily, 'apilio_openai_compat');
    assert.equal(response.payload.matchedCount, 1);
    assert.equal(response.payload.results[0].amount, 0.3);

    const after = await requestJson(port, '/api/logs?projectId=project_happyhorse&runId=run_post_loop_fixture');
    assert.equal(after.payload.costSummary.total, 0.3);
    assert.equal(after.payload.costSummary.hasRealBilling, true);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    server.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('POST /api/logs/sync supports global sync without projectId', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-logs-sync-global-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  const previousFetch = global.fetch;
  const previousEnv = {
    GATEWAY_SYNC_FAMILY: process.env.GATEWAY_SYNC_FAMILY,
    GATEWAY_SYNC_BASE_URL: process.env.GATEWAY_SYNC_BASE_URL,
    GATEWAY_SYNC_API_KEY: process.env.GATEWAY_SYNC_API_KEY,
    GATEWAY_SYNC_PATH: process.env.GATEWAY_SYNC_PATH,
  };

  process.env.GATEWAY_SYNC_FAMILY = 'openai_compat';
  process.env.GATEWAY_SYNC_BASE_URL = 'https://gateway.example';
  process.env.GATEWAY_SYNC_API_KEY = 'gateway-token';
  process.env.GATEWAY_SYNC_PATH = '/usage';
  seedBillingLedger(runDir, [
    {
      id: 'image_unknown_global_1',
      runId: 'run_post_loop_fixture',
      projectId: 'project_happyhorse',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      shotId: 'shot_001',
      category: 'image',
      provider: 'openai_compat',
      operation: 'generate_image',
      requestId: 'req_global_sync_1',
      billingRef: 'req_global_sync_1',
      currency: 'CNY',
      amount: null,
      status: 'unknown',
    },
  ]);

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      items: [
        {
          request_id: 'req_global_sync_1',
          total_cost: 6.6,
          currency: 'CNY',
          status: 'success',
          finished_at: '2026-06-29T00:00:00.000Z',
        },
      ],
    }),
  });

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await requestJson(port, '/api/logs/sync', {
      method: 'POST',
      body: {},
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.matchedCount, 1);

    const after = await requestJson(port, '/api/logs');
    assert.equal(after.payload.costSummary.total, 6.6);
    assert.equal(after.payload.costSummary.hasRealBilling, true);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    server.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('PUT /api/runs/:runId/review/tasks/:taskId keeps /review aggregate task status views in sync', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-task-sync-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const updateResponse = await requestJson(port, '/api/runs/run_post_loop_fixture/review/tasks/edit_task_001', {
    method: 'PUT',
    body: { status: 'approved' },
  });
  const reviewResponse = await requestJson(port, '/api/runs/run_post_loop_fixture/review');

  server.close();

  const queueItem = reviewResponse.payload.humanReviewQueue.items.find((item) => item.id === 'post_compose_edit_task_001');
  const snapshot = JSON.parse(fs.readFileSync(path.join(runDir, 'state.snapshot.json'), 'utf8'));
  const humanReviewRecord = snapshot.runState?.humanReviewRecords?.[0] || null;

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(reviewResponse.statusCode, 200);
  assert.equal(reviewResponse.payload.editTaskPack.tasks.find((task) => task.id === 'edit_task_001').status, 'approved');
  assert.equal(reviewResponse.payload.postComposeReview.taskStatusSummary.approved, 1);
  assert.equal(queueItem.status, 'approved');
  assert.equal(Boolean(humanReviewRecord), true);
  assert.equal(humanReviewRecord.resolutionPayload.latestTaskUpdate.taskId, 'edit_task_001');
  assert.equal(humanReviewRecord.resolutionPayload.latestTaskUpdate.status, 'approved');
});

test('POST /api/runs submit_review_action persists review decision through control plane command', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-command-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs', {
    method: 'POST',
    body: {
      projectId: 'project_post_loop',
      scriptId: 'script_post_loop',
      episodeId: 'episode_post_loop',
      mode: {
        kind: 'submit_review_action',
        runId: 'run_post_loop_fixture',
        taskId: 'edit_task_002',
        status: 'skipped',
      },
    },
  });
  const reviewResponse = await requestJson(port, '/api/runs/run_post_loop_fixture/review');

  server.close();

  const savedTaskPack = JSON.parse(
    fs.readFileSync(path.join(runDir, '10b-post-compose-review', '1-outputs', 'edit-task-pack.json'), 'utf8')
  );
  const savedSnapshot = JSON.parse(fs.readFileSync(path.join(runDir, 'state.snapshot.json'), 'utf8'));
  const task = savedTaskPack.tasks.find((item) => item.id === 'edit_task_002');
  const queueItem = reviewResponse.payload.humanReviewQueue.items.find(
    (item) => item.taskId === 'edit_task_002' || String(item.id || '').endsWith('edit_task_002')
  );
  const humanReviewRecord = savedSnapshot.runState?.humanReviewRecords?.[0] || null;

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.mode, 'submit_review_action');
  assert.equal(response.payload.controlCommand.kind, 'submit_review_action');
  assert.equal(response.payload.controlCommand.runId, 'run_post_loop_fixture');
  assert.equal(response.payload.controlCommand.taskId, 'edit_task_002');
  assert.equal(response.payload.controlCommand.status, 'skipped');
  assert.equal(response.payload.task.id, 'edit_task_002');
  assert.equal(response.payload.task.status, 'skipped');
  assert.equal(task.status, 'skipped');
  assert.equal(reviewResponse.payload.editTaskPack.tasks.find((item) => item.id === 'edit_task_002').status, 'skipped');
  assert.equal(queueItem.status, 'skipped');
  assert.equal(Boolean(humanReviewRecord), true);
  assert.equal(humanReviewRecord.resolutionPayload.latestTaskUpdate.taskId, 'edit_task_002');
  assert.equal(humanReviewRecord.resolutionPayload.latestTaskUpdate.status, 'skipped');
});

test('POST /api/runs submit_review_action accepts rejected and keeps blocked review state', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-command-rejected-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  const snapshotPath = path.join(runDir, 'state.snapshot.json');
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  snapshot.executionGate = {
    status: 'blocked',
    stoppedBeforeStage: 'generate_video_clips',
    reason: 'manual_review_required',
  };
  snapshot.blockedStage = 'video_routing';
  snapshot.humanReviewQueue = readFixtureJson('human-review-queue.json');
  writeJson(snapshotPath, snapshot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs', {
    method: 'POST',
    body: {
      projectId: 'project_post_loop',
      scriptId: 'script_post_loop',
      episodeId: 'episode_post_loop',
      mode: {
        kind: 'submit_review_action',
        runId: 'run_post_loop_fixture',
        taskId: 'edit_task_001',
        status: 'rejected',
      },
    },
  });

  server.close();

  const savedSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const humanReviewRecord = savedSnapshot.runState?.humanReviewRecords?.[0] || null;

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.task.status, 'rejected');
  assert.equal(savedSnapshot.runState.humanReviewRecords[0].status, 'blocked');
  assert.equal(savedSnapshot.executionGate.status, 'blocked');
  assert.equal(Boolean(humanReviewRecord), true);
  assert.equal(humanReviewRecord.resolutionPayload.latestTaskUpdate.status, 'rejected');
});

test('PUT /api/runs/:runId/review/tasks/:taskId rejects invalid task review status', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-task-invalid-'));
  const { tempProjectsDir } = createReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const invalid = await requestJson(port, '/api/runs/run_post_loop_fixture/review/tasks/edit_task_002', {
    method: 'PUT',
    body: { status: 'done' },
  });

  server.close();

  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.payload.error, /status/i);
});

test('GET /api/runs/:runId/review/video supports standard open-ended and suffix ranges', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-video-'));
  const { tempProjectsDir } = createReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const standardRange = await requestRaw(port, '/api/runs/run_post_loop_fixture/review/video', {
    headers: { Range: 'bytes=0-3' },
  });
  const openEndedRange = await requestRaw(port, '/api/runs/run_post_loop_fixture/review/video', {
    headers: { Range: 'bytes=4-' },
  });
  const suffixRange = await requestRaw(port, '/api/runs/run_post_loop_fixture/review/video', {
    headers: { Range: 'bytes=-4' },
  });

  server.close();

  assert.equal(standardRange.statusCode, 206);
  assert.equal(standardRange.headers['content-range'], 'bytes 0-3/16');
  assert.equal(standardRange.buffer.toString('utf8'), '0123');
  assert.equal(openEndedRange.statusCode, 206);
  assert.equal(openEndedRange.headers['content-range'], 'bytes 4-15/16');
  assert.equal(openEndedRange.buffer.toString('utf8'), '456789abcdef');
  assert.equal(suffixRange.statusCode, 206);
  assert.equal(suffixRange.headers['content-range'], 'bytes 12-15/16');
  assert.equal(suffixRange.buffer.toString('utf8'), 'cdef');
});

test('GET /api/runs/:runId/review/video rejects invalid ranges with 416', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-video-invalid-range-'));
  const { tempProjectsDir } = createReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const invalidRange = await requestRaw(port, '/api/runs/run_post_loop_fixture/review/video', {
    headers: { Range: 'bytes=20-30' },
  });

  server.close();

  assert.equal(invalidRange.statusCode, 416);
  assert.equal(invalidRange.headers['content-range'], 'bytes */16');
});

test('GET /api/runs/:runId/review/video serves trusted absolute temp finalVideoRef', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-video-temp-final-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  const trustedVideoPath = path.join(
    os.tmpdir(),
    `aivf-director-${Date.now()}`,
    'job',
    'output',
    'project_fixture',
    'episode_fixture',
    'final-video.mp4'
  );
  fs.mkdirSync(path.dirname(trustedVideoPath), { recursive: true });
  fs.writeFileSync(trustedVideoPath, Buffer.from('trusted-final-video'));

  const taskPackPath = path.join(runDir, '10b-post-compose-review', '1-outputs', 'edit-task-pack.json');
  const taskPack = JSON.parse(fs.readFileSync(taskPackPath, 'utf8'));
  taskPack.finalVideoRef = trustedVideoPath;
  writeJson(taskPackPath, taskPack);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestRaw(port, '/api/runs/run_post_loop_fixture/review/video');

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.buffer.toString('utf8'), 'trusted-final-video');
});

test('GET /api/runs/:runId/review/video falls back to live state outputPath after a successful resume', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-video-live-state-'));
  const { tempProjectsDir } = createLiveStateReviewRunFixture(workspaceRoot);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  const response = await withServer(server, (port) =>
    requestRaw(port, '/api/runs/run_live_review/review/video')
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.buffer.toString('utf8'), 'live-final-video');
});

test('GET /api/runs/:runId/review/video rejects absolute finalVideoRef outside run directory', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-video-absolute-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  const outsideFilePath = path.join(os.tmpdir(), `aivf-outside-${Date.now()}.mp4`);
  fs.writeFileSync(outsideFilePath, Buffer.from('outside-video'));

  const taskPackPath = path.join(runDir, '10b-post-compose-review', '1-outputs', 'edit-task-pack.json');
  const taskPack = JSON.parse(fs.readFileSync(taskPackPath, 'utf8'));
  taskPack.finalVideoRef = outsideFilePath;
  writeJson(taskPackPath, taskPack);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs/run_post_loop_fixture/review/video');

  server.close();

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /run directory|outside/i);
});

test('GET /api/runs/:runId/review/video rejects parent traversal finalVideoRef outside run directory', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-review-video-traversal-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  const escapedPath = path.join(workspaceRoot, 'escaped.mp4');
  fs.writeFileSync(escapedPath, Buffer.from('escaped-video'));

  const taskPackPath = path.join(runDir, '10b-post-compose-review', '1-outputs', 'edit-task-pack.json');
  const taskPack = JSON.parse(fs.readFileSync(taskPackPath, 'utf8'));
  taskPack.finalVideoRef = '../../../escaped.mp4';
  writeJson(taskPackPath, taskPack);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs/run_post_loop_fixture/review/video');

  server.close();

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /run directory|outside/i);
});

test('GET /api/projects/:projectId/scripts/:scriptId/episodes/:episodeId/storyboard returns episode-backed editor payload', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-storyboard-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_storyboard',
    'scripts',
    'script_storyboard',
    'episodes',
    'episode_storyboard'
  );
  writeJson(path.join(episodeDir, 'episode.json'), {
    id: 'episode_storyboard',
    projectId: 'project_storyboard',
    scriptId: 'script_storyboard',
    title: '可编辑分镜',
    shots: [
      { id: 'shot_001', scene: '控制室', dialogue: '开始吧', durationSec: 5 },
    ],
    episodeCharacters: [
      { id: 'char_001', name: '女主', emotion: 'calm' },
    ],
    scenes: [
      { id: 'scene_001', name: '控制室', lighting: 'cold' },
    ],
    voices: [
      { id: 'voice_001', speaker: '女主', tone: 'steady' },
    ],
  });
  writeJson(path.join(episodeDir, 'state.snapshot.json'), {
    scriptData: {
      shots: [{ id: 'shot_001', scene: '控制室', cameraType: 'close-up' }],
    },
  });

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(
    port,
    '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard/storyboard'
  );

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.id, 'episode_storyboard');
  assert.equal(response.payload.shots.length, 1);
  assert.equal(response.payload.characters[0].id, 'char_001');
  assert.equal(response.payload.snapshot.scriptData.shots[0].cameraType, 'close-up');
});

test('GET storyboard prefers requested runId artifact payload when project store episode is missing', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-storyboard-runid-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const runArtifactEpisodeDir = path.join(
    tempProjectsDir,
    'project_actual',
    'scripts',
    'script_actual',
    'episodes',
    'episode_actual'
  );
  const runDir = path.join(runArtifactEpisodeDir, 'runs', 'run_actual_001');
  const logicalEpisodeDir = path.join(
    tempProjectsDir,
    'project_storyboard',
    'scripts',
    'script_storyboard',
    'episodes',
    'episode_storyboard'
  );
  fs.mkdirSync(path.join(logicalEpisodeDir, 'run-jobs'), { recursive: true });
  writeJson(path.join(logicalEpisodeDir, 'run-jobs', 'run_storyboard_001.json'), {
    id: 'run_storyboard_001',
    projectId: 'project_storyboard',
    scriptId: 'script_storyboard',
    episodeId: 'episode_storyboard',
    scriptTitle: '真实剧本',
    episodeTitle: '真实分集',
    status: 'completed',
    startedAt: '2026-06-22T00:00:00.000Z',
    finishedAt: '2026-06-22T00:01:00.000Z',
    artifactRunDir: path.relative(workspaceRoot, runDir),
  });
  writeJson(path.join(runDir, '09c-video-router', '1-outputs', 'shot-packages.json'), [
    {
      shotId: 'shot_run_001',
      durationTargetSec: 4,
      visualGoal: '真实运行镜头',
      cameraSpec: { framing: 'wide' },
      preferredProvider: 'happyhorse',
      providerRequestHints: { scene: '回廊', negativePrompt: 'none' },
      generationPack: {
        scene_id: 'scene_001',
        space_anchor: '回廊',
        character_locks: ['沈清'],
      },
      referenceImages: [{ path: 'images/shot_run_001.png' }],
    },
  ]);
  writeJson(path.join(runDir, '07-tts-agent', '0-inputs', 'dialogue-normalized.json'), [
    {
      id: 'shot_run_001',
      scene: '回廊',
      characters: ['沈清'],
      dialogue: '这里是 run 级 payload',
    },
  ]);

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(
    port,
    '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard/storyboard?runId=run_storyboard_001'
  );

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.title, '真实分集');
  assert.equal(response.payload.shots.length, 1);
  assert.equal(response.payload.shots[0].id, 'shot_run_001');
  assert.equal(response.payload.shots[0].dialogue, '这里是 run 级 payload');
  assert.equal(response.payload.characters[0].name, '沈清');
});

test('PUT storyboard entity routes update episode.json for shots characters scenes and voices', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-storyboard-update-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_storyboard',
    'scripts',
    'script_storyboard',
    'episodes',
    'episode_storyboard'
  );
  const episodePath = path.join(episodeDir, 'episode.json');
  writeJson(episodePath, {
    id: 'episode_storyboard',
    projectId: 'project_storyboard',
    scriptId: 'script_storyboard',
    title: '可编辑分镜',
    shots: [
      { id: 'shot_001', scene: '旧场景', dialogue: '旧台词', durationSec: 3 },
    ],
    episodeCharacters: [
      { id: 'char_001', name: '女主', personality: '克制' },
    ],
    characters: [
      { id: 'char_001', name: '女主', personality: '克制' },
    ],
    scenes: [
      { id: 'scene_001', name: '旧场景', lighting: 'warm' },
    ],
    voices: [
      { id: 'voice_001', speaker: '女主', tone: 'soft' },
    ],
  });

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const shotResponse = await requestJson(
    port,
    '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard/shots/shot_001',
    {
      method: 'PUT',
      body: {
        dialogue: '新台词',
        emotion: 'angry',
        cameraType: 'wide',
        scene: '新场景',
        durationSec: 6,
      },
    }
  );
  const characterResponse = await requestJson(
    port,
    '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard/characters/char_001',
    {
      method: 'PUT',
      body: { personality: '果断', emotion: 'focused' },
    }
  );
  const sceneResponse = await requestJson(
    port,
    '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard/scenes/scene_001',
    {
      method: 'PUT',
      body: { lighting: 'cold', weather: 'rain' },
    }
  );
  const voiceResponse = await requestJson(
    port,
    '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard/voices/voice_001',
    {
      method: 'PUT',
      body: { tone: 'firm', provider: 'openai_compat' },
    }
  );
  const episodeResponse = await requestJson(
    port,
    '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard'
  );

  server.close();

  const savedEpisode = JSON.parse(fs.readFileSync(episodePath, 'utf8'));

  assert.equal(shotResponse.statusCode, 200);
  assert.equal(shotResponse.payload.entity.dialogue, '新台词');
  assert.equal(shotResponse.payload.entity.durationSec, 6);
  assert.equal(characterResponse.payload.entity.personality, '果断');
  assert.equal(sceneResponse.payload.entity.weather, 'rain');
  assert.equal(voiceResponse.payload.entity.provider, 'openai_compat');
  assert.equal(savedEpisode.shots[0].cameraType, 'wide');
  assert.equal(savedEpisode.episodeCharacters[0].emotion, 'focused');
  assert.equal(savedEpisode.characters[0].emotion, 'focused');
  assert.equal(savedEpisode.scenes[0].lighting, 'cold');
  assert.equal(savedEpisode.voices[0].tone, 'firm');
  assert.equal(episodeResponse.payload.episodeCharacters[0].personality, '果断');
  assert.equal(episodeResponse.payload.characters[0].personality, '果断');
});

test('PUT storyboard voices route creates derived audio voice entries when missing', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-storyboard-voice-upsert-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_storyboard',
    'scripts',
    'script_storyboard',
    'episodes',
    'episode_storyboard'
  );
  const episodePath = path.join(episodeDir, 'episode.json');
  writeJson(episodePath, {
    id: 'episode_storyboard',
    projectId: 'project_storyboard',
    scriptId: 'script_storyboard',
    title: '派生配音分集',
    shots: [],
    voices: [],
  });

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  const response = await withServer(server, (port) =>
    requestJson(
      port,
      '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard/voices/%E7%B3%BB%E7%BB%9F%E9%9F%B3',
      {
        method: 'PUT',
        body: {
          name: '系统音',
          provider: 'minimax_verified',
          gender: 'female',
          voiceSource: 'gender_fallback',
        },
      }
    )
  );

  const savedEpisode = JSON.parse(fs.readFileSync(episodePath, 'utf8'));
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.entity.id, '系统音');
  assert.equal(response.payload.entity.provider, 'minimax_verified');
  assert.equal(savedEpisode.voices[0].provider, 'minimax_verified');
});

test('PUT /api/projects/:projectId/scripts/:scriptId/episodes/:episodeId/characters/:charId keeps episode detail character copies in sync', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-episode-character-sync-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_storyboard',
    'scripts',
    'script_storyboard',
    'episodes',
    'episode_storyboard'
  );
  const episodePath = path.join(episodeDir, 'episode.json');
  writeJson(episodePath, {
    id: 'episode_storyboard',
    projectId: 'project_storyboard',
    scriptId: 'script_storyboard',
    title: '角色同步分集',
    shots: [],
    episodeCharacters: [
      { id: 'char_001', name: '女主', personality: '克制', emotion: 'calm' },
    ],
    characters: [
      { id: 'char_001', name: '女主', personality: '克制', emotion: 'calm' },
    ],
    scenes: [],
    voices: [],
  });

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const updateResponse = await requestJson(
    port,
    '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard/characters/char_001',
    {
      method: 'PUT',
      body: { personality: '果断', emotion: 'focused' },
    }
  );
  const detailResponse = await requestJson(
    port,
    '/api/projects/project_storyboard/scripts/script_storyboard/episodes/episode_storyboard'
  );

  server.close();

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(detailResponse.statusCode, 200);
  assert.equal(detailResponse.payload.episodeCharacters[0].personality, '果断');
  assert.equal(detailResponse.payload.episodeCharacters[0].emotion, 'focused');
  assert.equal(detailResponse.payload.characters[0].personality, '果断');
  assert.equal(detailResponse.payload.characters[0].emotion, 'focused');
});

test('static file serving rejects parent traversal outside workspace', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-static-traversal-'));
  const parentDir = path.dirname(workspaceRoot);
  const outsideFileName = `outside-${Date.now()}.txt`;
  fs.writeFileSync(path.join(parentDir, outsideFileName), 'outside', 'utf8');

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir: path.join(workspaceRoot, 'temp', 'projects') });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestRaw(port, `/%2e%2e/${outsideFileName}`);

  server.close();

  assert.equal(response.statusCode, 404);
  assert.equal(response.text, 'Not Found');
});

test('static file serving rejects sibling paths that share workspace prefix', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-static-prefix-'));
  const siblingWorkspace = `${workspaceRoot}-evil`;
  fs.mkdirSync(siblingWorkspace, { recursive: true });
  fs.writeFileSync(path.join(siblingWorkspace, 'secret.txt'), 'secret', 'utf8');

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir: path.join(workspaceRoot, 'temp', 'projects') });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestRaw(port, `/%2e%2e/${path.basename(siblingWorkspace)}/secret.txt`);

  server.close();

  assert.equal(response.statusCode, 404);
  assert.equal(response.text, 'Not Found');
});

test('GET /api/projects/:projectId/scripts/:scriptId/episodes/:episodeId returns saved episode shots', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-episode-detail-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp');
  const episodeDir = path.join(
    tempProjectsDir,
    'projects',
    'project_with_episode',
    'scripts',
    'script_with_episode',
    'episodes',
    'episode_with_shots'
  );
  fs.mkdirSync(episodeDir, { recursive: true });
  fs.writeFileSync(
    path.join(episodeDir, 'episode.json'),
    JSON.stringify(
      {
        id: 'episode_with_shots',
        title: '带镜头的分集',
        shots: [
          { id: 'shot_001', scene: '控制室', action: '主角抬头看向屏幕' },
          { id: 'shot_002', scene: '走廊', action: '反派从阴影里走出' },
        ],
      },
      null,
      2
    ),
    'utf8'
  );

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(
    port,
    '/api/projects/project_with_episode/scripts/script_with_episode/episodes/episode_with_shots'
  );

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.id, 'episode_with_shots');
  assert.equal(response.payload.shots.length, 2);
  assert.equal(response.payload.shots[0].id, 'shot_001');
});

test('GET /api/projects/:projectId/scripts/:scriptId/episodes/:episodeId falls back to minimal run-backed payload when episode.json is missing', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-episode-detail-fallback-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const logicalEpisodeDir = path.join(
    tempProjectsDir,
    'project_missing_episode',
    'scripts',
    'script_missing_episode',
    'episodes',
    'episode_missing_payload'
  );
  const runDir = path.join(
    logicalEpisodeDir,
    'runs',
    'run_missing_episode'
  );
  fs.mkdirSync(path.join(logicalEpisodeDir, 'run-jobs'), { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(logicalEpisodeDir, 'run-jobs', 'run_missing_episode.json'), {
    id: 'run_missing_episode',
    projectId: 'project_missing_episode',
    scriptId: 'script_missing_episode',
    episodeId: 'episode_missing_payload',
    scriptTitle: '老项目兼容',
    episodeTitle: '第一集',
    status: 'completed',
    startedAt: '2026-06-22T00:00:00.000Z',
    finishedAt: '2026-06-22T00:01:00.000Z',
    artifactRunDir: path.relative(workspaceRoot, runDir),
  });

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(
    port,
    '/api/projects/project_missing_episode/scripts/script_missing_episode/episodes/episode_missing_payload'
  );

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.id, 'episode_missing_payload');
  assert.equal(response.payload.title, '第一集');
  assert.deepEqual(response.payload.shots, []);
  assert.deepEqual(response.payload.characters, []);
  assert.deepEqual(response.payload.scenes, []);
  assert.deepEqual(response.payload.voices, []);
});

test('POST /api/runs retry supports stopAt before_video to avoid video generation', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-retry-stop-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_retry',
    'scripts',
    'script_retry',
    'episodes',
    'episode_retry'
  );
  fs.mkdirSync(path.join(episodeDir, 'run-jobs'), { recursive: true });
  fs.writeFileSync(
    path.join(episodeDir, 'episode.json'),
    JSON.stringify({ id: 'episode_retry', title: '重试测试', shots: [{ id: 'shot_001' }] }, null, 2),
    'utf8'
  );
  writeJson(path.join(tempProjectsDir, 'project_retry', 'scripts', 'script_retry', 'script.json'), {
    id: 'script_retry',
    projectId: 'project_retry',
    title: '重试测试',
    sourceText: [
      '第1集《重试测试》',
      '【画面1】',
      '场景：客厅。',
      '人物：周凛。',
      '动作：周凛抬头看向灯光。',
      '对白：周凛：再试一次。',
      '时长：5秒',
    ].join('\n'),
    parseOk: true,
    shotCount: 1,
  });
  fs.writeFileSync(
    path.join(episodeDir, 'run-jobs', 'run_previous.json'),
    JSON.stringify(
      {
        id: 'run_previous',
        projectId: 'project_retry',
        scriptId: 'script_retry',
        episodeId: 'episode_retry',
        jobId: 'job_previous',
        status: 'failed',
        startedAt: '2026-06-17T00:00:00.000Z',
      },
      null,
      2
    ),
    'utf8'
  );

  let spawned = null;
  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    spawnProcess(command, args) {
      spawned = { command, args };
      return {
        pid: 12345,
        unref() {},
      };
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs', {
    method: 'POST',
    body: {
      projectId: 'project_retry',
      scriptId: 'script_retry',
      episodeId: 'episode_retry',
      mode: { kind: 'retry', stopAt: 'before_video' },
    },
  });

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(spawned.command, 'node');
  assert.equal(spawned.args.includes('--stop-at=before_video'), true);
  assert.equal(spawned.args.includes('--input-format=professional-script'), true);
});

test('POST /api/runs retry resolves project locator from runId only', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-retry-runid-only-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_retry',
    'scripts',
    'script_retry',
    'episodes',
    'episode_retry'
  );
  fs.mkdirSync(path.join(episodeDir, 'run-jobs'), { recursive: true });
  fs.writeFileSync(
    path.join(episodeDir, 'episode.json'),
    JSON.stringify({ id: 'episode_retry', title: '重试测试', shots: [{ id: 'shot_001' }] }, null, 2),
    'utf8'
  );
  writeJson(path.join(tempProjectsDir, 'project_retry', 'scripts', 'script_retry', 'script.json'), {
    id: 'script_retry',
    projectId: 'project_retry',
    title: '重试测试',
    sourceText: [
      '第1集《重试测试》',
      '【画面1】',
      '场景：客厅。',
      '人物：周凛。',
      '动作：周凛抬头看向灯光。',
      '对白：周凛：再试一次。',
      '时长：5秒',
    ].join('\n'),
    parseOk: true,
    shotCount: 1,
  });
  fs.writeFileSync(
    path.join(episodeDir, 'run-jobs', 'run_previous.json'),
    JSON.stringify(
      {
        id: 'run_previous',
        runKey: 'rk_previous',
        projectId: 'project_retry',
        scriptId: 'script_retry',
        episodeId: 'episode_retry',
        jobId: 'job_previous',
        status: 'failed',
        startedAt: '2026-06-17T00:00:00.000Z',
      },
      null,
      2
    ),
    'utf8'
  );

  let spawned = null;
  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    spawnProcess(command, args) {
      spawned = { command, args };
      return {
        pid: 12345,
        unref() {},
      };
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs', {
    method: 'POST',
    body: {
      runId: 'run_previous',
      mode: { kind: 'retry', runId: 'run_previous', stopAt: 'before_video' },
    },
  });

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(spawned.command, 'node');
  assert.equal(spawned.args.includes('--project=project_retry'), true);
  assert.equal(spawned.args.includes('--script=script_retry'), true);
  assert.equal(spawned.args.includes('--episode=episode_retry'), true);
  assert.equal(spawned.args.includes('--stop-at=before_video'), true);
});

test('POST /api/runs retry resolves project locator from runKey only', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-retry-runkey-only-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_retry',
    'scripts',
    'script_retry',
    'episodes',
    'episode_retry'
  );
  fs.mkdirSync(path.join(episodeDir, 'run-jobs'), { recursive: true });
  fs.writeFileSync(
    path.join(episodeDir, 'episode.json'),
    JSON.stringify({ id: 'episode_retry', title: '重试测试', shots: [{ id: 'shot_001' }] }, null, 2),
    'utf8'
  );
  writeJson(path.join(tempProjectsDir, 'project_retry', 'scripts', 'script_retry', 'script.json'), {
    id: 'script_retry',
    projectId: 'project_retry',
    title: '重试测试',
    sourceText: '【画面1】\n场景：客厅。\n人物：周凛。\n动作：周凛抬头看向灯光。\n对白：周凛：再试一次。\n时长：5秒',
    parseOk: true,
    shotCount: 1,
  });
  fs.writeFileSync(
    path.join(episodeDir, 'run-jobs', 'run_previous.json'),
    JSON.stringify(
      {
        id: 'run_previous',
        runKey: 'rk_previous',
        projectId: 'project_retry',
        scriptId: 'script_retry',
        episodeId: 'episode_retry',
        jobId: 'job_previous',
        status: 'failed',
        startedAt: '2026-06-17T00:00:00.000Z',
      },
      null,
      2
    ),
    'utf8'
  );

  let spawned = null;
  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    spawnProcess(command, args) {
      spawned = { command, args };
      return { pid: 12345, unref() {} };
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs', {
    method: 'POST',
    body: {
      runKey: 'rk_previous',
      mode: { kind: 'retry', runKey: 'rk_previous', stopAt: 'before_video' },
    },
  });

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(spawned.args.includes('--project=project_retry'), true);
  assert.equal(spawned.args.includes('--script=script_retry'), true);
  assert.equal(spawned.args.includes('--episode=episode_retry'), true);
});

test('GET /api/runs/:runId resolves run detail by runKey', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-runkey-detail-'));
  const { tempProjectsDir } = createReviewRunFixture(workspaceRoot);
  const runJobPath = path.join(
    tempProjectsDir,
    'project_happyhorse',
    'scripts',
    'script_1',
    'episodes',
    'episode_1',
    'run-jobs',
    'run_post_loop_fixture.json'
  );
  const runJob = JSON.parse(fs.readFileSync(runJobPath, 'utf8'));
  runJob.runKey = 'rk_post_loop_fixture';
  fs.writeFileSync(runJobPath, JSON.stringify(runJob, null, 2), 'utf8');

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await requestJson(port, '/api/runs/rk_post_loop_fixture');
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.id, 'run_post_loop_fixture');
    assert.equal(response.payload.runKey, 'rk_post_loop_fixture');
  } finally {
    server.close();
  }
});

test('GET /api/projects returns latestRunKey and nested runKey fields', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-project-runkey-list-'));
  const { tempProjectsDir } = createReviewRunFixture(workspaceRoot);
  const runJobPath = path.join(
    tempProjectsDir,
    'project_happyhorse',
    'scripts',
    'script_1',
    'episodes',
    'episode_1',
    'run-jobs',
    'run_post_loop_fixture.json'
  );
  const runJob = JSON.parse(fs.readFileSync(runJobPath, 'utf8'));
  runJob.runKey = 'rk_project_fixture';
  fs.writeFileSync(runJobPath, JSON.stringify(runJob, null, 2), 'utf8');

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const listResponse = await requestJson(port, '/api/projects');
    assert.equal(listResponse.statusCode, 200);
    assert.equal(listResponse.payload[0].latestRunKey, 'rk_project_fixture');

    const detailResponse = await requestJson(port, '/api/projects/project_happyhorse');
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.payload.latestRunKey, 'rk_project_fixture');
    assert.equal(detailResponse.payload.scripts[0].episodes[0].latestRunKey, 'rk_project_fixture');
    assert.equal(detailResponse.payload.scripts[0].episodes[0].runs[0].runKey, 'rk_project_fixture');
  } finally {
    server.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});


test('POST /api/runs rejects experimental runtime control plane modes with 410 (P2 单轨收敛移除)', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-runtime-removed-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    for (const kind of ['resume_runtime', 'rerun_stage']) {
      const response = await requestJson(port, '/api/runs', {
        method: 'POST',
        body: {
          projectId: 'project_demo',
          scriptId: 'script_demo',
          episodeId: 'episode_demo',
          mode: { kind, runId: 'run_any' },
        },
      });
      assert.equal(response.statusCode, 410);
      assert.match(response.payload.error, /Experimental runtime control plane has been removed/);
    }
  } finally {
    server.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('POST /api/scripts/professionalize rewrites rough text into professional script format', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-script-professionalize-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  let capturedMessages = null;

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    async scriptProfessionalizeChat(messages) {
      capturedMessages = messages;
      return [
        '【画面1】',
        '场景：智能公寓客厅，夜晚。',
        '人物：周凛。',
        '动作：周凛按下平板上的灯光按钮，吊灯闪烁后熄灭。',
        '对白：周凛（压低声音）：这套系统到底还能不能用？',
        '时长：6秒',
      ].join('\n');
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/scripts/professionalize', {
    method: 'POST',
    body: {
      title: '精英的困境',
      content: '周凛家里的智能系统坏了，他很生气。',
    },
  });

  server.close();

  assert.equal(response.statusCode, 200);
  assert.match(response.payload.content, /【画面1】/);
  assert.match(response.payload.content, /场景：/);
  assert.match(capturedMessages[0].content, /剧本专业化改造/);
  assert.match(capturedMessages[1].content, /精英的困境/);
  assert.equal(response.payload.source, 'llm');
});

test('POST /api/scripts/professionalize fast-normalizes existing professional script without LLM', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-script-professionalize-fast-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  let llmCallCount = 0;

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    async scriptProfessionalizeChat() {
      llmCallCount += 1;
      throw new Error('LLM should not be called');
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/scripts/professionalize', {
    method: 'POST',
    body: {
      title: '已有格式',
      content: [
        '画面 7：',
        '场景：智能公寓客厅，夜晚。',
        '人物：周凛。',
        '动作：周凛按下平板上的灯光按钮，吊灯闪烁后熄灭。',
        '对白：周凛：这套系统到底还能不能用？',
        '时长：6秒',
      ].join('\n'),
    },
  });

  server.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.source, 'local-normalize');
  assert.equal(response.payload.cached, false);
  assert.match(response.payload.content, /^第1集《已有格式》\n【画面1】/);
  assert.equal(llmCallCount, 0);
});

test('POST /api/scripts/professionalize caches repeated LLM rewrites', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-script-professionalize-cache-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  let llmCallCount = 0;

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    async scriptProfessionalizeChat() {
      llmCallCount += 1;
      return [
        '【画面1】',
        '场景：智能公寓客厅，夜晚。',
        '人物：周凛。',
        '动作：周凛盯着失控的智能面板，指节敲在桌沿。',
        '对白：周凛：又坏了？',
        '时长：5秒',
      ].join('\n');
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = {
    title: '缓存测试',
    content: '周凛家里的智能系统又坏了，他很烦。',
  };
  const first = await requestJson(port, '/api/scripts/professionalize', { method: 'POST', body });
  const second = await requestJson(port, '/api/scripts/professionalize', { method: 'POST', body });

  server.close();

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.payload.source, 'llm');
  assert.equal(second.payload.cached, true);
  assert.equal(llmCallCount, 1);
});

test('PUT /api/projects/:projectId/scripts/:scriptId syncs optimized script into runnable project files', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-script-update-sync-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  await requestJson(port, '/api/projects', {
    method: 'POST',
    body: { title: '同步测试项目' },
  });

  const createResponse = await requestJson(port, '/api/projects/project_sync_test/scripts', {
    method: 'POST',
    body: {
      title: '原始脚本',
      content: '周凛家里的智能系统坏了，他很生气。',
    },
  });

  const scriptId = createResponse.payload.id;
  const episodeId = createResponse.payload.episodeId;
  const optimizedContent = [
    '【画面1】',
    '场景：智能公寓客厅，夜晚。',
    '人物：周凛。',
    '动作：周凛按下平板上的灯光按钮，吊灯闪烁后熄灭。',
    '对白：周凛：这套系统到底还能不能用？',
    '时长：6秒',
    '',
    '【画面2】',
    '场景：同一客厅，窗帘旁。',
    '人物：周凛。',
    '动作：智能窗帘卡在半空，周凛扯松领带盯着故障面板。',
    '对白：周凛：马上派人过来。',
    '时长：5秒',
  ].join('\n');

  const updateResponse = await requestJson(port, `/api/projects/project_sync_test/scripts/${scriptId}`, {
    method: 'PUT',
    body: {
      title: 'S1E1：精英的困境',
      content: optimizedContent,
    },
  });
  const scriptsResponse = await requestJson(port, '/api/projects/project_sync_test/scripts');

  server.close();

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.payload.parseOk, true);
  assert.equal(updateResponse.payload.shotCount, 2);

  const scriptJsonPath = path.join(tempProjectsDir, 'project_sync_test', 'scripts', scriptId, 'script.json');
  const episodeJsonPath = path.join(tempProjectsDir, 'project_sync_test', 'scripts', scriptId, 'episodes', episodeId, 'episode.json');
  const scriptJson = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf8'));
  const episodeJson = JSON.parse(fs.readFileSync(episodeJsonPath, 'utf8'));

  assert.equal(scriptJson.title, 'S1E1：精英的困境');
  assert.match(scriptJson.content, /【画面1】/);
  assert.equal(episodeJson.title, 'S1E1：精英的困境');
  assert.equal(episodeJson.shots.length, 2);
  assert.equal(episodeJson.shots[0].id, 'shot_001');
  assert.match(episodeJson.shots[0].scene, /智能公寓客厅/);

  assert.equal(scriptsResponse.payload[0].parseOk, true);
  assert.equal(scriptsResponse.payload[0].shotCount, 2);
});

test('POST /api/runs records script parser preflight failures as failed run jobs', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-script-preflight-fail-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  let spawnCalled = false;

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    spawnProcess() {
      spawnCalled = true;
      throw new Error('spawn should not be called');
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const projectResponse = await requestJson(port, '/api/projects', {
    method: 'POST',
    body: { title: '预检失败项目' },
  });
  const projectId = projectResponse.payload.id;
  const createResponse = await requestJson(port, `/api/projects/${projectId}/scripts`, {
    method: 'POST',
    body: {
      title: '散文草稿',
      content: '这是一段没有任何画面标记的散文式草稿。',
    },
  });
  assert.equal(createResponse.payload.parseOk, false);
  assert.match(createResponse.payload.parseError, /未找到任何【画面N】/);

  const runResponse = await requestJson(port, '/api/runs', {
    method: 'POST',
    body: {
      projectId,
      scriptId: createResponse.payload.id,
      episodeId: createResponse.payload.episodeId,
      mode: { kind: 'stop', stopAt: 'after_images' },
    },
  });
  const runDetail = await requestJson(port, `/api/runs/${runResponse.payload.runId}`);

  server.close();

  assert.equal(spawnCalled, false);
  assert.equal(runResponse.statusCode, 200);
  assert.equal(runResponse.payload.success, false);
  assert.equal(runResponse.payload.status, 'failed');
  assert.match(runResponse.payload.error, /未找到任何【画面N】/);
  assert.equal(runDetail.payload.status, 'failed');
  assert.match(runDetail.payload.error, /未找到任何【画面N】/);
  assert.equal(runDetail.payload.agentTaskRuns[0].agent, 'Script Parser');
  assert.equal(runDetail.payload.agentTaskRuns[0].status, 'failed');
  assert.equal(runDetail.payload.qaOverview.status, 'block');
  assert.equal(runDetail.payload.qaOverview.headline, '剧本解析失败');
  assert.equal(runDetail.payload.qaOverview.blockCount, 1);
});

test('GET /api/runs/:id keeps real QA overview ahead of run error fallback', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-real-qa-priority-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const runDir = path.join(workspaceRoot, 'temp', 'projects', 'project_qa', 'scripts', 'script_qa', 'episodes', 'episode_qa', 'runs', 'run_qa_artifacts');
  const runJobPath = path.join(tempProjectsDir, 'project_qa', 'scripts', 'script_qa', 'episodes', 'episode_qa', 'run-jobs', 'run_real_qa.json');
  writeJson(runJobPath, {
    id: 'run_real_qa',
    projectId: 'project_qa',
    scriptId: 'script_qa',
    episodeId: 'episode_qa',
    jobId: 'run_real_qa',
    status: 'failed',
    startedAt: '2026-06-23T00:00:00.000Z',
    finishedAt: '2026-06-23T00:00:01.000Z',
    error: 'early parser failure',
    artifactRunDir: runDir,
    agentTaskRuns: [],
  });
  writeJson(path.join(runDir, 'qa-overview.json'), {
    status: 'warn',
    headline: '真实 QA 摘要',
    summary: '真实 QA 应该优先。',
    passCount: 1,
    warnCount: 1,
    blockCount: 0,
    agentSummaries: [{ agentName: 'Real QA', status: 'warn', headline: '真实 QA 摘要' }],
  });

  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
  const response = await withServer(server, (port) => requestJson(port, '/api/runs/run_real_qa'));

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.qaOverview.headline, '真实 QA 摘要');
  assert.equal(response.payload.qaOverview.status, 'warn');
  assert.equal(response.payload.qaOverview.blockCount, 0);
});

test('POST /api/runs repairs stale script.json from uploaded script before spawning', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-script-preflight-repair-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  let spawned = null;

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    spawnProcess(command, args) {
      spawned = { command, args };
      return { pid: 12345, unref() {} };
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const projectResponse = await requestJson(port, '/api/projects', {
    method: 'POST',
    body: { title: '历史修复项目' },
  });
  const projectId = projectResponse.payload.id;
  const createResponse = await requestJson(port, `/api/projects/${projectId}/scripts`, {
    method: 'POST',
    body: {
      title: '旧草稿',
      content: '这是一段旧散文。',
    },
  });
  const professionalContent = [
    '【画面1】',
    '场景：智能公寓客厅，夜晚。',
    '人物：周凛。',
    '动作：周凛按下平板上的灯光按钮，灯光闪烁后熄灭。',
    '对白：周凛：怎么回事？',
    '时长：6秒',
  ].join('\n');
  fs.writeFileSync(
    path.join(tempProjectsDir, projectId, 'uploaded-scripts', `${createResponse.payload.id}.txt`),
    professionalContent,
    'utf8'
  );
  const scriptsResponse = await requestJson(port, `/api/projects/${projectId}/scripts`);
  assert.equal(scriptsResponse.payload[0].parseOk, true);
  assert.equal(scriptsResponse.payload[0].shotCount, 1);

  const runResponse = await requestJson(port, '/api/runs', {
    method: 'POST',
    body: {
      projectId,
      scriptId: createResponse.payload.id,
      episodeId: createResponse.payload.episodeId,
      mode: { kind: 'stop', stopAt: 'before_video' },
    },
  });

  server.close();

  const episodeJsonPath = path.join(
    tempProjectsDir,
    projectId,
    'scripts',
    createResponse.payload.id,
    'episodes',
    createResponse.payload.episodeId,
    'episode.json'
  );
  const episodeJson = JSON.parse(fs.readFileSync(episodeJsonPath, 'utf8'));

  assert.equal(runResponse.statusCode, 200);
  assert.equal(runResponse.payload.success, true);
  assert.equal(spawned.command, 'node');
  assert.equal(spawned.args.includes('--stop-at=before_video'), true);
  assert.equal(episodeJson.shots.length, 1);
});

test('POST /api/runs retry rejects cleanup of absolute sibling artifact path outside workspace', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-retry-abs-safe-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const siblingDir = `${workspaceRoot}-evil`;
  const siblingFile = path.join(siblingDir, 'sentinel.txt');
  fs.mkdirSync(siblingDir, { recursive: true });
  fs.writeFileSync(siblingFile, 'keep', 'utf8');

  const episodeDir = path.join(
    tempProjectsDir,
    'project_retry',
    'scripts',
    'script_retry',
    'episodes',
    'episode_retry'
  );
  fs.mkdirSync(path.join(episodeDir, 'run-jobs'), { recursive: true });
  writeJson(path.join(episodeDir, 'episode.json'), {
    id: 'episode_retry',
    title: '重试测试',
    shots: [{ id: 'shot_001' }],
  });
  writeJson(path.join(episodeDir, 'run-jobs', 'run_previous.json'), {
    id: 'run_previous',
    projectId: 'project_retry',
    scriptId: 'script_retry',
    episodeId: 'episode_retry',
    jobId: 'job_previous',
    artifactRunDir: siblingDir,
    status: 'failed',
    startedAt: '2026-06-17T00:00:00.000Z',
  });

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    spawnProcess() {
      throw new Error('spawn should not be called for unsafe cleanup path');
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs', {
    method: 'POST',
    body: {
      projectId: 'project_retry',
      scriptId: 'script_retry',
      episodeId: 'episode_retry',
      mode: { kind: 'retry', stopAt: 'before_video' },
    },
  });

  server.close();

  assert.equal(response.statusCode, 400);
  assert.equal(fs.existsSync(siblingFile), true);
  assert.match(response.payload.error, /outside workspace|unsafe/i);
});

test('POST /api/runs retry rejects cleanup of relative traversal artifact path outside workspace', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-retry-rel-safe-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const siblingDir = `${workspaceRoot}-evil`;
  const siblingFile = path.join(siblingDir, 'sentinel.txt');
  fs.mkdirSync(siblingDir, { recursive: true });
  fs.writeFileSync(siblingFile, 'keep', 'utf8');

  const episodeDir = path.join(
    tempProjectsDir,
    'project_retry',
    'scripts',
    'script_retry',
    'episodes',
    'episode_retry'
  );
  fs.mkdirSync(path.join(episodeDir, 'run-jobs'), { recursive: true });
  writeJson(path.join(episodeDir, 'episode.json'), {
    id: 'episode_retry',
    title: '重试测试',
    shots: [{ id: 'shot_001' }],
  });
  writeJson(path.join(episodeDir, 'run-jobs', 'run_previous.json'), {
    id: 'run_previous',
    projectId: 'project_retry',
    scriptId: 'script_retry',
    episodeId: 'episode_retry',
    jobId: 'job_previous',
    artifactRunDir: `../${path.basename(siblingDir)}`,
    status: 'failed',
    startedAt: '2026-06-17T00:00:00.000Z',
  });

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    spawnProcess() {
      throw new Error('spawn should not be called for unsafe cleanup path');
    },
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await requestJson(port, '/api/runs', {
    method: 'POST',
    body: {
      projectId: 'project_retry',
      scriptId: 'script_retry',
      episodeId: 'episode_retry',
      mode: { kind: 'retry', stopAt: 'before_video' },
    },
  });

  server.close();

  assert.equal(response.statusCode, 400);
  assert.equal(fs.existsSync(siblingFile), true);
  assert.match(response.payload.error, /outside workspace|unsafe/i);
});

test('GET /api/settings/providers returns grouped provider settings payload', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-settings-'));
  fs.writeFileSync(
    path.join(workspaceRoot, '.env'),
    [
      'LLM_PROVIDER=qwen',
      'QWEN_API_KEY=test-qwen-key',
      'QWEN_MODEL=qwen3.7-plus',
      'LLM_VISION_PROVIDER=qwen',
      'IMAGE_API_BASE_URL=https://image.example/v1',
      'IMAGE_API_KEY=test-image-key',
      'TTS_PROVIDER=minimax',
      'MINIMAX_API_KEY=test-minimax-key',
      'VIDEO_PROVIDER=happyhorse',
      'VIDEO_TRANSPORT_PROVIDER=dashscope_async',
      'VIDEO_TRANSPORT_BASE_URL=https://dashscope.aliyuncs.com',
      'VIDEO_TRANSPORT_API_KEY=test-video-key',
      'VIDEO_MODEL_SHOT=happyhorse-1.0-r2v',
    ].join('\n'),
    'utf8'
  );
  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await requestJson(port, '/api/settings/providers');

  server.close();

  assert.equal(body.statusCode, 200);
  assert.equal(body.payload.mode, 'configurable-workbench');
  assert.equal(Array.isArray(body.payload.sections), true);
  assert.equal(body.payload.sections[0].id, 'llmText');
  assert.equal(body.payload.sections[0].fields.some((field) => field.key === 'QWEN_API_KEY' && field.value === '' && field.configured), true);
});

test('PUT /api/settings/providers persists config updates without echoing secrets', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-settings-save-'));
  const envFilePath = path.join(workspaceRoot, '.env');
  fs.writeFileSync(envFilePath, 'LLM_PROVIDER=qwen\nQWEN_API_KEY=old-secret\nQWEN_MODEL=qwen-old\n', 'utf8');

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const current = await requestJson(port, '/api/settings/providers');
  const updatedSections = current.payload.sections.map((section) => (
    section.id !== 'llmText'
      ? section
      : {
          ...section,
          fields: section.fields.map((field) => {
            if (field.key === 'QWEN_MODEL') return { ...field, value: 'qwen3.7-plus' };
            if (field.key === 'QWEN_API_KEY') return { ...field, value: 'new-secret' };
            return field;
          }),
        }
  ));

  const response = await requestJson(port, '/api/settings/providers', {
    method: 'PUT',
    body: { sections: updatedSections },
  });

  server.close();

  const envText = fs.readFileSync(envFilePath, 'utf8');
  assert.equal(response.statusCode, 200);
  assert.match(envText, /QWEN_MODEL=qwen3\.7-plus/);
  assert.match(envText, /QWEN_API_KEY=new-secret/);
  const secretField = response.payload.sections[0].fields.find((field) => field.key === 'QWEN_API_KEY');
  assert.equal(secretField.value, '');
  assert.equal(secretField.configured, true);
});

test('PUT /api/settings/providers requires WORKBENCH_TOKEN when configured', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-settings-token-required-'));
  const envFilePath = path.join(workspaceRoot, '.env');
  fs.writeFileSync(envFilePath, 'LLM_PROVIDER=qwen\nQWEN_MODEL=qwen-old\n', 'utf8');

  const previousToken = process.env.WORKBENCH_TOKEN;
  process.env.WORKBENCH_TOKEN = 'local-secret-token';

  try {
    const server = createWorkbenchServer({
      workspaceRoot,
      tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
    });

    const response = await withServer(server, (port) =>
      requestJson(port, '/api/settings/providers', {
        method: 'PUT',
        body: {
          sections: [
            {
              id: 'llmText',
              fields: [
                { key: 'QWEN_MODEL', kind: 'text', value: 'qwen3.7-plus' },
              ],
            },
          ],
        },
      })
    );

    assert.equal(response.statusCode, 401);
    assert.equal(response.payload.error, 'Unauthorized');
    assert.equal(fs.readFileSync(envFilePath, 'utf8'), 'LLM_PROVIDER=qwen\nQWEN_MODEL=qwen-old\n');
  } finally {
    if (previousToken === undefined) {
      delete process.env.WORKBENCH_TOKEN;
    } else {
      process.env.WORKBENCH_TOKEN = previousToken;
    }
  }
});

test('PUT /api/settings/providers accepts Bearer token when WORKBENCH_TOKEN is configured', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-settings-token-accept-'));
  const envFilePath = path.join(workspaceRoot, '.env');
  fs.writeFileSync(envFilePath, 'LLM_PROVIDER=qwen\nQWEN_MODEL=qwen-old\n', 'utf8');

  const previousToken = process.env.WORKBENCH_TOKEN;
  process.env.WORKBENCH_TOKEN = 'local-secret-token';

  try {
    const server = createWorkbenchServer({
      workspaceRoot,
      tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
    });

    const response = await withServer(server, (port) =>
      requestJson(port, '/api/settings/providers', {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer local-secret-token',
        },
        body: {
          sections: [
            {
              id: 'llmText',
              fields: [
                { key: 'QWEN_MODEL', kind: 'text', value: 'qwen3.7-plus' },
              ],
            },
          ],
        },
      })
    );

    assert.equal(response.statusCode, 200);
    assert.match(fs.readFileSync(envFilePath, 'utf8'), /QWEN_MODEL=qwen3\.7-plus/);
  } finally {
    if (previousToken === undefined) {
      delete process.env.WORKBENCH_TOKEN;
    } else {
      process.env.WORKBENCH_TOKEN = previousToken;
    }
  }
});

test('POST /api/settings/providers/precheck returns section results', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-settings-check-'));
  fs.writeFileSync(
    path.join(workspaceRoot, '.env'),
    [
      'LLM_PROVIDER=qwen',
      'QWEN_API_KEY=missing-real-connectivity',
      'QWEN_MODEL=qwen3.7-plus',
      'LLM_VISION_PROVIDER=qwen',
      'QWEN_VISION_MODEL=qwen-vl-max',
      'IMAGE_API_BASE_URL=https://image.example/v1',
      'IMAGE_API_KEY=test-image-key',
      'TTS_PROVIDER=minimax',
      'MINIMAX_API_KEY=test-minimax-key',
      'VIDEO_PROVIDER=happyhorse',
      'VIDEO_TRANSPORT_PROVIDER=dashscope_async',
      'VIDEO_TRANSPORT_BASE_URL=https://dashscope.aliyuncs.com',
      'VIDEO_TRANSPORT_API_KEY=test-video-key',
      'VIDEO_MODEL_SHOT=happyhorse-1.0-r2v',
      'ASR_PROVIDER=mock',
      'LIPSYNC_PROVIDER=mock',
    ].join('\n'),
    'utf8'
  );

  const previousEnv = {
    LLM_PROVIDER: 'qwen',
    QWEN_API_KEY: process.env.QWEN_API_KEY,
    QWEN_MODEL: process.env.QWEN_MODEL,
    LLM_VISION_PROVIDER: process.env.LLM_VISION_PROVIDER,
    QWEN_VISION_MODEL: process.env.QWEN_VISION_MODEL,
    IMAGE_API_BASE_URL: process.env.IMAGE_API_BASE_URL,
    IMAGE_API_KEY: process.env.IMAGE_API_KEY,
    TTS_PROVIDER: process.env.TTS_PROVIDER,
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
    VIDEO_PROVIDER: process.env.VIDEO_PROVIDER,
    VIDEO_TRANSPORT_PROVIDER: process.env.VIDEO_TRANSPORT_PROVIDER,
    VIDEO_TRANSPORT_BASE_URL: process.env.VIDEO_TRANSPORT_BASE_URL,
    VIDEO_TRANSPORT_API_KEY: process.env.VIDEO_TRANSPORT_API_KEY,
    VIDEO_MODEL_SHOT: process.env.VIDEO_MODEL_SHOT,
    ASR_PROVIDER: process.env.ASR_PROVIDER,
    LIPSYNC_PROVIDER: process.env.LIPSYNC_PROVIDER,
  };

  Object.assign(process.env, {
    LLM_PROVIDER: 'qwen',
    QWEN_API_KEY: '',
    QWEN_MODEL: 'qwen3.7-plus',
    LLM_VISION_PROVIDER: 'qwen',
    QWEN_VISION_MODEL: 'qwen-vl-max',
    IMAGE_API_BASE_URL: 'https://image.example/v1',
    IMAGE_API_KEY: 'test-image-key',
    TTS_PROVIDER: 'minimax',
    MINIMAX_API_KEY: 'test-minimax-key',
    VIDEO_PROVIDER: 'happyhorse',
    VIDEO_TRANSPORT_PROVIDER: 'dashscope_async',
    VIDEO_TRANSPORT_BASE_URL: 'https://dashscope.aliyuncs.com',
    VIDEO_TRANSPORT_API_KEY: 'test-video-key',
    VIDEO_MODEL_SHOT: 'happyhorse-1.0-r2v',
    ASR_PROVIDER: 'mock',
    LIPSYNC_PROVIDER: 'mock',
  });

  try {
    const server = createWorkbenchServer({
      workspaceRoot,
      tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
    });
    const response = await withServer(server, (port) =>
      requestJson(port, '/api/settings/providers/precheck', { method: 'POST' })
    );

    assert.equal(response.statusCode, 200);
    assert.equal(Array.isArray(response.payload.results), true);
    assert.equal(response.payload.results.length >= 5, true);
    assert.equal(response.payload.results.some((item) => item.sectionId === 'video'), true);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('DELETE /api/projects rejects invalid projectId path segments', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-project-delete-invalid-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });

  const response = await withServer(server, (port) =>
    requestJson(port, '/api/projects/..%5Cevil', { method: 'DELETE' })
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /projectId/i);
});

test('GET storyboard rejects invalid locator path segments', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-storyboard-invalid-locator-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });

  const response = await withServer(server, (port) =>
    requestJson(port, '/api/projects/project_ok/scripts/..%5Cbad/episodes/episode_ok/storyboard')
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.payload.error, /scriptId/i);
});

test('PUT /api/settings/providers ignores unknown keys and keeps .env scoped to workspace root', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-settings-whitelist-'));
  const envFilePath = path.join(workspaceRoot, '.env');
  fs.writeFileSync(envFilePath, 'LLM_PROVIDER=qwen\nQWEN_MODEL=qwen-old\n', 'utf8');

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });

  const response = await withServer(server, (port) =>
    requestJson(port, '/api/settings/providers', {
      method: 'PUT',
      body: {
        sections: [
          {
            id: 'llmText',
            fields: [
              { key: 'QWEN_MODEL', kind: 'text', value: 'qwen3.7-plus' },
              { key: 'PATH', kind: 'text', value: 'C:\\\\evil' },
            ],
          },
        ],
      },
    })
  );

  const envText = fs.readFileSync(envFilePath, 'utf8');
  assert.equal(response.statusCode, 200);
  assert.match(envText, /QWEN_MODEL=qwen3\.7-plus/);
  assert.doesNotMatch(envText, /^PATH=/m);
});

test('GET /api/runs/:id reconciles stale running runs when child process already exited', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-stale-run-reconcile-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_demo',
    'scripts',
    'script_demo',
    'episodes',
    'episode_demo'
  );
  const runId = 'run_stale_demo';
  const runDir = path.join(
    workspaceRoot,
    'temp',
    'projects',
    'project_demo',
    'scripts',
    'script_demo',
    'episodes',
    'episode_demo',
    'runs',
    'run_artifact_demo'
  );
  const runJobPath = path.join(episodeDir, 'run-jobs', `${runId}.json`);
  const runLogPath = path.join(episodeDir, 'run-jobs', `${runId}.log`);

  writeJson(runJobPath, {
    id: runId,
    projectId: 'project_demo',
    scriptId: 'script_demo',
    episodeId: 'episode_demo',
    jobId: 'job_demo',
    status: 'running',
    startedAt: '2026-06-23T00:00:00.000Z',
    finishedAt: null,
    error: null,
    artifactRunDir: runDir,
    artifactManifestPath: path.join(runDir, 'manifest.json'),
    artifactTimelinePath: path.join(runDir, 'timeline.json'),
  });
  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, 'manifest.json'), { status: 'running' });
  writeJson(path.join(runDir, 'state.snapshot.json'), {
    startedAt: '2026-06-23T00:00:00.000Z',
  });
  fs.mkdirSync(path.dirname(runLogPath), { recursive: true });
  fs.writeFileSync(runLogPath, `${new Date().toISOString()} [WorkbenchRunTrigger] spawned pid=424242\n`, 'utf8');

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    isProcessAlive: () => false,
  });

  await withServer(server, async (port) => {
    const response = await requestJson(port, `/api/runs/${runId}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, 'failed');
    assert.match(response.payload.error, /terminal run state/i);
  });

  const persistedRunJob = JSON.parse(fs.readFileSync(runJobPath, 'utf8'));
  assert.equal(persistedRunJob.status, 'failed');
  assert.ok(persistedRunJob.finishedAt);
});

test('GET /api/runs/:id reconciles early parser failures from live state', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-live-run-reconcile-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_demo',
    'scripts',
    'script_demo',
    'episodes',
    'episode_demo'
  );
  const runId = 'run_early_parser_failed';
  const runJobPath = path.join(episodeDir, 'run-jobs', `${runId}.json`);
  const runLogPath = path.join(episodeDir, 'run-jobs', `${runId}.log`);
  const liveStateDir = path.join(workspaceRoot, 'temp', runId);

  writeJson(runJobPath, {
    id: runId,
    projectId: 'project_demo',
    scriptId: 'script_demo',
    episodeId: 'episode_demo',
    jobId: runId,
    status: 'pending',
    startedAt: '2026-06-23T00:00:00.000Z',
    finishedAt: null,
    error: null,
    artifactRunDir: null,
    debugLogPath: runLogPath,
  });
  fs.mkdirSync(liveStateDir, { recursive: true });
  writeJson(path.join(liveStateDir, 'state.json'), {
    failedAt: '2026-06-23T00:00:03.000Z',
    lastError: 'professional-script 模式未找到任何【画面N】',
  });

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    isProcessAlive: () => false,
  });

  await withServer(server, async (port) => {
    const response = await requestJson(port, `/api/runs/${runId}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, 'failed');
    assert.equal(response.payload.finishedAt, '2026-06-23T00:00:03.000Z');
    assert.match(response.payload.error, /未找到任何【画面N】/);
  });

  const persistedRunJob = JSON.parse(fs.readFileSync(runJobPath, 'utf8'));
  assert.equal(persistedRunJob.status, 'failed');
  assert.equal(persistedRunJob.finishedAt, '2026-06-23T00:00:03.000Z');
  assert.match(persistedRunJob.error, /未找到任何【画面N】/);
});

test('GET /api/runs/:id reconciles early parser failures from run log', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-log-run-reconcile-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_demo',
    'scripts',
    'script_demo',
    'episodes',
    'episode_demo'
  );
  const runId = 'run_early_parser_log_failed';
  const runJobPath = path.join(episodeDir, 'run-jobs', `${runId}.json`);
  const runLogPath = path.join(episodeDir, 'run-jobs', `${runId}.log`);

  writeJson(runJobPath, {
    id: runId,
    projectId: 'project_demo',
    scriptId: 'script_demo',
    episodeId: 'episode_demo',
    jobId: runId,
    status: 'pending',
    startedAt: '2026-06-23T00:00:00.000Z',
    finishedAt: null,
    error: null,
    artifactRunDir: null,
    debugLogPath: runLogPath,
  });
  fs.mkdirSync(path.dirname(runLogPath), { recursive: true });
  fs.writeFileSync(
    runLogPath,
    [
      `${new Date().toISOString()} [WorkbenchRunTrigger] spawned pid=424242`,
      '\u001b[31m15:50:53 ERROR [Main]\u001b[0m 生成失败：professional-script 模式未找到任何【画面N】，如需改编散文/小说请使用 --input-format=raw-novel',
    ].join('\n'),
    'utf8'
  );

  const server = createWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    isProcessAlive: () => false,
  });

  await withServer(server, async (port) => {
    const response = await requestJson(port, `/api/runs/${runId}`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.status, 'failed');
    assert.match(response.payload.error, /未找到任何【画面N】/);
  });

  const persistedRunJob = JSON.parse(fs.readFileSync(runJobPath, 'utf8'));
  assert.equal(persistedRunJob.status, 'failed');
  assert.match(persistedRunJob.error, /未找到任何【画面N】/);
});

test('POST /api/settings/providers/precheck surfaces image auth rejection from live probe', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-settings-image-auth-'));
  fs.writeFileSync(
    path.join(workspaceRoot, '.env'),
    [
      'LLM_PROVIDER=qwen',
      'QWEN_API_KEY=test-qwen-key',
      'QWEN_MODEL=qwen3.7-plus',
      'LLM_VISION_PROVIDER=qwen',
      'QWEN_VISION_MODEL=qwen-vl-max',
      'IMAGE_API_BASE_URL=https://image.example/v1',
      'IMAGE_API_KEY=test-image-key',
      'REALISTIC_IMAGE_MODEL=gpt-image-2',
      'TTS_PROVIDER=minimax',
      'MINIMAX_API_KEY=test-minimax-key',
      'VIDEO_PROVIDER=happyhorse',
      'VIDEO_TRANSPORT_PROVIDER=dashscope_async',
      'VIDEO_TRANSPORT_BASE_URL=https://dashscope.aliyuncs.com',
      'VIDEO_TRANSPORT_API_KEY=test-video-key',
      'VIDEO_MODEL_SHOT=happyhorse-1.0-r2v',
      'ASR_PROVIDER=mock',
      'LIPSYNC_PROVIDER=mock',
    ].join('\n'),
    'utf8'
  );

  const previousFetch = global.fetch;
  const previousEnv = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    QWEN_API_KEY: process.env.QWEN_API_KEY,
    QWEN_MODEL: process.env.QWEN_MODEL,
    LLM_VISION_PROVIDER: process.env.LLM_VISION_PROVIDER,
    QWEN_VISION_MODEL: process.env.QWEN_VISION_MODEL,
    IMAGE_API_BASE_URL: process.env.IMAGE_API_BASE_URL,
    IMAGE_API_KEY: process.env.IMAGE_API_KEY,
    REALISTIC_IMAGE_MODEL: process.env.REALISTIC_IMAGE_MODEL,
    TTS_PROVIDER: process.env.TTS_PROVIDER,
    MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
    VIDEO_PROVIDER: process.env.VIDEO_PROVIDER,
    VIDEO_TRANSPORT_PROVIDER: process.env.VIDEO_TRANSPORT_PROVIDER,
    VIDEO_TRANSPORT_BASE_URL: process.env.VIDEO_TRANSPORT_BASE_URL,
    VIDEO_TRANSPORT_API_KEY: process.env.VIDEO_TRANSPORT_API_KEY,
    VIDEO_MODEL_SHOT: process.env.VIDEO_MODEL_SHOT,
    ASR_PROVIDER: process.env.ASR_PROVIDER,
    LIPSYNC_PROVIDER: process.env.LIPSYNC_PROVIDER,
  };

  Object.assign(process.env, {
    LLM_PROVIDER: 'qwen',
    QWEN_API_KEY: 'test-qwen-key',
    QWEN_MODEL: 'qwen3.7-plus',
    LLM_VISION_PROVIDER: 'qwen',
    QWEN_VISION_MODEL: 'qwen-vl-max',
    IMAGE_API_BASE_URL: 'https://image.example/v1',
    IMAGE_API_KEY: 'test-image-key',
    REALISTIC_IMAGE_MODEL: 'gpt-image-2',
    TTS_PROVIDER: 'minimax',
    MINIMAX_API_KEY: 'test-minimax-key',
    VIDEO_PROVIDER: 'happyhorse',
    VIDEO_TRANSPORT_PROVIDER: 'dashscope_async',
    VIDEO_TRANSPORT_BASE_URL: 'https://dashscope.aliyuncs.com',
    VIDEO_TRANSPORT_API_KEY: 'test-video-key',
    VIDEO_MODEL_SHOT: 'happyhorse-1.0-r2v',
    ASR_PROVIDER: 'mock',
    LIPSYNC_PROVIDER: 'mock',
  });

  global.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => 'Forbidden',
  });

  try {
    const server = createWorkbenchServer({
      workspaceRoot,
      tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
    });
    const response = await withServer(server, (port) =>
      requestJson(port, '/api/settings/providers/precheck', { method: 'POST' })
    );

    assert.equal(response.statusCode, 200);
    const imageResult = response.payload.results.find((item) => item.sectionId === 'image');
    assert.equal(imageResult.checkType, 'live');
    assert.equal(imageResult.ok, false);
    assert.match(imageResult.message, /访问被拒绝|拒绝/);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('POST /api/settings/providers/precheck rejects html landing page from image provider probe', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-settings-image-html-'));
  fs.writeFileSync(
    path.join(workspaceRoot, '.env'),
    [
      'LLM_PROVIDER=qwen',
      'QWEN_API_KEY=test-qwen-key',
      'QWEN_MODEL=qwen3.7-plus',
      'LLM_VISION_PROVIDER=qwen',
      'QWEN_VISION_MODEL=qwen-vl-max',
      'IMAGE_API_BASE_URL=https://image.example/v1',
      'IMAGE_API_KEY=test-image-key',
      'REALISTIC_IMAGE_MODEL=gpt-image-2',
      'TTS_PROVIDER=minimax',
      'MINIMAX_API_KEY=test-minimax-key',
      'VIDEO_PROVIDER=happyhorse',
      'VIDEO_TRANSPORT_PROVIDER=dashscope_async',
      'VIDEO_TRANSPORT_BASE_URL=https://dashscope.aliyuncs.com',
      'VIDEO_TRANSPORT_API_KEY=test-video-key',
      'VIDEO_MODEL_SHOT=happyhorse-1.0-r2v',
      'ASR_PROVIDER=mock',
      'LIPSYNC_PROVIDER=mock',
    ].join('\n'),
    'utf8'
  );

  const previousFetch = global.fetch;
  const previousEnv = {
    IMAGE_API_BASE_URL: process.env.IMAGE_API_BASE_URL,
    IMAGE_API_KEY: process.env.IMAGE_API_KEY,
    REALISTIC_IMAGE_MODEL: process.env.REALISTIC_IMAGE_MODEL,
  };

  Object.assign(process.env, {
    IMAGE_API_BASE_URL: 'https://image.example/v1',
    IMAGE_API_KEY: 'test-image-key',
    REALISTIC_IMAGE_MODEL: 'gpt-image-2',
  });

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null;
      },
    },
    text: async () => '<!doctype html><html><title>landing</title></html>',
  });

  try {
    const server = createWorkbenchServer({
      workspaceRoot,
      tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
    });
    const response = await withServer(server, (port) =>
      requestJson(port, '/api/settings/providers/precheck', { method: 'POST' })
    );

    assert.equal(response.statusCode, 200);
    const imageResult = response.payload.results.find((item) => item.sectionId === 'image');
    assert.equal(imageResult.checkType, 'live');
    assert.equal(imageResult.ok, false);
    assert.match(imageResult.message, /非模型列表|兼容图像 API/);
    assert.match(imageResult.hint, /API 根路径|\/models JSON/);
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('POST /api/runs/:id/export-jianying writes fallback draft files under workspace output', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-jianying-export-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);

  const originalUserProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = path.join(workspaceRoot, 'fake-user-without-capcut');

  try {
    const server = createWorkbenchServer({ workspaceRoot, tempProjectsDir });
    await withServer(server, async (port) => {
      const response = await requestJson(port, '/api/runs/run_post_loop_fixture/export-jianying');
      assert.equal(response.statusCode, 200);
      assert.equal(response.payload.success, true);
      assert.equal(response.payload.directToCapcut, false);
      assert.match(response.payload.exportPath, /CapCut_Draft/);

      const draftContentPath = path.join(response.payload.exportPath, 'draft_content.json');
      const draftMetaPath = path.join(response.payload.exportPath, 'draft_meta_info.json');
      assert.equal(fs.existsSync(draftContentPath), true);
      assert.equal(fs.existsSync(draftMetaPath), true);

      const draftContent = JSON.parse(fs.readFileSync(draftContentPath, 'utf8'));
      const draftMeta = JSON.parse(fs.readFileSync(draftMetaPath, 'utf8'));
      assert.equal(Array.isArray(draftContent.tracks), true);
      assert.equal(draftContent.tracks.length, 3);
      assert.equal(draftContent.materials.videos.length >= 2, true);
      assert.equal(draftMeta.draft_fold_path, response.payload.exportPath);
      assert.equal(typeof response.payload.durationSec, 'number');
      assert.equal(response.payload.durationSec > 0, true);
    });
  } finally {
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  }
});

test('Fastify workbench server preserves SSE streaming for /api/runs/:id/stream', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-fastify-sse-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_stream',
    'scripts',
    'script_stream',
    'episodes',
    'episode_stream'
  );
  fs.mkdirSync(path.join(episodeDir, 'run-jobs'), { recursive: true });
  writeJson(path.join(episodeDir, 'run-jobs', 'run_stream.json'), {
    id: 'run_stream',
    projectId: 'project_stream',
    scriptId: 'script_stream',
    episodeId: 'episode_stream',
    status: 'completed',
    startedAt: '2026-06-26T00:00:00.000Z',
    finishedAt: '2026-06-26T00:01:00.000Z',
    agentTaskRuns: [{ id: 'task_1', step: 'compose_video', status: 'completed' }],
  });

  const server = createFastifyWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const events = await collectSseEvents(port, '/api/runs/run_stream/stream');
    assert.equal(events[0]?.event, 'status');
    assert.equal(events[0]?.data?.id, 'run_stream');
    assert.equal(events.at(-1)?.event, 'done');
    assert.equal(events.at(-1)?.data?.status, 'completed');
  } finally {
    server.close();
  }
});

test('Fastify workbench server returns runtime control plane in /api/runs/:id', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-fastify-control-plane-'));
  const { tempProjectsDir, runDir } = createReviewRunFixture(workspaceRoot);
  writeJson(path.join(runDir, 'runtime-journal.json'), {
    runtimeVersion: 1,
    status: 'completed',
    updatedAt: '2026-06-27T00:00:00.000Z',
    stages: [
      { stage: 'character', status: 'completed', outputKeys: ['characterRegistry'] },
      { stage: 'compose', status: 'completed', outputKeys: ['finalOutputPath'] },
    ],
    decisions: [
      {
        decisionType: 'video_provider_selection',
        policySource: 'videoProviderPolicy',
        decisionKey: 'shot_001',
        timestamp: '2026-06-27T00:00:00.000Z',
        rationale: 'reference image available, using requested provider seedance',
      },
    ],
  });

  const server = createFastifyWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await requestJson(port, '/api/runs/run_post_loop_fixture');
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.controlPlane.status, 'completed');
    assert.equal(response.payload.controlPlane.currentStage, 'compose');
    assert.equal(Array.isArray(response.payload.controlPlane.availableActions), true);
    assert.equal(
      response.payload.controlPlane.availableActions.some(
        (item) => item.kind === 'rerun_stage' || item.kind === 'resume_runtime'
      ),
      false
    );
  } finally {
    server.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Fastify workbench server serves /api/workbench through legacy compatibility layer', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-fastify-workbench-'));
  const { tempProjectsDir } = createReviewRunFixture(workspaceRoot);

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await requestJson(port, '/api/workbench');
    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.payload.currentRun, 'object');
    assert.equal(typeof response.payload.currentRun.runKey, 'string');
    assert.equal(Array.isArray(response.payload.projects), true);
    assert.equal(typeof response.payload.projects[0].latestRunKey, 'string');
    assert.equal(typeof response.payload.recentRuns[0].runKey, 'string');
  } finally {
    server.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Fastify workbench server preserves professionalize endpoint behavior', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-fastify-professionalize-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  fs.mkdirSync(tempProjectsDir, { recursive: true });

  const server = createFastifyWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    scriptProfessionalizeChat: async () => ({
      text: '【画面1】\n场景：办公室\n人物：小明\n动作：起身\n对白：我来试试。\n时长：5秒',
    }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const response = await requestJson(port, '/api/scripts/professionalize', {
      method: 'POST',
      body: {
        title: '测试剧本',
        content: '小明从工位站起来，说我来试试。',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.parseOk, true);
    assert.match(response.payload.content, /【画面1】/);
  } finally {
    server.close();
  }
});

test('Fastify workbench server enforces Bearer token on protected writes', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-fastify-token-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  fs.mkdirSync(tempProjectsDir, { recursive: true });

  const previousToken = process.env.WORKBENCH_TOKEN;
  process.env.WORKBENCH_TOKEN = 'fastify-secret-token';

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const unauthorized = await requestJson(port, '/api/settings/providers', {
      method: 'PUT',
      body: { sections: [] },
    });
    assert.equal(unauthorized.statusCode, 401);

    const authorized = await requestJson(port, '/api/settings/providers', {
      method: 'PUT',
      headers: { authorization: 'Bearer fastify-secret-token' },
      body: { sections: [] },
    });
    assert.equal(authorized.statusCode, 200);
  } finally {
    server.close();
    if (previousToken === undefined) {
      delete process.env.WORKBENCH_TOKEN;
    } else {
      process.env.WORKBENCH_TOKEN = previousToken;
    }
  }
});
