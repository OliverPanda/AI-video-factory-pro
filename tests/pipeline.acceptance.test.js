import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
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
    output: path.join(root, 'output'),
  };

  Object.values(dirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  return dirs;
}

test('pipeline acceptance writes all major agent manifests including continuity checker', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const runJobs = [];

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
            continuityScore: 9,
            violations: [],
            repairHints: [],
          },
        ],
        flaggedTransitions: [],
      }),
      generateAllAudio: async (shots) =>
        shots.map((shot) => ({ shotId: shot.id, audioPath: path.join(dirs.audio, `${shot.id}.mp3`) })),
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      composeVideo: async (_shots, _images, _audio, outputPath) => {
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
    assert.equal(fs.existsSync(artifactContext.agents.videoComposer.manifestPath), true);

    const qaOverview = JSON.parse(
      fs.readFileSync(path.join(artifactContext.runDir, 'qa-overview.json'), 'utf-8')
    );
    assert.equal(qaOverview.status, 'pass');
    assert.equal(qaOverview.releasable, true);
  });
});
