import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables } from '../scripts/resume-from-step.js';

test('normalizeStepName resolves common aliases', () => {
  assert.equal(__testables.normalizeStepName('lipsync-agent'), 'lipsync');
  assert.equal(__testables.normalizeStepName('video-composer'), 'compose');
  assert.equal(__testables.normalizeStepName('shot-qa'), 'video');
  assert.equal(__testables.normalizeStepName('tts'), 'audio');
});

test('parseCliArgs enters project mode selection when no legacy script file is provided', () => {
  const parsed = __testables.parseCliArgs(['--step=lipsync']);

  assert.equal(parsed.mode, 'project');
  assert.equal(parsed.projectId, null);
  assert.equal(parsed.scriptId, null);
  assert.equal(parsed.episodeId, null);
});

test('getStateKeysToDelete cascades from lipsync to compose only', () => {
  assert.deepEqual(__testables.getStateKeysToDelete('lipsync'), [
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
  ]);
});

test('getStateKeysToDelete for video step clears video generation caches but preserves motionPlan', () => {
  assert.deepEqual(__testables.getStateKeysToDelete('video'), [
    'shotPackages',
    'videoResults',
    'shotQaReport',
    'normalizedShots',
    'audioResults',
    'audioVoiceResolution',
    'audioProjectId',
    'lipsyncResults',
    'lipsyncReport',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
  ]);
});

test('collectFilesToRemove targets shared lipsync clips and final delivery outputs without clearing audio cache', () => {
  const state = {
    normalizedShots: [{ id: 'shot_001' }, { id: 'shot_002' }],
    lipsyncResults: [
      { shotId: 'shot_001', videoPath: 'temp/lipsync/shot_001.mp4' },
      { shotId: 'shot_002', videoPath: null },
    ],
    outputPath: 'output/demo/final-video.mp4',
    deliverySummaryPath: 'output/demo/delivery-summary.md',
  };

  const files = __testables.collectFilesToRemove(
    'lipsync',
    state,
    {
      images: 'temp/job/images',
      audio: 'temp/job/audio',
    },
    './temp'
  );

  assert.equal(files.some((item) => item.endsWith(path.normalize('temp\\lipsync\\shot_001.mp4'))), true);
  assert.equal(files.some((item) => item.endsWith(path.normalize('temp\\lipsync\\shot_002.mp4'))), true);
  assert.equal(files.some((item) => item.endsWith(path.normalize('output\\demo\\final-video.mp4'))), true);
  assert.equal(files.some((item) => item.endsWith(path.normalize('output\\demo\\delivery-summary.md'))), true);
  assert.equal(files.some((item) => item.endsWith(path.normalize('temp\\job\\audio'))), false);
  assert.equal(files.some((item) => item.endsWith(path.normalize('temp\\job\\images'))), false);
});

