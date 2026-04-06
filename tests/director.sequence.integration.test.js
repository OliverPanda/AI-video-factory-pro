import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
import { buildCompositionPlan } from '../src/agents/videoComposer.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-director-sequence-'));
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

test('runEpisodePipeline integrates the sequence subchain and passes approved sequence clips into compose', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const stateByFile = new Map();
    const sequenceCallOrder = [];
    const composeCalls = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_sequence_integration',
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
          { id: 'shot_001', scene: '回廊', action: '宁王转身逼近', characters: ['宁王'] },
          { id: 'shot_002', scene: '回廊', action: '宁王挥刀压上', characters: ['宁王'] },
          { id: 'shot_003', scene: '回廊', action: '对手后退反击', characters: ['宁王'] },
        ],
      }),
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      buildCharacterRegistry: async () => [{ name: '宁王', basePromptTokens: 'ning wang' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_001', image_prompt: '回廊逼近', negative_prompt: '' },
        { shotId: 'shot_002', image_prompt: '回廊压上', negative_prompt: '' },
        { shotId: 'shot_003', image_prompt: '回廊反击', negative_prompt: '' },
      ],
      generateAllImages: async () => [
        { shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true },
        { shotId: 'shot_002', imagePath: '/tmp/shot_002.png', success: true },
        { shotId: 'shot_003', imagePath: '/tmp/shot_003.png', success: true },
      ],
      regenerateImage: async (shotId) => ({ shotId, imagePath: `/tmp/${shotId}-regen.png`, success: true }),
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({
        reports: [{ previousShotId: 'shot_001', shotId: 'shot_002', continuityScore: 4 }],
        flaggedTransitions: [{ previousShotId: 'shot_001', shotId: 'shot_002', continuityScore: 4 }],
      }),
      planMotion: async () => [
        { shotId: 'shot_001', shotType: 'fight_wide', durationTargetSec: 2, cameraSpec: { ratio: '9:16' }, cameraIntent: 'tracking', visualGoal: '逼近', videoGenerationMode: 'seedance_image_to_video' },
        { shotId: 'shot_002', shotType: 'fight_wide', durationTargetSec: 2, cameraSpec: { ratio: '9:16' }, cameraIntent: 'tracking', visualGoal: '压上', videoGenerationMode: 'seedance_image_to_video' },
        { shotId: 'shot_003', shotType: 'fight_wide', durationTargetSec: 2, cameraSpec: { ratio: '9:16' }, cameraIntent: 'tracking', visualGoal: '反击', videoGenerationMode: 'seedance_image_to_video' },
      ],
      planPerformance: async () => [
        { shotId: 'shot_001', performanceTemplate: 'combat', generationTier: 'enhanced', variantCount: 1 },
        { shotId: 'shot_002', performanceTemplate: 'combat', generationTier: 'enhanced', variantCount: 1 },
        { shotId: 'shot_003', performanceTemplate: 'combat', generationTier: 'enhanced', variantCount: 1 },
      ],
      routeVideoShots: async () => [
        { shotId: 'shot_001', preferredProvider: 'seedance', durationTargetSec: 2 },
        { shotId: 'shot_002', preferredProvider: 'seedance', durationTargetSec: 2 },
        { shotId: 'shot_003', preferredProvider: 'seedance', durationTargetSec: 2 },
      ],
      runSeedanceVideo: async () => ({
        results: [
          { shotId: 'shot_001', status: 'completed', provider: 'seedance', videoPath: '/tmp/shot_001.mp4', targetDurationSec: 2 },
          { shotId: 'shot_002', status: 'completed', provider: 'seedance', videoPath: '/tmp/shot_002.mp4', targetDurationSec: 2 },
          { shotId: 'shot_003', status: 'completed', provider: 'seedance', videoPath: '/tmp/shot_003.mp4', targetDurationSec: 2 },
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
          { shotId: 'shot_003', finalDecision: 'pass', canUseVideo: true },
        ],
        fallbackCount: 0,
      }),
      planBridgeShots: async () => [],
      routeBridgeShots: async () => [],
      generateBridgeClips: async () => ({ results: [] }),
      runBridgeQa: async () => ({
        status: 'pass',
        entries: [],
        passedCount: 0,
        fallbackCount: 0,
        manualReviewCount: 0,
        warnings: [],
        blockers: [],
      }),
      planActionSequences: async (_shots, context) => {
        sequenceCallOrder.push('plan');
        assert.equal(context.bridgeQaReport.status, 'pass');
        return [
          {
            sequenceId: 'sequence_001_002',
            shotIds: ['shot_001', 'shot_002'],
            durationTargetSec: 4,
            preferredProvider: 'seedance',
          },
        ];
      },
      routeActionSequencePackages: async (actionSequencePlan) => {
        sequenceCallOrder.push('route');
        assert.equal(actionSequencePlan.length, 1);
        return [
          {
            sequenceId: 'sequence_001_002',
            shotIds: ['shot_001', 'shot_002'],
            durationTargetSec: 4,
            preferredProvider: 'seedance',
          },
        ];
      },
      generateSequenceClips: async (packages) => {
        sequenceCallOrder.push('generate');
        assert.equal(packages.length, 1);
        return {
          results: [
            {
              sequenceId: 'sequence_001_002',
              status: 'completed',
              provider: 'seedance',
              videoPath: '/tmp/sequence_001_002.mp4',
              coveredShotIds: ['shot_001', 'shot_002'],
              targetDurationSec: 4,
              actualDurationSec: 4.1,
            },
          ],
        };
      },
      runSequenceQa: async (results) => {
        sequenceCallOrder.push('qa');
        assert.equal(results.length, 1);
        return {
          status: 'pass',
          entries: [
            {
              sequenceId: 'sequence_001_002',
              coveredShotIds: ['shot_001', 'shot_002'],
              finalDecision: 'pass',
            },
          ],
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
      composeVideo: async (shots, imageResults, audioResults, _outputPath, options) => {
        const plan = buildCompositionPlan(
          shots,
          imageResults,
          audioResults,
          options.sequenceClips || [],
          options.videoClips || [],
          options.animationClips || [],
          options.lipsyncClips || [],
          options.bridgeClips || []
        );
        composeCalls.push({
          sequenceClips: options.sequenceClips || [],
          bridgeClips: options.bridgeClips || [],
          plan,
        });
        return { status: 'completed', outputVideo: { uri: path.join(dirs.output, 'final-video.mp4') }, report: { warnings: [], blockedReasons: [] } };
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.deepEqual(sequenceCallOrder, ['plan', 'route', 'generate', 'qa']);
    assert.equal(composeCalls[0].sequenceClips.length, 1);
    assert.equal(composeCalls[0].sequenceClips[0].sequenceId, 'sequence_001_002');
    assert.deepEqual(composeCalls[0].sequenceClips[0].coveredShotIds, ['shot_001', 'shot_002']);
    assert.deepEqual(
      composeCalls[0].plan.map((item) => item.shotId),
      ['sequence:sequence_001_002', 'shot_003']
    );

    const state = stateByFile.get(path.join(dirs.root, 'state.json'));
    assert.deepEqual(state.actionSequencePlan, [
      {
        sequenceId: 'sequence_001_002',
        shotIds: ['shot_001', 'shot_002'],
        durationTargetSec: 4,
        preferredProvider: 'seedance',
      },
    ]);
    assert.deepEqual(state.actionSequencePackages, [
      {
        sequenceId: 'sequence_001_002',
        shotIds: ['shot_001', 'shot_002'],
        durationTargetSec: 4,
        preferredProvider: 'seedance',
      },
    ]);
    assert.equal(state.sequenceClipResults[0].sequenceId, 'sequence_001_002');
    assert.equal(state.sequenceQaReport.passedCount, 1);
    assert.equal(state.pipelineSummary.planned_sequence_count, 1);
    assert.equal(state.pipelineSummary.generated_sequence_count, 1);
    assert.deepEqual(state.pipelineSummary.sequence_provider_breakdown, { seedance: 1 });
    assert.equal(state.pipelineSummary.sequence_fallback_count, 0);
    assert.equal(state.pipelineSummary.sequence_coverage_shot_count, 2);
    assert.equal(state.pipelineSummary.sequence_coverage_sequence_count, 1);
    assert.deepEqual(state.pipelineSummary.applied_sequence_ids, ['sequence_001_002']);
    assert.deepEqual(state.pipelineSummary.fallback_sequence_ids, []);
  });
});

