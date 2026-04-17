import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEpisodeDirName, buildProjectDirName } from '../src/utils/naming.js';
import {
  createRunArtifactContext,
  normalizeHarnessAgentSummary,
  normalizeHarnessRunOverview,
} from '../src/utils/runArtifacts.js';
import { writeAgentQaSummary, writeRunQaOverview } from '../src/utils/qaSummary.js';
import { __testables as directorTestables } from '../src/agents/director.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-run-artifacts-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('buildProjectDirName combines readable title with stable id', () => {
  assert.equal(buildProjectDirName('咖啡馆相遇', 'project_123'), '咖啡馆相遇__project_123');
});

test('buildEpisodeDirName normalizes episode numbers into 第01集 format', () => {
  assert.equal(buildEpisodeDirName({ episodeNo: 1, id: 'episode_001' }), '第01集__episode_001');
});

test('createRunArtifactContext creates root manifest-friendly folder structure', async () => {
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
      runJobId: 'run_abc',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    assert.equal(fs.existsSync(path.join(ctx.runDir, 'manifest.json')), false);
    assert.equal(
      ctx.agents.scriptParser.dir.endsWith(path.join('01-script-parser')),
      true
    );
    assert.equal(fs.existsSync(ctx.runDir), true);
    assert.equal(fs.existsSync(ctx.agents.scriptParser.dir), true);
    assert.deepEqual(Object.keys(ctx.agents), [
      'scriptParser',
      'characterRegistry',
      'promptEngineer',
      'imageGenerator',
      'consistencyChecker',
      'continuityChecker',
      'ttsAgent',
      'ttsQaAgent',
      'lipsyncAgent',
      'motionPlanner',
      'performancePlanner',
      'seedancePromptAgent',
      'preflightQaAgent',
      'videoRouter',
      'runwayVideoAgent',
      'sora2VideoAgent',
      'fallbackVideoAgent',
      'seedanceVideoAgent',
      'motionEnhancer',
      'shotQaAgent',
      'bridgeShotPlanner',
      'bridgeShotRouter',
      'bridgeClipGenerator',
      'bridgeQaAgent',
      'actionSequencePlanner',
      'actionSequenceRouter',
      'sequenceClipGenerator',
      'sequenceQaAgent',
      'videoComposer',
    ]);

    const expectedBridgeDirs = {
      seedancePromptAgent: '09bb-seedance-prompt-agent',
      preflightQaAgent: '09bc-preflight-qa-agent',
      bridgeShotPlanner: '09g-bridge-shot-planner',
      bridgeShotRouter: '09h-bridge-shot-router',
      bridgeClipGenerator: '09i-bridge-clip-generator',
      bridgeQaAgent: '09j-bridge-qa',
      actionSequencePlanner: '09k-action-sequence-planner',
      actionSequenceRouter: '09l-action-sequence-router',
      sequenceClipGenerator: '09m-sequence-clip-generator',
      sequenceQaAgent: '09n-sequence-qa',
    };
    for (const [agentKey, dirName] of Object.entries(expectedBridgeDirs)) {
      const agentContext = ctx.agents[agentKey];
      assert.ok(agentContext, `${agentKey} context missing`);
      assert.equal(agentContext.dir.endsWith(path.join(dirName)), true);
    }
    assert.equal(
      ctx.qaOverviewJsonPath,
      path.join(ctx.runDir, 'qa-overview.json')
    );
    assert.equal(
      ctx.qaOverviewMarkdownPath,
      path.join(ctx.runDir, 'qa-overview.md')
    );
    assert.equal(
      ctx.projectDir,
      path.join(tempRoot, 'projects', '咖啡馆相遇__project_123')
    );
    assert.equal(
      ctx.episodeDir,
      path.join(
        tempRoot,
        'projects',
        '咖啡馆相遇__project_123',
        'scripts',
        '第一卷__script_001',
        'episodes',
        '第01集__episode_001'
      )
    );
    assert.equal(
      ctx.runDir,
      path.join(
        tempRoot,
        'projects',
        '咖啡馆相遇__project_123',
        'scripts',
        '第一卷__script_001',
        'episodes',
        '第01集__episode_001',
        'runs',
        '2026-04-01_090000__run_abc'
      )
    );
    assert.deepEqual(ctx.agents.scriptParser, {
      dir: path.join(ctx.runDir, '01-script-parser'),
      manifestPath: path.join(ctx.runDir, '01-script-parser', 'manifest.json'),
      inputsDir: path.join(ctx.runDir, '01-script-parser', '0-inputs'),
      outputsDir: path.join(ctx.runDir, '01-script-parser', '1-outputs'),
      metricsDir: path.join(ctx.runDir, '01-script-parser', '2-metrics'),
      errorsDir: path.join(ctx.runDir, '01-script-parser', '3-errors'),
    });
    assert.equal(ctx.agents.fallbackVideoAgent, ctx.agents.sora2VideoAgent);
  });
});

