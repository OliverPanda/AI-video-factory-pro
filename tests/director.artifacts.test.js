import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { withManagedTempRoot } from './helpers/testArtifacts.js';

function createLegacyDirs(root) {
  const dirs = {
    root,
    images: path.join(root, 'images'),
    audio: path.join(root, 'audio'),
    output: path.join(root, 'output'),
  };

  Object.values(dirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  return dirs;
}

test('director creates manifest timeline and agent directories for an episode run', async (t) => {
  await withManagedTempRoot(t, 'aivf-director-artifacts', async (tempRoot) => {
    const legacyRoot = path.join(tempRoot, 'legacy-job');
    const artifactRoot = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_job_artifacts',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    fs.rmSync(artifactRoot.runDir, { recursive: true, force: true });
    fs.rmSync(artifactRoot.runsDir, { recursive: true, force: true });

    const director = createDirector({
      parseScript: async () => {
        throw new Error('should not be used in project mode');
      },
      buildCharacterRegistry: async () => [],
      generateAllPrompts: async () => [],
      generateAllImages: async () => [],
      generateAllAudio: async () => [],
      composeVideo: async (_shots, _images, _audio, outputPath) => outputPath,
      loadProject: () => ({ id: 'project_123', name: '咖啡馆相遇' }),
      loadScript: () => ({ id: 'script_001', title: '第一卷', characters: [], sourceText: '...' }),
      loadEpisode: () => ({ id: 'episode_001', title: '试播集', episodeNo: 1, shots: [] }),
      createRunJob: (input) => input,
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      initDirs: () => createLegacyDirs(legacyRoot),
      generateJobId: () => 'job_artifacts',
    });

    await director.runEpisodePipeline({
      projectId: 'project_123',
      scriptId: 'script_001',
      episodeId: 'episode_001',
      options: {
        jobId: 'job_artifacts',
        storeOptions: { baseTempDir: tempRoot },
        startedAt: '2026-04-01T09:00:00.000Z',
      },
    });

    const runDirs = fs.readdirSync(artifactRoot.runsDir);
    assert.equal(runDirs.length, 1);

    const expectedRunDir = path.join(artifactRoot.runsDir, runDirs[0]);

    assert.equal(fs.existsSync(path.join(expectedRunDir, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, 'timeline.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, 'state.snapshot.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '01-script-parser')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '01-script-parser', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '09a-motion-planner', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '09b-performance-planner', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '09c-video-router', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '09d-runway-video-agent', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '09d-sora2-video-agent', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '09d-seedance-video-agent', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '09e-motion-enhancer', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '09f-shot-qa', 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(expectedRunDir, '10-video-composer', 'manifest.json')), true);

    const manifest = JSON.parse(fs.readFileSync(path.join(expectedRunDir, 'manifest.json'), 'utf-8'));
    assert.equal(manifest.projectId, 'project_123');
    assert.equal(manifest.projectName, '咖啡馆相遇');
    assert.equal(manifest.scriptId, 'script_001');
    assert.equal(manifest.episodeId, 'episode_001');
    assert.match(manifest.runJobId, /^run_job_artifacts_\d{17}_[a-f0-9]{8}$/);

    const timeline = JSON.parse(fs.readFileSync(path.join(expectedRunDir, 'timeline.json'), 'utf-8'));
    assert.equal(Array.isArray(timeline), true);
    assert.equal(timeline.length, 1);
    assert.deepEqual(timeline[0], {
      event: 'run_initialized',
      status: 'running',
      at: '2026-04-01T09:00:00.000Z',
      runJobId: manifest.runJobId,
      jobId: 'job_artifacts',
    });

    const stateSnapshot = JSON.parse(
      fs.readFileSync(path.join(expectedRunDir, 'state.snapshot.json'), 'utf-8')
    );
    assert.match(
      stateSnapshot.outputPath,
      /output[\\/].+__project_123[\\/]第01集__episode_001[\\/]final-video\.mp4$/
    );
    assert.match(
      stateSnapshot.deliverySummaryPath,
      /output[\\/].+__project_123[\\/]第01集__episode_001[\\/]delivery-summary\.md$/
    );
    assert.equal(typeof stateSnapshot.completedAt, 'string');

    const agentManifest = JSON.parse(
      fs.readFileSync(path.join(expectedRunDir, '01-script-parser', 'manifest.json'), 'utf-8')
    );
    assert.equal(agentManifest.status, 'pending');
    assert.equal(agentManifest.agentKey, 'scriptParser');
    assert.equal(agentManifest.agentDirName, '01-script-parser');
  }, 'director');
});
