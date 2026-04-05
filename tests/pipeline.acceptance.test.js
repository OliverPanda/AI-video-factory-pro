import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
import { buildCompositionPlan } from '../src/agents/videoComposer.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { buildEpisodeDirName, buildProjectDirName } from '../src/utils/naming.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-pipeline-acceptance-'));

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
    video: path.join(root, 'video'),
    output: path.join(root, 'output'),
  };

  Object.values(dirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  return dirs;
}

test('pipeline acceptance writes all major agent manifests including continuity checker', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const runJobs = [];
    const composeCalls = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_pipeline_acceptance',
      loadJSON: () => null,
      createRunJob: (runJob) => runJobs.push(structuredClone(runJob)),
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      loadProject: () => ({ id: 'project_1', name: '验收项目' }),
      loadScript: () => ({ id: 'script_1', title: '第一卷', characters: [{ name: '沈清' }] }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        episodeNo: 1,
        shots: [
          { id: 'shot_001', scene: '宫道', action: '走动', characters: ['沈清'] },
          {
            id: 'shot_002',
            scene: '回廊',
            action: '停步',
            characters: ['沈清'],
            continuityState: { carryOverFromShotId: 'shot_001', sceneLighting: 'morning' },
          },
        ],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async (shots) =>
        shots.map((shot) => ({ shotId: shot.id, image_prompt: shot.scene, negative_prompt: '' })),
      generateAllImages: async (prompts) =>
        prompts.map((prompt) => ({
          shotId: prompt.shotId,
          imagePath: path.join(dirs.images, `${prompt.shotId}.png`),
          success: true,
        })),
      runConsistencyCheck: async () => ({ reports: [], needsRegeneration: [] }),
      runContinuityCheck: async () => ({
        reports: [
          {
            previousShotId: 'shot_001',
            shotId: 'shot_002',
            continuityScore: 5,
            violations: [],
            repairHints: [],
          },
        ],
        flaggedTransitions: [{ previousShotId: 'shot_001', shotId: 'shot_002', continuityScore: 5 }],
      }),
      planPerformance: async (motionPlan) =>
        motionPlan.map((item) => ({
          shotId: item.shotId,
          performanceTemplate: 'dialogue_closeup_react',
          actionBeatList: [],
          cameraMovePlan: { pattern: 'push_in' },
          generationTier: 'base',
          variantCount: 1,
          enhancementHints: [],
        })),
      runRunwayVideo: async (shotPackages) => ({
        results: shotPackages.map((shotPackage) => ({
          shotId: shotPackage.shotId,
          provider: 'runway',
          model: 'gen4_turbo',
          status: 'completed',
          videoPath: path.join(dirs.root, `${shotPackage.shotId}.mp4`),
          targetDurationSec: shotPackage.durationTargetSec,
          actualDurationSec: shotPackage.durationTargetSec,
          variantIndex: 0,
        })),
        report: { status: 'pass', warnings: [], blockers: [] },
      }),
      runMotionEnhancer: async (rawVideoResults) =>
        rawVideoResults.map((item) => ({
          shotId: item.shotId,
          sourceVideoPath: item.videoPath,
          enhancementApplied: false,
          enhancementProfile: 'none',
          enhancementActions: [],
          enhancedVideoPath: item.videoPath,
          durationAdjusted: false,
          cameraMotionInjected: false,
          interpolationApplied: false,
          stabilizationApplied: false,
          qualityDelta: 'unchanged',
          status: 'completed',
          error: null,
          targetDurationSec: item.targetDurationSec,
          actualDurationSec: item.actualDurationSec,
        })),
      runShotQa: async (enhancedVideoResults) => ({
        status: 'pass',
        entries: enhancedVideoResults.map((item) => ({
          shotId: item.shotId,
          canUseVideo: true,
          fallbackToImage: false,
          finalDecision: 'pass',
        })),
        fallbackCount: 0,
        fallbackShots: [],
        warnings: [],
      }),
      planBridgeShots: async () => [
        {
          bridgeId: 'bridge_shot_001_shot_002',
          fromShotId: 'shot_001',
          toShotId: 'shot_002',
          bridgeType: 'motion_carry',
          bridgeGoal: 'carry_action_across_cut',
          durationTargetSec: 1.6,
          continuityRisk: 'high',
          cameraTransitionIntent: 'follow_through_motion',
          subjectContinuityTargets: ['沈清'],
          environmentContinuityTargets: ['lighting'],
          mustPreserveElements: ['subject_identity'],
          bridgeGenerationMode: 'image_to_video_bridge',
          preferredProvider: 'runway',
          fallbackStrategy: 'direct_cut',
        },
      ],
      routeBridgeShots: async () => [
        {
          bridgeId: 'bridge_shot_001_shot_002',
          fromShotRef: { shotId: 'shot_001' },
          toShotRef: { shotId: 'shot_002' },
          fromReferenceImage: path.join(dirs.images, 'shot_001.png'),
          toReferenceImage: path.join(dirs.images, 'shot_002.png'),
          promptDirectives: ['bridge type: motion_carry'],
          negativePromptDirectives: ['identity drift'],
          durationTargetSec: 1.6,
          providerCapabilityRequirement: 'image_to_video',
          firstLastFrameMode: 'disabled',
          preferredProvider: 'runway',
          fallbackProviders: ['direct_cut'],
          qaRules: { mustProbeWithFfprobe: true },
        },
      ],
      generateBridgeClips: async () => ({
        results: [
          {
            bridgeId: 'bridge_shot_001_shot_002',
            status: 'completed',
            provider: 'runway',
            model: 'gen4_turbo',
            videoPath: path.join(dirs.video, 'bridge_shot_001_shot_002.mp4'),
            targetDurationSec: 1.6,
            actualDurationSec: 1.6,
          },
        ],
      }),
      runBridgeQa: async () => ({
        status: 'pass',
        entries: [
          {
            bridgeId: 'bridge_shot_001_shot_002',
            finalDecision: 'pass',
          },
        ],
        passedCount: 1,
        fallbackCount: 0,
        manualReviewCount: 0,
        warnings: [],
        blockers: [],
      }),
      planActionSequences: async () => [
        {
          sequenceId: 'seq_001',
          shotIds: ['shot_001', 'shot_002'],
          sequenceType: 'fight_exchange_sequence',
          sequenceGoal: '连续动作保持节奏',
          durationTargetSec: 4,
          cameraFlowIntent: 'push_in_then_follow',
          motionContinuityTargets: ['hand_position'],
          subjectContinuityTargets: ['沈清'],
          environmentContinuityTargets: ['lighting'],
          mustPreserveElements: ['subject_identity'],
          entryConstraint: '接住上一镜的动作惯性',
          exitConstraint: '落到下一轮攻防节拍',
          generationMode: 'bridge_assisted',
          preferredProvider: 'runway',
          fallbackStrategy: 'fallback_to_shot_and_bridge',
        },
      ],
      routeActionSequencePackages: async () => [
        {
          sequenceId: 'seq_001',
          shotIds: ['shot_001', 'shot_002'],
          durationTargetSec: 4,
          referenceImages: [],
          referenceVideos: [
            {
              type: 'qa_passed_video',
              shotId: 'shot_001',
              path: path.join(dirs.video, 'shot_001.mp4'),
              provider: 'runway',
              qaDecision: 'pass',
            },
          ],
          bridgeReferences: [],
          visualGoal: '连续动作保持节奏',
          cameraSpec: 'push_in_then_follow',
          continuitySpec: 'keep_motion_flow',
          entryFrameHint: '接住上一镜的动作惯性',
          exitFrameHint: '落到下一轮攻防节拍',
          audioBeatHints: [],
          preferredProvider: 'runway',
          fallbackProviders: ['bridge_clip', 'image'],
          qaRules: ['reference_tier:video'],
        },
      ],
      generateSequenceClips: async () => ({
        results: [
          {
            sequenceId: 'seq_001',
            status: 'completed',
            provider: 'runway',
            model: 'gen4_turbo',
            videoPath: path.join(dirs.video, 'seq_001.mp4'),
            coveredShotIds: ['shot_001', 'shot_002'],
            targetDurationSec: 4,
            actualDurationSec: 4,
            failureCategory: null,
            error: null,
          },
        ],
      }),
      runSequenceQa: async () => ({
        status: 'pass',
        entries: [
          {
            sequenceId: 'seq_001',
            coveredShotIds: ['shot_001', 'shot_002'],
            engineCheck: 'pass',
            continuityCheck: 'pass',
            durationCheck: 'pass',
            entryExitCheck: 'pass',
            finalDecision: 'pass',
            fallbackAction: 'none',
            notes: 'ok',
          },
        ],
        passedCount: 1,
        fallbackCount: 0,
        manualReviewCount: 0,
        warnings: [],
        blockers: [],
      }),
      generateAllAudio: async (shots) =>
        shots.map((shot) => ({ shotId: shot.id, audioPath: path.join(dirs.audio, `${shot.id}.mp3`) })),
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      composeVideo: async (shots, imageResults, audioResults, outputPath, options) => {
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
          bridgeClips: options.bridgeClips || [],
          sequenceClips: options.sequenceClips || [],
          plan,
        });
        assert.equal(options.sequenceClips.length, 1);
        assert.deepEqual(options.sequenceClips[0].coveredShotIds, ['shot_001', 'shot_002']);
        fs.writeFileSync(outputPath, 'video');
        return outputPath;
      },
    });

    const outputPath = await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {
        storeOptions: { baseTempDir: tempRoot },
        startedAt: '2026-04-02T10:00:00.000Z',
      },
    });

    assert.equal(fs.existsSync(outputPath), true);
    assert.equal(
      outputPath,
      path.join(
        dirs.output,
        buildProjectDirName('验收项目', 'project_1'),
        buildEpisodeDirName({ episodeNo: 1, id: 'episode_1' }),
        'final-video.mp4'
      )
    );
    assert.equal(fs.existsSync(path.join(path.dirname(outputPath), 'delivery-summary.md')), true);
    assert.equal(runJobs.length, 1);
    const deliverySummary = fs.readFileSync(path.join(path.dirname(outputPath), 'delivery-summary.md'), 'utf-8');
    assert.match(deliverySummary, /planned_sequence_count: 1/);
    assert.match(deliverySummary, /generated_sequence_count: 1/);
    assert.match(deliverySummary, /sequence_provider_breakdown: \{\"runway\":1\}/);
    assert.match(deliverySummary, /sequence_fallback_count: 0/);

    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '验收项目',
      scriptId: 'script_1',
      scriptTitle: '第一卷',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: runJobs[0].id,
      startedAt: '2026-04-02T10:00:00.000Z',
    });

    assert.equal(fs.existsSync(path.join(artifactContext.runDir, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.runDir, 'timeline.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.runDir, 'qa-overview.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.runDir, 'qa-overview.md')), true);
    assert.equal(fs.existsSync(artifactContext.agents.characterRegistry.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.promptEngineer.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.imageGenerator.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.consistencyChecker.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.continuityChecker.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.ttsAgent.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.ttsQaAgent.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.motionPlanner.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.performancePlanner.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.videoRouter.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.runwayVideoAgent.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.motionEnhancer.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.shotQaAgent.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.bridgeShotPlanner.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.bridgeShotRouter.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.bridgeClipGenerator.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.bridgeQaAgent.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.actionSequencePlanner.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.actionSequenceRouter.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.sequenceClipGenerator.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.sequenceQaAgent.manifestPath), true);
    assert.equal(fs.existsSync(artifactContext.agents.videoComposer.manifestPath), true);
    assert.equal(composeCalls[0].bridgeClips.length, 1);
    assert.equal(composeCalls[0].bridgeClips[0].bridgeId, 'bridge_shot_001_shot_002');
    assert.equal(composeCalls[0].sequenceClips.length, 1);
    assert.equal(composeCalls[0].sequenceClips[0].sequenceId, 'seq_001');
    assert.deepEqual(
      composeCalls[0].plan.map((item) => item.shotId),
      ['sequence:seq_001']
    );

    const qaOverview = JSON.parse(
      fs.readFileSync(path.join(artifactContext.runDir, 'qa-overview.json'), 'utf-8')
    );
    assert.equal(qaOverview.status, 'pass');
    assert.equal(qaOverview.releasable, true);
  });
});
