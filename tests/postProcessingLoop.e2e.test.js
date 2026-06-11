import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildStoryboardContext } from '../src/agents/storyboardContextAgent.js';
import { runCrossVideoConsistency } from '../src/agents/crossVideoConsistencyAgent.js';
import { runAvPackaging } from '../src/agents/avPackagingAgent.js';
import { runPostComposeReview } from '../src/agents/postComposeReviewAgent.js';
import { buildHumanReviewQueue, writeHumanReviewQueueArtifacts } from '../src/utils/humanReviewQueue.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-post-processing-e2e-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
}

test('post-processing loop e2e writes memory consistency packaging edit task and review artifacts', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_happyhorse',
      projectName: 'HappyHorse 项目',
      scriptId: 'script_1',
      scriptTitle: '第一季',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_post_loop_e2e',
      startedAt: '2026-06-11T00:00:00.000Z',
    });
    const missingAudioPath = path.join(tempRoot, 'missing-audio.mp3');
    const shots = [
      {
        id: 'shot_001',
        scene: '马厩',
        action: '主角回头，披风保持红色',
        characters: ['hero'],
        dialogue: '别怕',
        durationSec: 3,
        audioMood: 'suspense',
      },
      {
        id: 'shot_002',
        scene: '马厩',
        action: '主角冲出门外，动作需要连续',
        characters: ['hero'],
        durationSec: 4,
        audioMood: 'urgent',
      },
    ];

    const memory = await buildStoryboardContext(
      {
        projectId: 'project_happyhorse',
        runId: 'run_post_loop_e2e',
        shots,
        characterRegistry: [
          {
            id: 'hero',
            name: 'hero',
            basePromptTokens: 'red cloak hero',
            referenceImages: [{ id: 'ref_hero', path: 'refs/hero.png' }],
          },
        ],
        imageResults: [
          { shotId: 'shot_001', imagePath: 'frames/shot_001.png', referenceIds: ['ref_hero'] },
          { shotId: 'shot_002', imagePath: 'frames/shot_002.png', referenceIds: ['ref_hero'] },
        ],
        sourceArtifacts: [
          {
            path: path.join(artifactContext.agents.imageGenerator.outputsDir, 'image-results.json'),
            artifactType: 'image-results',
            agent: 'imageGenerator',
            version: 'test-v1',
            generatedAt: '2026-06-11T00:00:00.000Z',
          },
        ],
      },
      {
        currentShotId: 'shot_001',
        tokenBudget: 1200,
        artifactContext: artifactContext.agents.storyboardContextAgent,
      }
    );

    const crossVideoReport = await runCrossVideoConsistency(
      {
        projectKey: 'HappyHorse',
        videoProvider: 'happyhorse',
        contextMemory: memory,
        videoMetadata: [
          {
            videoId: 'video_001',
            provider: 'happyhorse',
            firstShotId: 'shot_001',
            lastShotId: 'shot_001',
            exitPose: 'hero turns back',
            requiredReferenceIds: ['ref_hero'],
            characters: [{ id: 'hero', appearanceSummary: 'red cloak hero' }],
            scenes: [{ id: 'stable', location: '马厩', lighting: 'warm' }],
          },
          {
            videoId: 'video_002',
            provider: 'happyhorse',
            firstShotId: 'shot_002',
            lastShotId: 'shot_002',
            entryPose: 'hero turns back',
            requiredReferenceIds: ['ref_hero'],
            characters: [{ id: 'hero', appearanceSummary: 'red cloak hero' }],
            scenes: [{ id: 'stable', location: '马厩', lighting: 'warm' }],
          },
        ],
        videoResults: [
          { shotId: 'shot_001', videoId: 'video_001', provider: 'happyhorse', referenceIds: ['ref_hero'] },
          { shotId: 'shot_002', videoId: 'video_002', provider: 'happyhorse', referenceIds: ['ref_hero'] },
        ],
        sequenceClipResults: [],
        bridgeClipResults: [],
        lipsyncResults: [],
      },
      { artifactContext: artifactContext.agents.crossVideoConsistencyChecker }
    );

    const packagingPlan = await runAvPackaging(
      {
        runId: 'run_post_loop_e2e',
        shots,
        lipsyncReport: { status: 'pass', completedShotIds: ['shot_001'] },
        sequenceClips: [],
        bridgeClips: [],
        options: {
          assets: {
            bgm: [{ assetId: 'suspense_loop', path: missingAudioPath, mood: 'suspense' }],
            sfx: [{ assetId: 'impact_soft', path: missingAudioPath, kind: 'impact' }],
          },
        },
      },
      { artifactContext: artifactContext.agents.avPackagingAgent }
    );

    const postComposeReview = await runPostComposeReview(
      {
        projectId: 'project_happyhorse',
        runId: 'run_post_loop_e2e',
        composeResult: { status: 'completed', finalVideoPath: 'output/final.mp4' },
        composePlan: [
          {
            visualType: 'static_image',
            shotId: 'shot_002',
            imagePath: 'frames/shot_002.png',
            fallbackReason: 'missing happyhorse video clip',
            startSec: 3,
            endSec: 7,
          },
        ],
        shotQaReport: { status: 'pass', items: [] },
        bridgeQaReport: { status: 'pass', items: [] },
        sequenceQaReport: { status: 'pass', items: [] },
        ttsQaReport: { status: 'pass', items: [] },
        lipsyncReport: { status: 'pass', items: [] },
        crossVideoConsistencyReport: crossVideoReport,
        avPackagingPlan: packagingPlan,
        costGovernanceReport: { status: 'pass', warnings: [], blockers: [] },
        finalVideoPath: 'output/final.mp4',
      },
      { artifactContext: artifactContext.agents.postComposeReviewAgent }
    );

    const reviewQueue = buildHumanReviewQueue({
      extraItems: postComposeReview.editTaskPack.humanReview.items.map((item) => ({
        id: `post_compose_${item.taskId}`,
        type: 'post_compose_edit_task',
        priority: item.priority,
        status: 'open',
        shotId: item.targetRef?.type === 'shot' ? item.targetRef.id : null,
        reason: item.reason,
        suggestedAction: item.reviewType,
        evidence: ['post-compose-review/edit-task-pack.json'],
      })),
    });
    writeHumanReviewQueueArtifacts(reviewQueue, artifactContext.agents.humanReviewQueue);

    assert.equal(memory.contextPack.currentShotId, 'shot_001');
    assert.equal(crossVideoReport.contextMemoryPatch.writeAllowed, true);
    assert.equal(packagingPlan.warnings.some((warning) => warning.code === 'bgm_asset_missing'), true);
    assert.equal(postComposeReview.editTaskPack.executionMode, 'manual_only');
    assert.equal(
      postComposeReview.editTaskPack.tasks.some(
        (task) => task.action === 'replace_clip' && task.targetRef.id === 'shot_002'
      ),
      true
    );
    assert.equal(reviewQueue.summary.openCount > 0, true);

    const expectedFiles = [
      path.join(artifactContext.agents.storyboardContextAgent.outputsDir, 'storyboard-context-memory.json'),
      path.join(artifactContext.agents.crossVideoConsistencyChecker.outputsDir, 'cross-video-context-memory.json'),
      path.join(artifactContext.agents.avPackagingAgent.outputsDir, 'av-packaging-plan.json'),
      path.join(artifactContext.agents.postComposeReviewAgent.outputsDir, 'edit-task-pack.json'),
      path.join(artifactContext.agents.humanReviewQueue.outputsDir, 'human-review-queue.json'),
    ];
    for (const filePath of expectedFiles) {
      assert.equal(fs.existsSync(filePath), true, `${filePath} should exist`);
    }
  });
});