test('collectRunQaOverview includes bridge and sequence agents in qa counts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-qa-overview-'));

  try {
    const agentNames = [
      'scriptParser',
      'bridgeShotPlanner',
      'bridgeShotRouter',
      'bridgeClipGenerator',
      'bridgeQaAgent',
      'actionSequencePlanner',
      'actionSequenceRouter',
      'sequenceClipGenerator',
      'sequenceQaAgent',
    ];
    const agents = Object.fromEntries(
      agentNames.map((agentKey) => {
        const dir = path.join(tempRoot, agentKey);
        return [
          agentKey,
          {
            dir,
            manifestPath: path.join(dir, 'manifest.json'),
            metricsDir: path.join(dir, '2-metrics'),
          },
        ];
      })
    );
    const manifestByPath = Object.fromEntries(
      Object.values(agents).map((ctx, index) => [
        ctx.manifestPath,
        {
          agentKey: agentNames[index],
          status: 'completed',
        },
      ])
    );

    const overview = directorTestables.collectRunQaOverview(
      (filePath) => manifestByPath[filePath] || null,
      { agents },
      { releasable: true }
    );

    assert.equal(overview.status, 'pass');
    assert.equal(overview.passCount, agentNames.length);
    assert.equal(
      overview.agentSummaries.some((entry) => entry.agentKey === 'bridgeShotPlanner'),
      true
    );
    assert.equal(
      overview.agentSummaries.some((entry) => entry.agentKey === 'sequenceQaAgent'),
      true
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('normalizeHarnessAgentSummary and normalizeHarnessRunOverview expose harness-friendly fields', () => {
  const agentSummary = normalizeHarnessAgentSummary({
    agentKey: 'ttsAgent',
    agentName: 'TTS Agent',
    status: 'warn',
    headline: '有 1 个对白失败',
    summary: '需要复查',
    nextAction: '查看错误文件',
    evidenceFiles: ['0-inputs/voice-resolution.json'],
    artifacts: [
      { path: '0-inputs/voice-resolution.json', label: 'voice-resolution.json' },
    ],
    metrics: { failureCount: 1 },
  });

  assert.deepEqual(agentSummary.nextActions, ['查看错误文件']);
  assert.equal(agentSummary.nextAction, '查看错误文件');
  assert.equal(agentSummary.artifacts[0].label, 'voice-resolution.json');
  assert.equal(agentSummary.artifacts[0].path, '0-inputs/voice-resolution.json');

  const runOverview = normalizeHarnessRunOverview({
    status: 'warn',
    releasable: true,
    headline: '有风险但可继续',
    summary: '需要留意',
    agentSummaries: [agentSummary],
    topIssues: ['TTS Agent: 有 1 个对白失败'],
  });

  assert.equal(runOverview.agentSummaries[0].nextActions[0], '查看错误文件');
  assert.equal(runOverview.agentSummaries[0].artifacts[0].label, 'voice-resolution.json');
  assert.equal(runOverview.topIssues[0], 'TTS Agent: 有 1 个对白失败');
});

test('writeAgentQaSummary and writeRunQaOverview persist normalized observation contracts', async () => {
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
      runJobId: 'run_abc',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    const agentPayload = writeAgentQaSummary(
      {
        agentKey: 'ttsAgent',
        agentName: 'TTS Agent',
        status: 'warn',
        headline: '有 1 个对白失败',
        summary: '需要复查',
        nextAction: '查看错误文件',
        evidenceFiles: ['0-inputs/voice-resolution.json'],
        artifacts: [{ path: '0-inputs/voice-resolution.json', label: 'voice-resolution.json' }],
        metrics: { failureCount: 1 },
      },
      ctx.agents.ttsAgent
    );

    assert.deepEqual(agentPayload.nextActions, ['查看错误文件']);
    assert.equal(agentPayload.artifacts[0].label, 'voice-resolution.json');
    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.outputsDir, 'qa-summary.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.metricsDir, 'qa-summary.json')),
      true
    );

    const overviewPayload = writeRunQaOverview(
      {
        status: 'warn',
        releasable: true,
        headline: '有风险但可继续',
        summary: '需要留意',
        agentSummaries: [agentPayload],
        topIssues: ['TTS Agent: 有 1 个对白失败'],
      },
      ctx
    );

    assert.equal(overviewPayload.agentSummaries[0].nextActions[0], '查看错误文件');
    assert.equal(overviewPayload.agentSummaries[0].artifacts[0].label, 'voice-resolution.json');
    assert.equal(fs.existsSync(path.join(ctx.runDir, 'qa-overview.json')), true);
    assert.equal(fs.existsSync(path.join(ctx.runDir, 'qa-overview.md')), true);
  });
});

