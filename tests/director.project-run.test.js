import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-director-'));

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

test('runEpisodePipeline returns the requested episode artifact path', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_episode_1',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '宫墙疑云',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_2',
        title: '第二集',
        summary: '只处理这一集',
        shots: [{ id: 'shot_b', scene: '偏殿', characters: ['沈清'] }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [{ shotId: 'shot_b', image_prompt: 'prompt', negative_prompt: '' }],
      generateAllImages: async () => [{ shotId: 'shot_b', imagePath: '/tmp/shot_b.png', success: true }],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      generateAllAudio: async () => [{ shotId: 'shot_b', audioPath: '/tmp/shot_b.mp3' }],
      composeVideo: async () => {},
    });

    const outputPath = await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_2',
      options: { style: '3d' },
    });

    assert.equal(
      outputPath,
      path.join(dirs.output, '宫墙疑云_第二集_job_episode_1.mp4')
    );
  });
});

test('runEpisodePipeline sends only the current episode shots to audio and video composition', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const audioCalls = [];
    const composeCalls = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_episode_scope',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '双生局',
        characters: [{ name: '阿九' }],
        shots: [
          { id: 'shot_legacy_1', scene: '不该使用的旧镜头' },
          { id: 'shot_legacy_2', scene: '也不该使用' },
        ],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [
          { id: 'shot_ep_1', scene: '茶楼', characters: ['阿九'] },
          { id: 'shot_ep_2', scene: '回廊', characters: ['阿九'] },
        ],
      }),
      buildCharacterRegistry: async () => [{ name: '阿九', basePromptTokens: 'a jiu' }],
      generateAllPrompts: async (shots) =>
        shots.map((shot) => ({ shotId: shot.id, image_prompt: shot.scene, negative_prompt: '' })),
      generateAllImages: async (prompts) =>
        prompts.map((prompt) => ({
          shotId: prompt.shotId,
          imagePath: `/tmp/${prompt.shotId}.png`,
          success: true,
        })),
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      generateAllAudio: async (shots) => {
        audioCalls.push(shots.map((shot) => shot.id));
        return shots.map((shot) => ({ shotId: shot.id, audioPath: `/tmp/${shot.id}.mp3` }));
      },
      composeVideo: async (shots) => {
        composeCalls.push(shots.map((shot) => shot.id));
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.deepEqual(audioCalls, [['shot_ep_1', 'shot_ep_2']]);
    assert.deepEqual(composeCalls, [['shot_ep_1', 'shot_ep_2']]);
  });
});