test('runEpisodePipeline falls back to shot clips when sequence QA does not pass', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const stateByFile = new Map();
    const composePlans = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_sequence_fallback',
      loadJSON: () => null,
      saveJSON: (filePath, data) => stateByFile.set(filePath, structuredClone(data)),
      loadProject: () => ({ id: 'project_1', name: '寒烬宫变' }),
      loadScript: () => ({ id: 'script_1', title: '寒烬宫变', characters: [{ name: '宁王' }] }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [
          { id: 'shot_001', scene: '回廊', action: '宁王逼近', characters: ['宁王'] },
          { id: 'shot_002', scene: '回廊', action: '宁王出刀', characters: ['宁王'] },
        ],
      }),
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      buildCharacterRegistry: async () => [{ name: '宁王', basePromptTokens: 'ning wang' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_001', image_prompt: '逼近', negative_prompt: '' },
        { shotId: 'shot_002', image_prompt: '出刀', negative_prompt: '' },
      ],
      generateAllImages: async () => [
        { shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true },
        { shotId: 'shot_002', imagePath: '/tmp/shot_002.png', success: true },
      ],
      regenerateImage: async (shotId) => ({ shotId, imagePath: `/tmp/${shotId}.png`, success: true }),
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      planMotion: async () => [
        { shotId: 'shot_001', shotType: 'fight_wide', durationTargetSec: 2, cameraSpec: { ratio: '9:16' }, cameraIntent: 'tracking', visualGoal: '逼近', videoGenerationMode: 'runway_image_to_video' },
        { shotId: 'shot_002', shotType: 'fight_wide', durationTargetSec: 2, cameraSpec: { ratio: '9:16' }, cameraIntent: 'tracking', visualGoal: '出刀', videoGenerationMode: 'runway_image_to_video' },
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
          { shotId: 'shot_001', status: 'completed', provider: 'runway', videoPath: '/tmp/shot_001.mp4', targetDurationSec: 2 },
          { shotId: 'shot_002', status: 'completed', provider: 'runway', videoPath: '/tmp/shot_002.mp4', targetDurationSec: 2 },
        ],
      }),
      runMotionEnhancer: async (results) => results.map((item) => ({ ...item, enhancedVideoPath: item.videoPath, actualDurationSec: item.targetDurationSec })),
      runShotQa: async () => ({
        entries: [
          { shotId: 'shot_001', finalDecision: 'pass', canUseVideo: true },
          { shotId: 'shot_002', finalDecision: 'pass', canUseVideo: true },
        ],
        fallbackCount: 0,
      }),
      planBridgeShots: async () => [],
      routeBridgeShots: async () => [],
      generateBridgeClips: async () => ({ results: [] }),
      runBridgeQa: async () => ({ status: 'pass', entries: [], passedCount: 0, fallbackCount: 0, manualReviewCount: 0, warnings: [], blockers: [] }),
      planActionSequences: async () => [{ sequenceId: 'sequence_001_002', shotIds: ['shot_001', 'shot_002'], durationTargetSec: 4, preferredProvider: 'runway' }],
      routeActionSequencePackages: async () => [{ sequenceId: 'sequence_001_002', shotIds: ['shot_001', 'shot_002'], durationTargetSec: 4, preferredProvider: 'runway' }],
      generateSequenceClips: async () => ({
        results: [
          {
            sequenceId: 'sequence_001_002',
            status: 'completed',
            provider: 'runway',
            videoPath: '/tmp/sequence_001_002.mp4',
            coveredShotIds: ['shot_001', 'shot_002'],
            targetDurationSec: 4,
            actualDurationSec: 4,
          },
        ],
      }),
      runSequenceQa: async () => ({
        status: 'warn',
        entries: [
          {
            sequenceId: 'sequence_001_002',
            coveredShotIds: ['shot_001', 'shot_002'],
            finalDecision: 'manual_review',
            fallbackAction: 'manual_review',
          },
        ],
        passedCount: 0,
        fallbackCount: 1,
        manualReviewCount: 1,
        warnings: [],
        blockers: [],
      }),
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async (shots) => shots.map((shot) => ({ shotId: shot.id, audioPath: `/tmp/${shot.id}.mp3` })),
      runTtsQa: async () => ({ status: 'pass', warnings: [], manualReviewPlan: { recommendedShotIds: [] } }),
      runLipsync: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
      composeVideo: async (shots, imageResults, audioResults, _outputPath, options) => {
        composePlans.push(
          buildCompositionPlan(
            shots,
            imageResults,
            audioResults,
            options.sequenceClips || [],
            options.videoClips || [],
            options.animationClips || [],
            options.lipsyncClips || [],
            options.bridgeClips || []
          )
        );
        return { status: 'completed', outputVideo: { uri: path.join(dirs.output, 'final-video.mp4') }, report: { warnings: [], blockedReasons: [] } };
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.deepEqual(
      composePlans[0].map((item) => item.shotId),
      ['shot_001', 'shot_002']
    );
    assert.deepEqual(
      composePlans[0].map((item) => item.visualType),
      ['generated_video_clip', 'generated_video_clip']
    );
    const state = stateByFile.get(path.join(dirs.root, 'state.json'));
    assert.equal(state.pipelineSummary.sequence_coverage_shot_count, 0);
    assert.equal(state.pipelineSummary.sequence_coverage_sequence_count, 0);
    assert.deepEqual(state.pipelineSummary.applied_sequence_ids, []);
    assert.deepEqual(state.pipelineSummary.fallback_sequence_ids, ['sequence_001_002']);
  });
});

