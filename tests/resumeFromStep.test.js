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
  assert.equal(__testables.normalizeStepName('cross-consistency'), 'cross_consistency');
  assert.equal(__testables.normalizeStepName('post-review'), 'post_review');
});

test('parseCliArgs returns null ids when no project flags are provided for interactive selection', () => {
  const parsed = __testables.parseCliArgs(['--step=lipsync']);

  assert.equal(parsed.projectId, null);
  assert.equal(parsed.scriptId, null);
  assert.equal(parsed.episodeId, null);
});

test('parseCliArgs rejects positional script file arguments (D1 removed legacy mode)', () => {
  assert.throws(
    () => __testables.parseCliArgs(['--step=lipsync', 'samples/寒烬宫变-pro.txt']),
    /位置参数剧本文件（samples\/寒烬宫变-pro\.txt）已不再支持/
  );
});

test('parseCliArgs rejects legacy --script-file and --project-id flags (D1 removed legacy mode)', () => {
  assert.throws(
    () => __testables.parseCliArgs(['--step=lipsync', '--script-file=samples/x.txt']),
    /--script-file \/ --project-id 已随兼容单文件模式整体移除/
  );
  assert.throws(
    () => __testables.parseCliArgs(['--step=lipsync', '--project-id=demo']),
    /--script-file \/ --project-id 已随兼容单文件模式整体移除/
  );
});

test('parseCliArgs records explicit paid video confirmation', () => {
  const parsed = __testables.parseCliArgs(['--step=video', '--confirm-paid-video']);

  assert.equal(parsed.step, 'video');
  assert.equal(parsed.confirmPaidVideo, true);
  assert.equal(__testables.blocksPaidVideoExecution(parsed), false);
});

