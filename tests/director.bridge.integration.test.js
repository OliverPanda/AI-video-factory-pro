import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-director-bridge-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

function createDirs(root) {
  const dirs = {
    root,
    images: path.join(root, 'images'),
    audio: path.join(root, 'audio'),
    output: path.join(root, 'output'),
    video: path.join(root, 'video'),
  };
  Object.values(dirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  return dirs;
}

test('runEpisodePipeline integrates the bridge subchain in order and persists bridge state caches', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const stateByFile = new Map();
    const bridgeCallOrder = [];
    const composeCalls = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_bridge_integration',
      loadJSON: (filePath) => stateByFile.get(filePath) ?? null,
      saveJSON: (filePath, data) => stateByFile.set(filePath, structuredClone(data)),
      loadProject: () => ({ id: 'project_1', name: '寒烬宫变' }),
      loadScript: () => ({
        id: 'script_1',
        title: '寒烬宫变',
        characters: [{ name: '宁王' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [
          { id: 'shot_001', scene: '回廊', action: '宁王转身冲刺', characters: ['宁王'] },
          { id: 'shot_002', scene: '回廊', action: '刀锋顺势落下', characters: ['宁王'] },
        ],
      }),
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      buildCharacterRegistry: async () => [{ name: '宁王', basePromptTokens: 'ning wang' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_001', image_prompt: '回廊起势', negative_prompt: '' },
        { shotId: 'shot_002', image_prompt: '回廊落刀', negative_prompt: '' },
      ],
      generateAllImages: async () => [
        { shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true },
        { shotId: 'shot_002', imagePath: '/tmp/shot_002.png', success: true },
      ],
      regenerateImage: async (shotId) => ({ shotId, imagePath: `/tmp/${shotId}-regen.png`, success: true }),
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({
        reports: [{ previousShotId: 'shot_001', shotId: 'shot_002', continuityScore: 5 }],
        flaggedTransitions: [{ previousShotId: 'shot_001', shotId: 'shot_002', continuityScore: 5 }],
      }),
      planMotion: async () => [
        { shotId: 'shot_001', shotType: 'fight_wide', durationTargetSec: 2, cameraSpec: { ratio: '9:16' }, cameraIntent: 'tracking', visualGoal: '起势', videoGenerationMode: 'runway_image_to_video' },
        { shotId: 'shot_002', shotType: 'fight_wide', durationTargetSec: 2, cameraSpec: { ratio: '9:16' }, cameraIntent: 'tracking', visualGoal: '落刀', videoGenerationMode: 'runway_image_to_video' },
      ],
      planPerformance: async () => [
        { shotId: 'shot_001', performanceTemplate: 'combat', generationTier: 'enhanced', variantCount: 1 },
        { shotId: 'shot_002', performanceTemplate: 'combat', generationTier: 'enhanced', variantCount: 1 },
      ],
      routeVideoShots: async () => [
        { shotId: 'shot_001', preferredProvider: 'runway', durationTargetSec: 2 },
        { shotId: 'shot_002', preferredProvider: 'runway', durationTargetSec: 2 },
      ],
      runRunwayVideo: async () => ({
        results: [
          { shotId: 'shot_001', status: 'completed', videoPath: '/tmp/shot_001.mp4', targetDurationSec: 2 },
          { shotId: 'shot_002', status: 'completed', videoPath: '/tmp/shot_002.mp4', targetDurationSec: 2 },
        ],
      }),
      runMotionEnhancer: async (results) =>
        results.map((item) => ({
          ...item,
          enhancedVideoPath: item.videoPath,
          actualDurationSec: item.targetDurationSec,
        })),
      runShotQa: async () => ({
        entries: [
          { shotId: 'shot_001', finalDecision: 'pass', canUseVideo: true },
          { shotId: 'shot_002', finalDecision: 'pass', canUseVideo: true },
        ],
      }),
      planBridgeShots: async (_shots, context) => {
        bridgeCallOrder.push('plan');
        assert.equal(context.continuityFlaggedTransitions.length, 1);
        return [
          {
            bridgeId: 'bridge_shot_001_shot_002',
            fromShotId: 'shot_001',
            toShotId: 'shot_002',
          },
        ];
      },
      routeBridgeShots: async (bridgeShotPlan) => {
        bridgeCallOrder.push('route');
        assert.equal(bridgeShotPlan.length, 1);
        return [{ bridgeId: bridgeShotPlan[0].bridgeId, preferredProvider: 'runway', durationTargetSec: 1.8 }];
      },
      generateBridgeClips: async (bridgeShotPackages) => {
        bridgeCallOrder.push('generate');
        assert.equal(bridgeShotPackages.length, 1);
        return {
          results: [{ bridgeId: 'bridge_shot_001_shot_002', status: 'completed', videoPath: '/tmp/bridge.mp4', targetDurationSec: 1.8 }],
        };
      },
      runBridgeQa: async (bridgeClipResults) => {
        bridgeCallOrder.push('qa');
        assert.equal(bridgeClipResults.length, 1);
        return {
          status: 'pass',
          entries: [{ bridgeId: 'bridge_shot_001_shot_002', finalDecision: 'pass' }],
          passedCount: 1,
          fallbackCount: 0,
          manualReviewCount: 0,
          warnings: [],
          blockers: [],
        };
      },
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async (shots) => shots.map((shot) => ({ shotId: shot.id, audioPath: `/tmp/${shot.id}.mp3` })),
      runTtsQa: async () => ({ status: 'pass', warnings: [], manualReviewPlan: { recommendedShotIds: [] } }),
      runLipsync: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
      composeVideo: async (_shots, _imageResults, _audioResults, _outputPath, options) => {
        composeCalls.push(options.bridgeClips || []);
        return { status: 'completed', outputVideo: { uri: path.join(dirs.output, 'final-video.mp4') }, report: { warnings: [], blockedReasons: [] } };
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.deepEqual(bridgeCallOrder, ['plan', 'route', 'generate', 'qa']);
    assert.equal(composeCalls[0].length, 1);
    assert.equal(composeCalls[0][0].bridgeId, 'bridge_shot_001_shot_002');
    const state = stateByFile.get(path.join(dirs.root, 'state.json'));
    assert.deepEqual(state.bridgeShotPlan, [{ bridgeId: 'bridge_shot_001_shot_002', fromShotId: 'shot_001', toShotId: 'shot_002' }]);
    assert.deepEqual(state.bridgeShotPackages, [{ bridgeId: 'bridge_shot_001_shot_002', preferredProvider: 'runway', durationTargetSec: 1.8 }]);
    assert.deepEqual(state.bridgeClipResults, [{ bridgeId: 'bridge_shot_001_shot_002', status: 'completed', videoPath: '/tmp/bridge.mp4', targetDurationSec: 1.8 }]);
    assert.equal(state.bridgeQaReport.passedCount, 1);
  });
});

test('runEpisodePipeline reuses cached bridge state and does not rerun the bridge subchain', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const stateFile = path.join(dirs.root, 'state.json');
    const stateByFile = new Map();
    stateByFile.set(
      stateFile,
      {
        characterRegistry: [{ name: '宁王', basePromptTokens: 'ning wang' }],
        promptList: [{ shotId: 'shot_001', image_prompt: '回廊起势', negative_prompt: '' }],
        imageResults: [{ shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true, keyframeAssetId: 'kf_1', characters: ['宁王'] }],
        consistencyCheckDone: true,
        continuityCheckDone: true,
        continuityReport: [],
        continuityFlaggedTransitions: [],
        bridgeShotPlan: [{ bridgeId: 'bridge_cached', fromShotId: 'shot_001', toShotId: 'shot_002' }],
        bridgeShotPackages: [{ bridgeId: 'bridge_cached', preferredProvider: 'runway', durationTargetSec: 1.8 }],
        bridgeClipResults: [{ bridgeId: 'bridge_cached', status: 'completed', videoPath: '/tmp/bridge.mp4', targetDurationSec: 1.8 }],
        bridgeQaReport: { status: 'pass', entries: [{ bridgeId: 'bridge_cached', finalDecision: 'pass' }], passedCount: 1, fallbackCount: 0, manualReviewCount: 0, warnings: [], blockers: [] },
        motionPlan: [{ shotId: 'shot_001', shotType: 'dialogue_medium', durationTargetSec: 2, cameraSpec: { ratio: '9:16' }, cameraIntent: 'slow_dolly', visualGoal: '对视', videoGenerationMode: 'runway_image_to_video' }],
        performancePlan: [{ shotId: 'shot_001', performanceTemplate: 'dialogue', generationTier: 'enhanced', variantCount: 1 }],
        shotPackages: [{ shotId: 'shot_001', preferredProvider: 'runway', durationTargetSec: 2 }],
        rawVideoResults: [{ shotId: 'shot_001', status: 'completed', videoPath: '/tmp/shot_001.mp4', targetDurationSec: 2 }],
        enhancedVideoResults: [{ shotId: 'shot_001', status: 'completed', videoPath: '/tmp/shot_001.mp4', enhancedVideoPath: '/tmp/shot_001.mp4', targetDurationSec: 2 }],
        shotQaReport: { entries: [{ shotId: 'shot_001', finalDecision: 'pass', canUseVideo: true }] },
        shotQaReportV2: { entries: [{ shotId: 'shot_001', finalDecision: 'pass', canUseVideo: true }] },
        videoResults: [{ shotId: 'shot_001', status: 'completed', videoPath: '/tmp/shot_001.mp4', targetDurationSec: 2 }],
        normalizedShots: [{ id: 'shot_001', scene: '回廊' }],
        audioResults: [{ shotId: 'shot_001', audioPath: '/tmp/shot_001.mp3' }],
        audioVoiceResolution: [],
        audioProjectId: 'project_1',
        lipsyncResults: [],
        lipsyncReport: { status: 'pass', warnings: [], blockers: [] },
      }
    );

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_bridge_cached',
      loadJSON: (filePath) => stateByFile.get(filePath) ?? null,
      saveJSON: (filePath, data) => stateByFile.set(filePath, structuredClone(data)),
      loadProject: () => ({ id: 'project_1', name: '寒烬宫变' }),
      loadScript: () => ({ id: 'script_1', title: '寒烬宫变', characters: [{ name: '宁王' }] }),
      loadEpisode: () => ({ id: 'episode_1', title: '第一集', shots: [{ id: 'shot_001', scene: '回廊', characters: ['宁王'] }] }),
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      planBridgeShots: async () => {
        throw new Error('planBridgeShots should not run when cache exists');
      },
      routeBridgeShots: async () => {
        throw new Error('routeBridgeShots should not run when cache exists');
      },
      generateBridgeClips: async () => {
        throw new Error('generateBridgeClips should not run when cache exists');
      },
      runBridgeQa: async () => {
        throw new Error('runBridgeQa should not run when cache exists');
      },
      runTtsQa: async () => ({ status: 'pass', warnings: [], manualReviewPlan: { recommendedShotIds: [] } }),
      composeVideo: async () => ({ status: 'completed', outputVideo: { uri: path.join(dirs.output, 'final-video.mp4') }, report: { warnings: [], blockedReasons: [] } }),
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    const finalState = stateByFile.get(stateFile);
    assert.equal(finalState.bridgeShotPlan[0].bridgeId, 'bridge_cached');
    assert.equal(finalState.bridgeQaReport.passedCount, 1);
  });
});