test('collectRunQaOverview surfaces run debug signals from state snapshot and run job history', async () => {
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
      runJobId: 'run_abc',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    const runManifest = {
      runJobId: 'run_abc',
    };
    fs.writeFileSync(path.join(ctx.runDir, 'manifest.json'), JSON.stringify(runManifest, null, 2));
    fs.mkdirSync(path.join(ctx.episodeDir, 'run-jobs'), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.episodeDir, 'run-jobs', 'run_abc.json'),
      JSON.stringify(
        {
          id: 'run_abc',
          projectId: 'project_123',
          scriptId: 'script_001',
          episodeId: 'episode_001',
          jobId: 'job_abc',
          status: 'failed',
          agentTaskRuns: [
            { id: 'run_abc_generate_character_ref_sheets', step: 'generate_character_ref_sheets', agent: 'director', status: 'failed', detail: '生成角色三视图参考纸', error: '角色三视图生成失败' },
            { id: 'run_abc_route_video_shots', step: 'route_video_shots', agent: 'director', status: 'cached', detail: '使用缓存的视频路由结果', error: null },
            { id: 'run_abc_preflight_qa', step: 'preflight_qa', agent: 'director', status: 'skipped', detail: '已停止在视频生成前', error: null },
            { id: 'run_abc_sequence_qa', step: 'sequence_qa', agent: 'director', status: 'manual_review', detail: 'sequence 需要人工复核', error: null },
          ],
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(ctx.runDir, 'state.snapshot.json'),
      JSON.stringify(
        {
          lastError: '角色三视图生成失败',
          failedAt: '2026-04-01T09:20:00.000Z',
          stoppedBeforeVideoAt: '2026-04-01T09:10:00.000Z',
          previewOutputPath: '/tmp/preview/final-video.mp4',
          completedAt: '',
          pipelineSummary: {
            seedance_inference_delivery_gate: 'block_formal_delivery',
          },
        },
        null,
        2
      )
    );

    const overview = directorTestables.collectRunQaOverview(
      () => null,
      ctx,
      { releasable: false }
    );

    assert.equal(overview.status, 'block');
    assert.deepEqual(overview.runDebug.cachedSteps, ['route_video_shots']);
    assert.deepEqual(overview.runDebug.skippedSteps, ['preflight_qa']);
    assert.deepEqual(overview.runDebug.failedSteps, ['generate_character_ref_sheets']);
    assert.deepEqual(overview.runDebug.manualReviewSteps, ['sequence_qa']);
    assert.equal(overview.runDebug.whereFailed, 'generate_character_ref_sheets');
    assert.equal(overview.runDebug.stopReason, '角色三视图生成失败');
    assert.equal(overview.runDebug.previewOutputPath, '/tmp/preview/final-video.mp4');

    const written = writeRunQaOverview(overview, ctx);
    assert.deepEqual(written.runDebug.cachedSteps, ['route_video_shots']);
    const markdown = fs.readFileSync(path.join(ctx.runDir, 'qa-overview.md'), 'utf-8');
    assert.match(markdown, /Run Debug Signals/);
    assert.match(markdown, /卡点步骤: generate_character_ref_sheets/);
    assert.match(markdown, /缓存步骤: route_video_shots/);
  });
});

test('buildShotQaInputs bridges enhanced video outputs into shot QA consumable fields', () => {
  const inputs = directorTestables.buildShotQaInputs(
    [
      {
        shotId: 'shot_001',
        status: 'completed',
        enhancedVideoPath: '/tmp/shot_001_enhanced.mp4',
        sourceVideoPath: '/tmp/shot_001_raw.mp4',
      },
      {
        shotId: 'shot_002',
        status: 'skipped',
        enhancedVideoPath: null,
        sourceVideoPath: null,
      },
    ],
    [
      {
        shotId: 'shot_001',
        provider: 'sora2',
        preferredProvider: 'sora2',
        targetDurationSec: 4,
        actualDurationSec: 10,
      },
      {
        shotId: 'shot_002',
        provider: 'sora2',
        preferredProvider: 'sora2',
        targetDurationSec: 6,
        failureCategory: 'provider_generation_failed',
      },
    ]
  );

  assert.deepEqual(inputs[0], {
    shotId: 'shot_001',
    status: 'completed',
    enhancedVideoPath: '/tmp/shot_001_enhanced.mp4',
    sourceVideoPath: '/tmp/shot_001_raw.mp4',
    videoPath: '/tmp/shot_001_enhanced.mp4',
    targetDurationSec: 4,
    actualDurationSec: 10,
    performanceTemplate: null,
    preferredProvider: 'sora2',
    provider: 'sora2',
    failureCategory: null,
    reason: null,
  });
  assert.equal(inputs[1].videoPath, null);
  assert.equal(inputs[1].targetDurationSec, 6);
  assert.equal(inputs[1].failureCategory, 'provider_generation_failed');
});