test('blocksPaidVideoExecution also blocks video prepare-only unless confirmed', () => {
  const parsed = __testables.parseCliArgs(['--step=video', '--prepare-only']);

  assert.equal(parsed.prepareOnly, true);
  assert.equal(__testables.blocksPaidVideoExecution(parsed), true);
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
    'preflightShotPackages',
    'preflightQaReport',
    'upstreamFailureInsights',
    'pipelineSummary',
    'stoppedBeforeVideoAt',
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

test('getStateKeysToDelete for cross-consistency clears post-processing and delivery state only', () => {
  assert.deepEqual(__testables.getStateKeysToDelete('cross_consistency'), [
    'crossVideoConsistencyReport',
    'avPackagingPlan',
    'postComposeReview',
    'humanReviewQueue',
    'pipelineSummary',
    'previewOutputPath',
    'composeResult',
    'outputPath',
    'deliverySummaryPath',
    'completedAt',
    'lastError',
    'failedAt',
  ]);
});

test('getStateKeysToDelete for post-review preserves compose output but clears review state', () => {
  assert.deepEqual(__testables.getStateKeysToDelete('post_review'), [
    'postComposeReview',
    'humanReviewQueue',
    'pipelineSummary',
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

test('collectMissingPrerequisites for post-review warns when post-processing inputs are missing', () => {
  const missing = __testables.collectMissingPrerequisites('post_review', {
    characterRegistry: [{ name: '沈惊鸿' }],
    imageResults: [{ shotId: 'shot_001', imagePath: 'frames/shot_001.png' }],
    normalizedShots: [{ id: 'shot_001' }],
    audioResults: [{ shotId: 'shot_001', audioPath: 'audio/shot_001.mp3' }],
    crossVideoConsistencyReport: null,
    avPackagingPlan: null,
  });

  assert.deepEqual(missing, ['crossVideoConsistencyReport', 'avPackagingPlan']);
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
      [
        '--step=video',
        '--project=demo-project',
        '--script-id=pilot',
        '--episode=episode-1',
        '--run-id=run_demo',
        '--prepare-only',
        '--confirm-paid-video',
      ],
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

test('resumeFromStep blocks paid video execution by default without mutating state or files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-paid-guard-'));

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
    const liveStateDir = path.join(tempRoot, 'job_demo');
    const imageDir = path.join(liveStateDir, 'images');
    const videoDir = path.join(liveStateDir, 'video');
    fs.mkdirSync(runJobsDir, { recursive: true });
    fs.mkdirSync(imageDir, { recursive: true });
    fs.mkdirSync(videoDir, { recursive: true });

    const imagePath = path.join(imageDir, 'shot_001.png');
    const videoPath = path.join(videoDir, 'shot_001.mp4');
    const statePath = path.join(liveStateDir, 'state.json');
    fs.writeFileSync(imagePath, 'image');
    fs.writeFileSync(videoPath, 'video');
    fs.writeFileSync(
      path.join(runJobsDir, 'run_demo.json'),
      JSON.stringify(
        {
          id: 'run_demo',
          projectId: 'demo-project',
          scriptId: 'pilot',
          episodeId: 'episode-1',
          jobId: 'job_demo',
        },
        null,
        2
      )
    );

    const originalState = {
      characterRegistry: [{ name: '阿坤' }],
      imageResults: [{ shotId: 'shot_001', imagePath, success: true }],
      motionPlan: [{ shotId: 'shot_001' }],
      videoResults: [{ shotId: 'shot_001', videoPath }],
    };
    fs.writeFileSync(statePath, JSON.stringify(originalState, null, 2));

    const result = await __testables.resumeFromStep(
      ['--step=video', '--project=demo-project', '--script-id=pilot', '--episode=episode-1'],
      { baseTempDir: tempRoot }
    );

    const writtenState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(result.blockedByPaidVideoGuard, true);
    assert.equal(result.executed, false);
    assert.deepEqual(writtenState, originalState);
    assert.equal(fs.existsSync(videoPath), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resumeFromStep blocks video prepare-only without confirmation so cached clips are preserved', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-prepare-guard-'));

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
    const liveStateDir = path.join(tempRoot, 'job_demo');
    const imageDir = path.join(liveStateDir, 'images');
    const videoDir = path.join(liveStateDir, 'video');
    fs.mkdirSync(runJobsDir, { recursive: true });
    fs.mkdirSync(imageDir, { recursive: true });
    fs.mkdirSync(videoDir, { recursive: true });

    const imagePath = path.join(imageDir, 'shot_001.png');
    const videoPath = path.join(videoDir, 'shot_001.mp4');
    const statePath = path.join(liveStateDir, 'state.json');
    fs.writeFileSync(imagePath, 'image');
    fs.writeFileSync(videoPath, 'video');
    fs.writeFileSync(
      path.join(runJobsDir, 'run_demo.json'),
      JSON.stringify(
        {
          id: 'run_demo',
          projectId: 'demo-project',
          scriptId: 'pilot',
          episodeId: 'episode-1',
          jobId: 'job_demo',
        },
        null,
        2
      )
    );

    const originalState = {
      characterRegistry: [{ name: '阿坤' }],
      imageResults: [{ shotId: 'shot_001', imagePath, success: true }],
      motionPlan: [{ shotId: 'shot_001' }],
      videoResults: [{ shotId: 'shot_001', videoPath }],
    };
    fs.writeFileSync(statePath, JSON.stringify(originalState, null, 2));

    const result = await __testables.resumeFromStep(
      ['--step=video', '--project=demo-project', '--script-id=pilot', '--episode=episode-1', '--prepare-only'],
      { baseTempDir: tempRoot }
    );

    const writtenState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(result.blockedByPaidVideoGuard, true);
    assert.equal(result.executed, false);
    assert.deepEqual(writtenState, originalState);
    assert.equal(fs.existsSync(videoPath), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resumeFromStep prepare-only from cross-consistency clears downstream delivery state and output files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-cross-consistency-'));
  const previousOutputDir = process.env.OUTPUT_DIR;

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
    const liveStateDir = path.join(tempRoot, 'job_demo');
    const outputDir = path.join(tempRoot, 'output', 'demo');
    fs.mkdirSync(runJobsDir, { recursive: true });
    fs.mkdirSync(liveStateDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const statePath = path.join(liveStateDir, 'state.json');
    const outputPath = path.join(outputDir, 'final-video.mp4');
    const deliverySummaryPath = path.join(outputDir, 'delivery-summary.md');
    process.env.OUTPUT_DIR = path.join(tempRoot, 'output');
    fs.writeFileSync(outputPath, 'video');
    fs.writeFileSync(deliverySummaryPath, 'summary');
    fs.writeFileSync(
      path.join(runJobsDir, 'run_demo.json'),
      JSON.stringify(
        {
          id: 'run_demo',
          projectId: 'demo-project',
          scriptId: 'pilot',
          episodeId: 'episode-1',
          jobId: 'job_demo',
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          characterRegistry: [{ name: '阿坤' }],
          imageResults: [{ shotId: 'shot_001', imagePath: path.join(liveStateDir, 'images', 'shot_001.png'), success: true }],
          normalizedShots: [{ id: 'shot_001' }],
          audioResults: [{ shotId: 'shot_001', audioPath: path.join(liveStateDir, 'audio', 'shot_001.mp3') }],
          storyboardContextMemory: { contextPack: { currentShotId: 'shot_001' } },
          crossVideoConsistencyReport: { status: 'pass' },
          avPackagingPlan: { schemaVersion: 'av-packaging-plan.v1' },
          postComposeReview: { status: 'needs_review' },
          humanReviewQueue: { status: 'warn' },
          composeResult: { status: 'completed' },
          pipelineSummary: { status: 'pass' },
          outputPath,
          deliverySummaryPath,
        },
        null,
        2
      )
    );

    const result = await __testables.resumeFromStep(
      ['--step=cross-consistency', '--project=demo-project', '--script-id=pilot', '--episode=episode-1', '--prepare-only'],
      { baseTempDir: tempRoot }
    );

    const writtenState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(result.executed, false);
    assert.equal(result.parsed.step, 'cross_consistency');
    assert.equal('crossVideoConsistencyReport' in writtenState, false);
    assert.equal('avPackagingPlan' in writtenState, false);
    assert.equal('postComposeReview' in writtenState, false);
    assert.equal('humanReviewQueue' in writtenState, false);
    assert.equal('composeResult' in writtenState, false);
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(fs.existsSync(deliverySummaryPath), false);
  } finally {
    if (previousOutputDir === undefined) {
      delete process.env.OUTPUT_DIR;
    } else {
      process.env.OUTPUT_DIR = previousOutputDir;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('resumeFromStep prepare-only from post-review preserves final video while clearing review state', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-resume-post-review-'));

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
    const liveStateDir = path.join(tempRoot, 'job_demo');
    const outputDir = path.join(tempRoot, 'output', 'demo');
    fs.mkdirSync(runJobsDir, { recursive: true });
    fs.mkdirSync(liveStateDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const statePath = path.join(liveStateDir, 'state.json');
    const outputPath = path.join(outputDir, 'final-video.mp4');
    const deliverySummaryPath = path.join(outputDir, 'delivery-summary.md');
    fs.writeFileSync(outputPath, 'video');
    fs.writeFileSync(deliverySummaryPath, 'summary');
    fs.writeFileSync(
      path.join(runJobsDir, 'run_demo.json'),
      JSON.stringify(
        {
          id: 'run_demo',
          projectId: 'demo-project',
          scriptId: 'pilot',
          episodeId: 'episode-1',
          jobId: 'job_demo',
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          characterRegistry: [{ name: '阿坤' }],
          imageResults: [{ shotId: 'shot_001', imagePath: path.join(liveStateDir, 'images', 'shot_001.png'), success: true }],
          normalizedShots: [{ id: 'shot_001' }],
          audioResults: [{ shotId: 'shot_001', audioPath: path.join(liveStateDir, 'audio', 'shot_001.mp3') }],
          crossVideoConsistencyReport: { status: 'pass' },
          avPackagingPlan: { schemaVersion: 'av-packaging-plan.v1' },
          postComposeReview: { status: 'needs_review' },
          humanReviewQueue: { status: 'warn' },
          composeResult: { status: 'completed' },
          pipelineSummary: { status: 'pass' },
          outputPath,
          deliverySummaryPath,
        },
        null,
        2
      )
    );

    const result = await __testables.resumeFromStep(
      ['--step=post-review', '--project=demo-project', '--script-id=pilot', '--episode=episode-1', '--prepare-only'],
      { baseTempDir: tempRoot }
    );

    const writtenState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.equal(result.executed, false);
    assert.equal(result.parsed.step, 'post_review');
    assert.equal('postComposeReview' in writtenState, false);
    assert.equal('humanReviewQueue' in writtenState, false);
    assert.equal('composeResult' in writtenState, true);
    assert.equal(fs.existsSync(outputPath), true);
    assert.equal(fs.existsSync(deliverySummaryPath), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