test('runPipeline compatibility mode reuses the same legacy identities and job state across reruns', async () => {
  await withTempRoot(async (tempRoot) => {
    const scriptFilePath = path.join(tempRoot, 'legacy-script.txt');
    const stateByFile = new Map();
    const projects = new Map();
    const scripts = new Map();
    const episodes = new Map();
    const outputs = [];
    let parseCalls = 0;
    let audioCalls = 0;

    fs.writeFileSync(scriptFilePath, '旧入口剧本文本', 'utf-8');

    const director = createDirector({
      readTextFile: () => '旧入口剧本文本',
      initDirs: (jobId) => createDirs(path.join(tempRoot, jobId)),
      loadJSON: (filePath) => stateByFile.get(filePath) ?? null,
      saveJSON: (filePath, data) => stateByFile.set(filePath, structuredClone(data)),
      parseScript: async () => ({
        ...(parseCalls++, {}),
        title: '旧入口兼容',
        characters: [{ name: '沈清' }],
        shots: [{ id: 'shot_1', scene: '冷宫', characters: ['沈清'] }],
      }),
      saveProject: (project) => projects.set(project.id, structuredClone(project)),
      loadScript: (projectId, scriptId) => scripts.get(`${projectId}:${scriptId}`) ?? null,
      saveScript: (projectId, script) =>
        scripts.set(`${projectId}:${script.id}`, structuredClone({ ...script, projectId })),
      loadEpisode: (projectId, scriptId, episodeId) =>
        episodes.get(`${projectId}:${scriptId}:${episodeId}`) ?? null,
      saveEpisode: (projectId, scriptId, episode) =>
        episodes.set(
          `${projectId}:${scriptId}:${episode.id}`,
          structuredClone({ ...episode, projectId, scriptId })
        ),
      buildCharacterRegistry: async (characters) =>
        characters.map((character) => ({
          name: character.name,
          basePromptTokens: character.name,
        })),
      generateAllPrompts: async (shots) =>
        shots.map((shot) => ({ shotId: shot.id, image_prompt: shot.scene, negative_prompt: '' })),
      generateAllImages: async (prompts) =>
        prompts.map((prompt) => ({
          shotId: prompt.shotId,
          imagePath: `/tmp/${prompt.shotId}.png`,
          success: true,
        })),
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      generateAllAudio: async (shots) => {
        audioCalls += 1;
        return shots.map((shot) => ({ shotId: shot.id, audioPath: `/tmp/${shot.id}.mp3` }));
      },
      composeVideo: async (_shots, _images, _audio, outputPath) => {
        outputs.push(outputPath);
      },
    });

    const firstOutput = await director.runPipeline(scriptFilePath, { style: 'realistic' });
    const secondOutput = await director.runPipeline(scriptFilePath, { style: 'realistic' });

    assert.equal(parseCalls, 1);
    assert.equal(projects.size, 1);
    assert.equal(scripts.size, 1);
    assert.equal(episodes.size, 1);
    assert.equal(audioCalls, 1);
    assert.equal(firstOutput, secondOutput);
    assert.deepEqual(outputs, [firstOutput, secondOutput]);

    const [project] = [...projects.values()];
    const [script] = [...scripts.values()];
    const [episode] = [...episodes.values()];

    assert.equal(script.projectId, project.id);
    assert.equal(episode.projectId, project.id);
    assert.equal(episode.scriptId, script.id);
    assert.deepEqual(episode.shots, [{ id: 'shot_1', scene: '冷宫', characters: ['沈清'] }]);
  });
});

test('runPipeline compatibility mode records failure state before delegation errors escape', async () => {
  await withTempRoot(async (tempRoot) => {
    const scriptFilePath = path.join(tempRoot, 'legacy-script.txt');
    const stateByFile = new Map();
    const infoLogs = [];
    const errorLogs = [];

    fs.writeFileSync(scriptFilePath, '坏掉的旧入口剧本', 'utf-8');

    const director = createDirector({
      initDirs: (jobId) => createDirs(path.join(tempRoot, jobId)),
      loadJSON: (filePath) => stateByFile.get(filePath) ?? null,
      saveJSON: (filePath, data) => stateByFile.set(filePath, structuredClone(data)),
      readTextFile: () => '坏掉的旧入口剧本',
      parseScript: async () => {
        throw new Error('legacy bootstrap failed');
      },
      logger: {
        info: (...args) => infoLogs.push(args),
        error: (...args) => errorLogs.push(args),
      },
    });

    await assert.rejects(
      director.runPipeline(scriptFilePath, { style: 'realistic' }),
      /legacy bootstrap failed/
    );

    const stateEntry = [...stateByFile.entries()].find(([filePath]) => filePath.endsWith('state.json'));
    assert.ok(stateEntry, 'expected a compatibility state file to be written');
    assert.equal(stateEntry[1].lastError, 'legacy bootstrap failed');
    assert.match(stateEntry[1].failedAt, /\d{4}-\d{2}-\d{2}T/);
    assert.equal(
      infoLogs.some(([, message]) => String(message).includes('开始兼容任务')),
      true
    );
    assert.equal(
      errorLogs.some(([, message]) => String(message).includes('任务失败：legacy bootstrap failed')),
      true
    );
  });
});