test('resolveResumeContext locates latest project-mode run job and corresponding state path', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-step-'));

  try {
    const runJobsDir = path.join(
      tempRoot,
      'projects',
      'demo-project',
      'scripts',
      'pilot',
      'episodes',
      'episode-1',
      'run-jobs'
    );
    fs.mkdirSync(runJobsDir, { recursive: true });

    const olderRun = {
      id: 'run_old',
      projectId: 'demo-project',
      scriptId: 'pilot',
      episodeId: 'episode-1',
      jobId: 'job_old',
    };
    const latestRun = {
      id: 'run_latest',
      projectId: 'demo-project',
      scriptId: 'pilot',
      episodeId: 'episode-1',
      jobId: 'job_latest',
    };

    fs.writeFileSync(path.join(runJobsDir, 'run_old.json'), JSON.stringify(olderRun, null, 2));
    fs.writeFileSync(path.join(runJobsDir, 'run_latest.json'), JSON.stringify(latestRun, null, 2));
    const latestFile = path.join(runJobsDir, 'run_latest.json');
    const futureTime = new Date(Date.now() + 1000);
    fs.utimesSync(latestFile, futureTime, futureTime);

    const context = __testables.resolveResumeContext(
      {
        mode: 'project',
        projectId: 'demo-project',
        scriptId: 'pilot',
        episodeId: 'episode-1',
        runId: null,
      },
      tempRoot
    );

    assert.equal(context.jobId, 'job_latest');
    assert.equal(
      context.statePath,
      path.join(tempRoot, 'job_latest', 'state.json')
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resolveResumeContext exposes snapshot path for a historical run artifact when available', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-snapshot-'));

  try {
    const runJobsDir = path.join(
      tempRoot,
      'projects',
      'demo-project',
      'scripts',
      'pilot',
      'episodes',
      'episode-1',
      'run-jobs'
    );
    const artifactRunDir = path.join(
      tempRoot,
      'projects',
      '演示项目__demo-project',
      'scripts',
      '试播集剧本__pilot',
      'episodes',
      '第01集__episode-1',
      'runs',
      '2026-04-04_090244__run_demo'
    );
    fs.mkdirSync(runJobsDir, { recursive: true });
    fs.mkdirSync(artifactRunDir, { recursive: true });

    const snapshotPath = path.join(artifactRunDir, 'state.snapshot.json');
    fs.writeFileSync(snapshotPath, JSON.stringify({ imageResults: [{ shotId: 'shot_001' }] }, null, 2));

    const runJob = {
      id: 'run_demo',
      projectId: 'demo-project',
      scriptId: 'pilot',
      episodeId: 'episode-1',
      jobId: 'job_missing_live_state',
      artifactRunDir,
    };
    fs.writeFileSync(path.join(runJobsDir, 'run_demo.json'), JSON.stringify(runJob, null, 2));

    const context = __testables.resolveResumeContext(
      {
        mode: 'project',
        projectId: 'demo-project',
        scriptId: 'pilot',
        episodeId: 'episode-1',
        runId: 'run_demo',
      },
      tempRoot
    );

    assert.equal(context.snapshotPath, snapshotPath);
    assert.equal(
      context.statePath,
      path.join(tempRoot, 'job_missing_live_state', 'state.json')
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('listProjectChoices, listScriptChoices, and listEpisodeChoices read local project store candidates', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-choices-'));

  try {
    const projectDir = path.join(tempRoot, 'projects', 'demo-project');
    const scriptDir = path.join(projectDir, 'scripts', 'pilot');
    const episodeDir = path.join(scriptDir, 'episodes', 'episode-1');
    fs.mkdirSync(episodeDir, { recursive: true });

    fs.writeFileSync(
      path.join(projectDir, 'project.json'),
      JSON.stringify({ id: 'demo-project', name: '演示项目' }, null, 2)
    );
    fs.writeFileSync(
      path.join(scriptDir, 'script.json'),
      JSON.stringify({ id: 'pilot', title: '试播集剧本' }, null, 2)
    );
    fs.writeFileSync(
      path.join(episodeDir, 'episode.json'),
      JSON.stringify({ id: 'episode-1', title: '第一集', episodeNo: 1 }, null, 2)
    );

    const projects = __testables.listProjectChoices(tempRoot);
    const scripts = __testables.listScriptChoices('demo-project', tempRoot);
    const episodes = __testables.listEpisodeChoices('demo-project', 'pilot', tempRoot);

    assert.equal(projects.length, 1);
    assert.equal(projects[0].id, 'demo-project');
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].id, 'pilot');
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].id, 'episode-1');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('collectMissingPrerequisites warns when requested resume step cannot reuse earlier caches', () => {
  const missing = __testables.collectMissingPrerequisites('lipsync', {
    characterRegistry: [{ name: '沈惊鸿' }],
    imageResults: null,
    normalizedShots: [{ id: 'shot_001' }],
    audioResults: null,
  });

  assert.deepEqual(missing, ['imageResults', 'audioResults']);
});
