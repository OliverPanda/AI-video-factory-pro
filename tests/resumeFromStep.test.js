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

const BRIDGE_STATE_FIELDS = [
  'bridgeShotPlan',
  'bridgeShotPackages',
  'bridgeClipResults',
  'bridgeQaReport',
];

test('getStateKeysToDelete for video step clears video generation caches but preserves motionPlan', () => {
  assert.deepEqual(__testables.getStateKeysToDelete('video'), [
    'performancePlan',
    'shotPackages',
    'rawVideoResults',
    'enhancedVideoResults',
    'videoResults',
    'shotQaReport',
    'shotQaReportV2',
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
    ...BRIDGE_STATE_FIELDS,
    'actionSequencePlan',
    'actionSequencePackages',
    'sequenceClipResults',
    'sequenceQaReport',
  ]);
});

test('getStateKeysToDelete for compose step preserves Phase 2 planning and video caches', () => {
  assert.deepEqual(__testables.getStateKeysToDelete('compose'), [
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
  ]);
  const composeKeys = __testables.getStateKeysToDelete('compose');
  for (const bridgeKey of BRIDGE_STATE_FIELDS) {
    assert.equal(composeKeys.includes(bridgeKey), false, `compose step should preserve ${bridgeKey}`);
  }
  for (const sequenceKey of [
    'actionSequencePlan',
    'actionSequencePackages',
    'sequenceClipResults',
    'sequenceQaReport',
  ]) {
    assert.equal(composeKeys.includes(sequenceKey), false, `compose step should preserve ${sequenceKey}`);
  }
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

test('collectFilesToRemove skips paths outside allowed deletion roots', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-delete-'));

  try {
    const safeVideoDir = path.join(tempRoot, 'job-safe', 'video');
    const unsafeVideoPath = path.resolve(tempRoot, '..', 'escape-zone', 'video.mp4');
    const unsafeOutputPath = path.resolve(tempRoot, '..', 'escape-zone', 'final-video.mp4');
    const safeOutputDir = path.join(tempRoot, 'output-safe');
    const files = __testables.collectFilesToRemove(
      'video',
      {
        videoResults: [{ shotId: 'shot_001', videoPath: unsafeVideoPath }],
        rawVideoResults: [],
        enhancedVideoResults: [],
        lipsyncResults: [],
        outputPath: unsafeOutputPath,
        deliverySummaryPath: path.join(tempRoot, '..', 'escape-zone', 'delivery-summary.md'),
      },
      {
        images: path.join(tempRoot, 'job-safe', 'images'),
        video: safeVideoDir,
        audio: path.join(tempRoot, 'job-safe', 'audio'),
      },
      tempRoot
    );

    assert.equal(files.includes(path.resolve(safeVideoDir)), true);
    assert.equal(files.some((item) => item === unsafeVideoPath), false);
    assert.equal(files.some((item) => item === unsafeOutputPath), false);
    assert.equal(files.some((item) => item.endsWith(path.normalize('escape-zone\\delivery-summary.md'))), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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

test('getResumeMode requires snapshot when run-id is explicitly bound', () => {
  assert.equal(
    __testables.getResumeMode(
      { runId: 'run_demo' },
      { snapshotPath: 'D:\\temp\\state.snapshot.json' }
    ),
    'strict_run_binding'
  );

  assert.throws(
    () => __testables.getResumeMode({ runId: 'run_demo' }, { snapshotPath: null }),
    /state\.snapshot\.json/
  );
});

test('validateStrictBindingPrerequisites rejects image paths outside the bound run roots', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-binding-'));

  try {
    const jobImagesDir = path.join(tempRoot, 'job_demo', 'images');
    const artifactRunDir = path.join(tempRoot, 'projects', 'demo', 'runs', 'run_demo');
    const safeImagePath = path.join(jobImagesDir, 'shot_001.png');
    const unsafeDir = path.join(tempRoot, 'another-run', 'images');
    const unsafeImagePath = path.join(unsafeDir, 'shot_002.png');

    fs.mkdirSync(jobImagesDir, { recursive: true });
    fs.mkdirSync(artifactRunDir, { recursive: true });
    fs.mkdirSync(unsafeDir, { recursive: true });
    fs.writeFileSync(safeImagePath, 'safe');
    fs.writeFileSync(unsafeImagePath, 'unsafe');

    assert.throws(
      () =>
        __testables.validateStrictBindingPrerequisites(
          'video',
          {
            characterRegistry: [{ name: '阿坤' }],
            imageResults: [
              { shotId: 'shot_001', imagePath: safeImagePath, success: true },
              { shotId: 'shot_002', imagePath: unsafeImagePath, success: true },
            ],
            motionPlan: [{ shotId: 'shot_001' }],
          },
          {
            jobId: 'job_demo',
            runJob: { id: 'run_demo', artifactRunDir },
          },
          tempRoot
        ),
      /参考图来源越界/
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resumeFromStep uses bound run snapshot as source of truth and writes resumeContext', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-strict-'));

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
      '2026-04-09_111000__run_demo'
    );
    const liveStateDir = path.join(tempRoot, 'job_demo');
    const imageDir = path.join(liveStateDir, 'images');
    fs.mkdirSync(runJobsDir, { recursive: true });
    fs.mkdirSync(artifactRunDir, { recursive: true });
    fs.mkdirSync(imageDir, { recursive: true });

    const imagePath = path.join(imageDir, 'shot_001.png');
    fs.writeFileSync(imagePath, 'image');

    fs.writeFileSync(
      path.join(runJobsDir, 'run_demo.json'),
      JSON.stringify(
        {
          id: 'run_demo',
          projectId: 'demo-project',
          scriptId: 'pilot',
          episodeId: 'episode-1',
          jobId: 'job_demo',
          artifactRunDir,
        },
        null,
        2
      )
    );

    fs.writeFileSync(
      path.join(artifactRunDir, 'state.snapshot.json'),
      JSON.stringify(
        {
          characterRegistry: [{ name: '阿坤' }],
          imageResults: [{ shotId: 'shot_001', imagePath, success: true }],
          motionPlan: [{ shotId: 'shot_001' }],
          videoResults: [{ shotId: 'shot_001', videoPath: path.join(liveStateDir, 'video', 'old.mp4') }],
        },
        null,
        2
      )
    );

    fs.writeFileSync(
      path.join(liveStateDir, 'state.json'),
      JSON.stringify(
        {
          characterRegistry: [{ name: '错误来源' }],
          imageResults: [{ shotId: 'shot_001', imagePath: path.join(tempRoot, 'wrong', 'shot_001.png'), success: true }],
          motionPlan: [{ shotId: 'wrong_shot' }],
        },
        null,
        2
      )
    );

    const result = await __testables.resumeFromStep(
      ['--step=video', '--project=demo-project', '--script-id=pilot', '--episode=episode-1', '--run-id=run_demo', '--prepare-only'],
      { baseTempDir: tempRoot }
    );

    const writtenState = JSON.parse(fs.readFileSync(path.join(liveStateDir, 'state.json'), 'utf8'));
    assert.equal(result.resumeMode, 'strict_run_binding');
    assert.equal(result.stateSource, 'run-snapshot');
    assert.equal(result.imageReuseCount, 1);
    assert.equal(writtenState.characterRegistry[0].name, '阿坤');
    assert.equal(writtenState.imageResults[0].imagePath, imagePath);
    assert.equal(writtenState.resumeContext.sourceRunId, 'run_demo');
    assert.equal(writtenState.resumeContext.strictRunBinding, true);
    assert.equal('videoResults' in writtenState, false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resumeFromStep dry-run reports strict binding source information', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-dry-'));

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
    const artifactRunDir = path.join(tempRoot, 'projects', 'demo', 'runs', 'run_demo');
    const liveStateDir = path.join(tempRoot, 'job_demo');
    const imageDir = path.join(liveStateDir, 'images');
    fs.mkdirSync(runJobsDir, { recursive: true });
    fs.mkdirSync(artifactRunDir, { recursive: true });
    fs.mkdirSync(imageDir, { recursive: true });

    const imagePath = path.join(imageDir, 'shot_001.png');
    fs.writeFileSync(imagePath, 'image');
    fs.writeFileSync(
      path.join(runJobsDir, 'run_demo.json'),
      JSON.stringify(
        {
          id: 'run_demo',
          projectId: 'demo-project',
          scriptId: 'pilot',
          episodeId: 'episode-1',
          jobId: 'job_demo',
          artifactRunDir,
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(artifactRunDir, 'state.snapshot.json'),
      JSON.stringify(
        {
          characterRegistry: [{ name: '阿坤' }],
          imageResults: [{ shotId: 'shot_001', imagePath, success: true }],
          motionPlan: [{ shotId: 'shot_001' }],
        },
        null,
        2
      )
    );

    const result = await __testables.resumeFromStep(
      ['--step=video', '--project=demo-project', '--script-id=pilot', '--episode=episode-1', '--run-id=run_demo', '--dry-run'],
      { baseTempDir: tempRoot }
    );

    assert.equal(result.resumeMode, 'strict_run_binding');
    assert.match(result.planSummary, /恢复模式：strict_run_binding/);
    assert.match(result.planSummary, /绑定 run-id：run_demo/);
    assert.match(result.planSummary, /复用参考图数：1/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