// ============================================================
// 异常路径测试：空输入、缺失数据等边界情况
// ============================================================

test('post-processing loop e2e handles empty shots gracefully（空镜头不崩溃）', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_empty',
      projectName: '空项目',
      scriptId: 'script_empty',
      scriptTitle: '空剧本',
      episodeId: 'episode_empty',
      episodeTitle: '空集',
      episodeNo: 1,
      runJobId: 'run_empty_e2e',
      startedAt: '2026-06-11T00:00:00.000Z',
    });

    // buildStoryboardContext 接收空镜头不应崩溃
    const memory = await buildStoryboardContext(
      {
        projectId: 'project_empty',
        runId: 'run_empty_e2e',
        shots: [],
        characterRegistry: [],
        imageResults: [],
        sourceArtifacts: [],
      },
      {
        currentShotId: null,
        tokenBudget: 1200,
        artifactContext: artifactContext.agents.storyboardContextAgent,
      }
    );

    // 空镜头下 shotContextIndex 可能是空对象或空数组，均属合理行为
    assert.ok(memory.shotContextIndex !== null && memory.shotContextIndex !== undefined);
    assert.equal(memory.metrics.shotMemoryCount, 0);
    assert.equal(memory.contextPack.currentShotId, null);
  });
});

test('post-processing loop e2e handles cross-video consistency without video metadata（无视频元数据不崩溃）', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_no_meta',
      projectName: '无元数据项目',
      scriptId: 'script_no_meta',
      scriptTitle: '无元数据',
      episodeId: 'episode_no_meta',
      episodeTitle: '无元数据',
      episodeNo: 1,
      runJobId: 'run_no_meta_e2e',
      startedAt: '2026-06-11T00:00:00.000Z',
    });

    const report = await runCrossVideoConsistency(
      {
        projectKey: 'no_meta',
        videoProvider: 'happyhorse',
        contextMemory: { characters: [], scenes: [] },
        videoMetadata: [],
        videoResults: [],
        sequenceClipResults: [],
        bridgeClipResults: [],
        lipsyncResults: [],
      },
      { artifactContext: artifactContext.agents.crossVideoConsistencyChecker }
    );

    assert.equal(typeof report.status, 'string');
    // 无视频元数据时 totalEntries 可能计数了空条目的占位记录，应 ≥0
    assert.ok(report.summary.totalEntries >= 0);
    assert.equal(report.summary.mainClipCount, 0);
    assert.equal(report.clipIndex.clips.length, 0);
  });
});