test('runEpisodePipeline reruns lipsync when cached lipsync key no longer matches regenerated audio', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const stateFile = path.join(dirs.root, 'state.json');
    const stateByFile = new Map();
    stateByFile.set(stateFile, {
      characterRegistry: [{ name: '宁王', basePromptTokens: 'ning wang' }],
      promptList: [{ shotId: 'shot_001', image_prompt: '回廊逼近', negative_prompt: '' }],
      imageResults: [{ shotId: 'shot_001', imagePath: '/tmp/shot_001.png', success: true, keyframeAssetId: 'kf_1' }],
      consistencyCheckDone: true,
      continuityCheckDone: true,
      continuityReport: [],
      continuityFlaggedTransitions: [],
      motionPlan: [{ shotId: 'shot_001', shotType: 'dialogue_medium', durationTargetSec: 2, cameraSpec: { ratio: '9:16' }, cameraIntent: 'slow_dolly', visualGoal: '对视', videoGenerationMode: 'runway_image_to_video' }],
      performancePlan: [{ shotId: 'shot_001', performanceTemplate: 'dialogue', generationTier: 'enhanced', variantCount: 1 }],
      shotPackages: [{ shotId: 'shot_001', preferredProvider: 'runway', durationTargetSec: 2 }],
      rawVideoResults: [{ shotId: 'shot_001', status: 'completed', videoPath: '/tmp/shot_001.mp4', targetDurationSec: 2 }],
      enhancedVideoResults: [{ shotId: 'shot_001', status: 'completed', enhancedVideoPath: '/tmp/shot_001.mp4', actualDurationSec: 2, targetDurationSec: 2 }],
      shotQaReport: { entries: [{ shotId: 'shot_001', finalDecision: 'pass', canUseVideo: true }], fallbackCount: 0 },
      shotQaReportV2: { entries: [{ shotId: 'shot_001', finalDecision: 'pass', canUseVideo: true }], fallbackCount: 0 },
      videoResults: [{ shotId: 'shot_001', status: 'completed', provider: 'runway', videoPath: '/tmp/shot_001.mp4', targetDurationSec: 2 }],
      bridgeShotPlan: [],
      bridgeShotPackages: [],
      bridgeClipResults: [],
      bridgeQaReport: { status: 'pass', entries: [], passedCount: 0, fallbackCount: 0, manualReviewCount: 0, warnings: [], blockers: [] },
      actionSequencePlan: [],
      actionSequencePackages: [],
      sequenceClipResults: [],
      sequenceQaReport: { status: 'pass', entries: [], passedCount: 0, fallbackCount: 0, manualReviewCount: 0, warnings: [], blockers: [] },
      normalizedShots: [{ id: 'shot_001', dialogue: '新的对白', speaker: '宁王' }],
      lipsyncResults: [{ shotId: 'shot_001', videoPath: '/tmp/stale-lipsync.mp4' }],
      lipsyncReport: { status: 'pass', warnings: [], blockers: [] },
      lipsyncCacheKey: 'stale-key',
    });

    let lipsyncCallCount = 0;

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_lipsync_cache_invalidation',
      loadJSON: (filePath) => stateByFile.get(filePath) ?? null,
      saveJSON: (filePath, data) => stateByFile.set(filePath, structuredClone(data)),
      loadProject: () => ({ id: 'project_1', name: '寒烬宫变' }),
      loadScript: () => ({ id: 'script_1', title: '寒烬宫变', characters: [{ name: '宁王' }] }),
      loadEpisode: () => ({ id: 'episode_1', title: '第一集', shots: [{ id: 'shot_001', scene: '回廊', characters: ['宁王'] }] }),
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      loadVoiceCast: () => [],
      generateAllAudio: async () => [{ shotId: 'shot_001', audioPath: path.join(dirs.audio, 'shot_001_new.mp3') }],
      runTtsQa: async () => ({ status: 'pass', warnings: [], manualReviewPlan: { recommendedShotIds: [] } }),
      runLipsync: async () => {
        lipsyncCallCount += 1;
        return { results: [{ shotId: 'shot_001', videoPath: '/tmp/fresh-lipsync.mp4' }], report: { status: 'pass', warnings: [], blockers: [] } };
      },
      composeVideo: async () => ({ status: 'completed', outputVideo: { uri: path.join(dirs.output, 'final-video.mp4') }, report: { warnings: [], blockedReasons: [] } }),
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(lipsyncCallCount, 1);
    const finalState = stateByFile.get(stateFile);
    assert.equal(finalState.lipsyncResults[0].videoPath, '/tmp/fresh-lipsync.mp4');
    assert.notEqual(finalState.lipsyncCacheKey, 'stale-key');
  });
});