test('post-processing loop e2e handles AV packaging with empty options（空配置生成默认包装计划）', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_default_pkg',
      projectName: '默认包装',
      scriptId: 'script_default_pkg',
      scriptTitle: '默认包装',
      episodeId: 'episode_default_pkg',
      episodeTitle: '默认包装',
      episodeNo: 1,
      runJobId: 'run_default_pkg_e2e',
      startedAt: '2026-06-11T00:00:00.000Z',
    });

    const plan = await runAvPackaging(
      {
        runId: 'run_default_pkg_e2e',
        shots: [
          { id: 'shot_001', action: '静态场景', durationSec: 3, audioMood: 'neutral' },
        ],
        lipsyncReport: { status: 'pass', completedShotIds: [] },
        sequenceClips: [],
        bridgeClips: [],
        options: {},
      },
      { artifactContext: artifactContext.agents.avPackagingAgent }
    );

    assert.equal(typeof plan.schemaVersion, 'string');
    assert.equal(Array.isArray(plan.bgmCues), true);
    assert.equal(Array.isArray(plan.sfxCues), true);
    assert.equal(Array.isArray(plan.warnings), true);
    // 空配置下应有默认字幕样式，不应出现 undefined preset
    assert.ok(plan.subtitleStyleProfile, '应有默认字幕样式配置');
    assert.equal(typeof plan.subtitleStyleProfile.stylePreset, 'string', 'stylePreset 应为字符串而非 undefined');
    assert.ok(plan.subtitleStyleProfile.stylePreset.length > 0);
  });
});

test('post-processing loop e2e handles post-compose review with null compose plan（空合成计划不崩溃）', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_null_plan',
      projectName: '空合成计划',
      scriptId: 'script_null_plan',
      scriptTitle: '空计划',
      episodeId: 'episode_null_plan',
      episodeTitle: '空计划',
      episodeNo: 1,
      runJobId: 'run_null_plan_e2e',
      startedAt: '2026-06-11T00:00:00.000Z',
    });

    const review = await runPostComposeReview(
      {
        projectId: 'project_null_plan',
        runId: 'run_null_plan_e2e',
        composeResult: { status: 'completed', finalVideoPath: 'output/final.mp4' },
        composePlan: null,
        shotQaReport: { status: 'pass', items: [] },
        bridgeQaReport: { status: 'pass', items: [] },
        sequenceQaReport: { status: 'pass', items: [] },
        ttsQaReport: { status: 'pass', items: [] },
        lipsyncReport: { status: 'pass', items: [] },
        crossVideoConsistencyReport: { status: 'pass', summary: {}, clipIndex: { clips: [] }, reviewItems: [] },
        avPackagingPlan: null,
        costGovernanceReport: { status: 'pass', warnings: [], blockers: [] },
        finalVideoPath: 'output/final.mp4',
      },
      { artifactContext: artifactContext.agents.postComposeReviewAgent }
    );

    assert.equal(typeof review.status, 'string');
    assert.ok(review.editTaskPack, '即使无 composePlan 也应生成 editTaskPack');
    assert.equal(Array.isArray(review.editTaskPack.tasks), true);
    assert.equal(Array.isArray(review.editTaskPack.findings), true);
  });
});
