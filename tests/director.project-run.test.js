import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables as directorTestables, createDirector } from '../src/agents/director.js';
import { buildEpisodeDirName, buildProjectDirName } from '../src/utils/naming.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';

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

function createTestDirector(overrides = {}) {
  return createDirector({
    generateCharacterRefSheets: async () => [],
    ...overrides,
  });
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
      runLipsync: async () => ({ results: [] }),
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
      path.join(
        dirs.output,
        buildProjectDirName('宫墙疑云', 'project_1'),
        buildEpisodeDirName({ episodeNo: undefined, id: 'episode_2' }),
        'final-video.mp4'
      )
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
      runLipsync: async () => ({ results: [] }),
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

test('runEpisodePipeline loads project character bibles into character registry build context', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const buildCalls = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_character_bible_scope',
      loadJSON: () => null,
      saveJSON: () => {},
      loadProject: () => ({ id: 'project_1', name: '宫墙疑云' }),
      loadScript: () => ({
        id: 'script_1',
        title: '第一卷',
        characters: [],
        mainCharacterTemplates: [
          { id: 'tpl_hero', name: '沈清', basePromptTokens: 'young noblewoman' },
        ],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        episodeCharacters: [
          {
            id: 'ep_char_1',
            name: '沈清',
            mainCharacterTemplateId: 'tpl_hero',
            characterBibleId: 'bible_shenqing',
          },
        ],
        shots: [{ id: 'shot_ep_1', scene: '宫道', characters: ['沈清'] }],
      }),
      listCharacterBibles: () => [
        {
          id: 'bible_shenqing',
          basePromptTokens: 'young woman, pale hanfu',
          negativeDriftTokens: 'different hairstyle',
        },
      ],
      buildCharacterRegistry: async (...args) => {
        buildCalls.push(args);
        return [{ name: '沈清', basePromptTokens: 'young woman, pale hanfu' }];
      },
      generateAllPrompts: async () => [{ shotId: 'shot_ep_1', image_prompt: 'prompt', negative_prompt: '' }],
      generateAllImages: async () => [{ shotId: 'shot_ep_1', imagePath: '/tmp/shot_ep_1.png', success: true }],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      generateAllAudio: async () => [{ shotId: 'shot_ep_1', audioPath: '/tmp/shot_ep_1.mp3' }],
      runLipsync: async () => ({ results: [] }),
      composeVideo: async () => {},
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: { storeOptions: { baseTempDir: tempRoot } },
    });

    assert.equal(buildCalls.length, 1);
    assert.equal(buildCalls[0][0][0].id, 'ep_char_1');
    assert.equal(buildCalls[0][3].mainCharacterTemplates[0].id, 'tpl_hero');
    assert.equal(buildCalls[0][3].episodeCharacters[0].characterBibleId, 'bible_shenqing');
    assert.equal(buildCalls[0][3].characterBibles[0].id, 'bible_shenqing');
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
    const runJobs = [];
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
      createRunJob: (runJob) => runJobs.push(structuredClone(runJob)),
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
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
      runLipsync: async () => ({ results: [] }),
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
    assert.equal(runJobs.length, 2);
    assert.equal(runJobs[0].jobId, runJobs[1].jobId);
    assert.notEqual(runJobs[0].id, runJobs[1].id);

    const [project] = [...projects.values()];
    const [script] = [...scripts.values()];
    const [episode] = [...episodes.values()];

    assert.equal(
      firstOutput,
      path.join(
        tempRoot,
        runJobs[0].jobId,
        'output',
        buildProjectDirName('旧入口兼容', project.id),
        buildEpisodeDirName({ episodeNo: 1, id: episode.id }),
        'final-video.mp4'
      )
    );

    assert.equal(script.projectId, project.id);
    assert.equal(episode.projectId, project.id);
    assert.equal(episode.scriptId, script.id);
    assert.deepEqual(episode.shots, [{ id: 'shot_1', scene: '冷宫', characters: ['沈清'] }]);
  });
});

test('legacy runPipeline passes inputFormat to parseScript and compatibility state', async () => {
  await withTempRoot(async (tempRoot) => {
    let receivedInputFormat = null;
    const legacyRoot = path.join(tempRoot, 'legacy-job');
    const scriptFilePath = path.join(tempRoot, 'professional.txt');
    const stateByFile = new Map();
    const projects = new Map();
    const scripts = new Map();
    const episodes = new Map();

    fs.writeFileSync(scriptFilePath, '第1集《开端》\n【画面1】\n全景。', 'utf-8');

    const director = createDirector({
      initDirs: () => createDirs(legacyRoot),
      readTextFile: () => fs.readFileSync(scriptFilePath, 'utf-8'),
      loadJSON: (filePath) => stateByFile.get(filePath) ?? null,
      saveJSON: (filePath, data) => stateByFile.set(filePath, structuredClone(data)),
      parseScript: async (_scriptText, deps) => {
        receivedInputFormat = deps.inputFormat;
        return {
          title: '输入格式测试',
          totalDuration: 3,
          characters: [],
          shots: [
            {
              id: 'shot_001',
              scene: '测试',
              characters: [],
              action: '全景。',
              dialogue: '',
              speaker: '',
              duration: 3,
            },
          ],
        };
      },
      loadProject: (projectId) => projects.get(projectId) ?? null,
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
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      buildCharacterRegistry: async () => [],
      generateCharacterRefSheets: async () => [],
      generateAllPrompts: async () => [],
      generateAllImages: async () => [],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      planSceneGrammar: async () => [],
      planDirectorPacks: async () => [],
      planMotion: async () => [],
      planPerformance: async () => [],
      routeVideoShots: async () => [],
      runPreflightQa: async () => ({ reviewedPackages: [], report: { entries: [] } }),
    });

    await director.runPipeline(scriptFilePath, {
      inputFormat: 'raw-novel',
      stopBeforeVideo: true,
      storeOptions: { baseTempDir: tempRoot },
    });

    assert.equal(receivedInputFormat, 'raw-novel');
    const stateEntry = [...stateByFile.entries()].find(([filePath]) => filePath.endsWith('state.json'));
    assert.ok(stateEntry, 'expected a compatibility state file to be written');
    assert.equal(stateEntry[1].compatibility.inputFormat, 'raw-novel');
  });
});

test('runPipeline compatibility mode invalidates cached script data when file content changes', async () => {
  await withTempRoot(async (tempRoot) => {
    const scriptFilePath = path.join(tempRoot, 'legacy-script.txt');
    const stateByFile = new Map();
    const scripts = new Map();
    const episodes = new Map();
    let scriptText = '第一版';
    let parseCalls = 0;
    let audioCalls = 0;

    fs.writeFileSync(scriptFilePath, scriptText, 'utf-8');

    const director = createDirector({
      readTextFile: () => scriptText,
      initDirs: (jobId) => createDirs(path.join(tempRoot, jobId)),
      loadJSON: (filePath) => stateByFile.get(filePath) ?? null,
      saveJSON: (filePath, data) => stateByFile.set(filePath, structuredClone(data)),
      parseScript: async (rawScriptText) => {
        parseCalls += 1;
        return {
          title: rawScriptText,
          characters: [{ name: '沈清' }],
          shots: [{ id: `shot_${parseCalls}`, scene: rawScriptText, characters: ['沈清'] }],
        };
      },
      saveProject: () => {},
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
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
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
      runLipsync: async () => ({ results: [] }),
      composeVideo: async () => {},
    });

    await director.runPipeline(scriptFilePath, {});
    scriptText = '第二版';
    fs.writeFileSync(scriptFilePath, scriptText, 'utf-8');
    await director.runPipeline(scriptFilePath, {});

    assert.equal(parseCalls, 2);
    assert.equal(audioCalls, 2);

    const [savedScript] = [...scripts.values()];
    const [savedEpisode] = [...episodes.values()];
    assert.equal(savedScript.title, '第二版');
    assert.equal(savedScript.sourceText, '第二版');
    assert.deepEqual(savedEpisode.shots, [
      { id: 'shot_2', scene: '第二版', characters: ['沈清'] },
    ]);

    const stateEntry = [...stateByFile.entries()].find(([filePath]) => filePath.endsWith('state.json'));
    assert.ok(stateEntry, 'expected a compatibility state file to be written');
    assert.equal(stateEntry[1].scriptData.title, '第二版');
    assert.equal(typeof stateEntry[1].compatibility.scriptContentHash, 'string');
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

test('runEpisodePipeline applies regenerated keyframe-shaped results during consistency recovery', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const savedStates = [];
    const composeCalls = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_regen_contract',
      loadJSON: () => null,
      saveJSON: (_filePath, data) => savedStates.push(structuredClone(data)),
      loadScript: () => ({
        id: 'script_1',
        title: '重绘测试',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'] }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_1', image_prompt: 'old prompt', negative_prompt: 'none' },
      ],
      generateAllImages: async () => [
        {
          shotId: 'shot_1',
          keyframeAssetId: 'keyframe_old',
          imagePath: '/tmp/shot_1_old.png',
          success: true,
        },
      ],
      runConsistencyCheck: async () => ({
        needsRegeneration: [{ shotId: 'shot_1', suggestion: 'keep costume identical' }],
      }),
      regenerateImage: async () => ({
        shotId: 'shot_1',
        keyframeAssetId: 'keyframe_new',
        imagePath: '/tmp/shot_1_new.png',
        success: true,
      }),
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
      runLipsync: async () => ({ results: [] }),
      composeVideo: async (_shots, imageResults) => {
        composeCalls.push(structuredClone(imageResults));
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(composeCalls.length, 1);
    assert.deepEqual(composeCalls[0], [
      {
        shotId: 'shot_1',
        keyframeAssetId: 'keyframe_new',
        imagePath: '/tmp/shot_1_new.png',
        success: true,
        characters: ['沈清'],
      },
    ]);

    const finalState = savedStates.at(-1);
    assert.equal(finalState.imageResults[0].keyframeAssetId, 'keyframe_new');
    assert.equal(finalState.imageResults[0].imagePath, '/tmp/shot_1_new.png');
  });
});

test('runEpisodePipeline keeps original image when consistency regeneration fails after retries', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const composeCalls = [];
    const errorLogs = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_regen_failure_contract',
      loadJSON: () => null,
      saveJSON: () => {},
      logger: {
        info: () => {},
        error: (...args) => errorLogs.push(args),
      },
      loadScript: () => ({
        id: 'script_1',
        title: '重绘失败测试',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'] }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_1', image_prompt: 'old prompt', negative_prompt: 'none' },
      ],
      generateAllImages: async () => [
        {
          shotId: 'shot_1',
          keyframeAssetId: 'keyframe_old',
          imagePath: '/tmp/shot_1_old.png',
          success: true,
        },
      ],
      runConsistencyCheck: async () => ({
        needsRegeneration: [{ shotId: 'shot_1', suggestion: 'keep costume identical' }],
      }),
      regenerateImage: async () => ({
        shotId: 'shot_1',
        keyframeAssetId: 'keyframe_failed',
        imagePath: null,
        success: false,
        error: 'socket hang up',
      }),
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
      runLipsync: async () => ({ results: [] }),
      composeVideo: async (_shots, imageResults) => {
        composeCalls.push(structuredClone(imageResults));
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(composeCalls.length, 1);
    assert.deepEqual(composeCalls[0], [
      {
        shotId: 'shot_1',
        keyframeAssetId: 'keyframe_old',
        imagePath: '/tmp/shot_1_old.png',
        success: true,
        characters: ['沈清'],
      },
    ]);
    assert.equal(
      errorLogs.some(([, message]) => String(message).includes('一致性重生成失败，保留原图继续流程：shot_1 - socket hang up')),
      true
    );
  });
});

test('runEpisodePipeline applies continuity repair regeneration and records repair attempts', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const savedWrites = [];
    const composeCalls = [];
    const runJobRef = {
      id: 'run_job_continuity_repair_20260402120000000_deadbeef',
      jobId: 'job_continuity_repair',
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
    };

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_continuity_repair',
      loadJSON: (filePath) => {
        if (filePath.endsWith('repair-attempts.json')) {
          return [];
        }
        return null;
      },
      saveJSON: (filePath, data) => savedWrites.push([filePath, structuredClone(data)]),
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      loadProject: () => ({ id: 'project_1', name: '宫墙疑云' }),
      loadScript: () => ({
        id: 'script_1',
        title: '重绘测试',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        episodeNo: 1,
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'] }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_1', image_prompt: 'old prompt', negative_prompt: 'none' },
      ],
      generateAllImages: async () => [
        {
          shotId: 'shot_1',
          keyframeAssetId: 'keyframe_old',
          imagePath: '/tmp/shot_1_old.png',
          success: true,
        },
      ],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({
        reports: [
          {
            previousShotId: 'shot_0',
            shotId: 'shot_1',
            continuityScore: 6,
            hardViolations: [{ code: 'camera_axis_flip', severity: 'high', message: 'flip' }],
            softWarnings: [],
            repairHints: ['keep actor on left side'],
            recommendedAction: 'regenerate_prompt_and_image',
            repairMethod: 'prompt_regen',
            continuityTargets: ['camera_axis_flip'],
          },
        ],
        flaggedTransitions: [
          {
            previousShotId: 'shot_0',
            shotId: 'shot_1',
            continuityScore: 6,
            hardViolationCodes: ['camera_axis_flip'],
            violations: ['camera_axis_flip'],
            repairHints: ['keep actor on left side'],
            recommendedAction: 'regenerate_prompt_and_image',
            repairMethod: 'prompt_regen',
            continuityTargets: ['camera_axis_flip'],
          },
        ],
      }),
      regenerateImage: async (_shotId, prompt) => ({
        shotId: 'shot_1',
        keyframeAssetId: 'keyframe_new',
        imagePath: '/tmp/shot_1_new.png',
        success: true,
        prompt,
      }),
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
      runLipsync: async () => ({ results: [] }),
      composeVideo: async (_shots, imageResults) => {
        composeCalls.push(structuredClone(imageResults));
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {
        startedAt: '2026-04-02T12:00:00.000Z',
      },
    });

    assert.equal(composeCalls.length, 1);
    assert.equal(composeCalls[0][0].keyframeAssetId, 'keyframe_new');
    const stateWrites = savedWrites.filter(([filePath]) => String(filePath).endsWith('state.json'));
    const finalState = stateWrites.at(-1)?.[1];
    assert.ok(finalState, 'expected final state to be written');
    assert.equal(finalState.imageResults[0].keyframeAssetId, 'keyframe_new');
  });
});

test('runEpisodePipeline records a run job with major step task runs', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const runJobs = [];
    const taskRuns = [];
    const finishedRuns = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_observability',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '观测测试',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'] }],
      }),
      createRunJob: (runJob) => runJobs.push(structuredClone(runJob)),
      appendAgentTaskRun: (_runJobRef, taskRun) => taskRuns.push(structuredClone(taskRun)),
      finishRunJob: (_runJobRef, update) => finishedRuns.push(structuredClone(update)),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateCharacterRefSheets: async () => [{ characterId: '沈清', characterName: '沈清', imagePath: '/tmp/ref_shenqing.png', success: true }],
      generateAllPrompts: async () => [
        { shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' },
      ],
      generateAllImages: async () => [
        {
          shotId: 'shot_1',
          imagePath: '/tmp/shot_1.png',
          success: true,
        },
      ],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({ results: [] }),
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
      composeVideo: async () => {},
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: { style: 'ink' },
    });

    assert.equal(runJobs.length, 1);
    assert.match(runJobs[0].id, /^run_job_observability_\d{17}_[a-f0-9]{8}$/);
    assert.equal(runJobs[0].jobId, 'job_observability');
    assert.equal(runJobs[0].projectId, 'project_1');
    assert.equal(runJobs[0].scriptId, 'script_1');
    assert.equal(runJobs[0].episodeId, 'episode_1');
    assert.equal(runJobs[0].style, 'ink');

    assert.deepEqual(
      taskRuns.map((taskRun) => taskRun.step),
      [
        'build_character_registry',
        'generate_character_ref_sheets',
        'generate_prompts',
        'generate_images',
        'consistency_check',
        'continuity_check',
        'plan_scene_grammar',
        'plan_director_packs',
        'plan_motion',
        'plan_performance',
        'route_video_shots',
        'preflight_qa',
        'generate_video_clips',
        'enhance_video_clips',
        'shot_qa',
        'plan_bridge_shots',
        'route_bridge_shots',
        'generate_bridge_clips',
        'bridge_qa',
        'plan_action_sequences',
        'route_action_sequences',
        'generate_sequence_clips',
        'sequence_qa',
        'normalize_dialogue',
        'generate_audio',
        'tts_qa',
        'lipsync',
        'compose_video',
      ]
    );
    assert.equal(taskRuns.every((taskRun) => taskRun.status === 'completed'), true);
    assert.deepEqual(finishedRuns, [{ status: 'completed' }]);
  });
});

test('runEpisodePipeline degrades gracefully when observability writes fail', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const errorLogs = [];
    let appendCalls = 0;
    let finishCalls = 0;

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_observability_failures',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '观测降级',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'] }],
      }),
      createRunJob: () => {
        throw new Error('disk full');
      },
      appendAgentTaskRun: () => {
        appendCalls += 1;
        throw new Error('should not append after create failure');
      },
      finishRunJob: () => {
        finishCalls += 1;
        throw new Error('should not finish after create failure');
      },
      logger: {
        info: () => {},
        error: (...args) => errorLogs.push(args),
      },
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' },
      ],
      generateAllImages: async () => [
        {
          shotId: 'shot_1',
          imagePath: '/tmp/shot_1.png',
          success: true,
        },
      ],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runLipsync: async () => ({ results: [] }),
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
      composeVideo: async () => {},
    });

    const outputPath = await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(
      outputPath,
      path.join(
        dirs.output,
        buildProjectDirName('观测降级', 'project_1'),
        buildEpisodeDirName({ episodeNo: undefined, id: 'episode_1' }),
        'final-video.mp4'
      )
    );
    assert.equal(appendCalls, 0);
    assert.equal(finishCalls, 0);
    assert.equal(
      errorLogs.some(([, message]) => String(message).includes('观测写入失败，后续将跳过：createRunJob - disk full')),
      true
    );
  });
});

test('runEpisodePipeline still finalizes the run job after task-run writes start failing', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const errorLogs = [];
    const taskRuns = [];
    const finishedRuns = [];
    let appendCalls = 0;

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_observability_append_failure',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '观测尾态',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'] }],
      }),
      createRunJob: () => {},
      appendAgentTaskRun: (_runJobRef, taskRun) => {
        appendCalls += 1;
        if (appendCalls === 1) {
          throw new Error('append failed');
        }
        taskRuns.push(structuredClone(taskRun));
      },
      finishRunJob: (_runJobRef, update) => finishedRuns.push(structuredClone(update)),
      logger: {
        info: () => {},
        error: (...args) => errorLogs.push(args),
      },
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' },
      ],
      generateAllImages: async () => [
        {
          shotId: 'shot_1',
          imagePath: '/tmp/shot_1.png',
          success: true,
        },
      ],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runLipsync: async () => ({ results: [] }),
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
      composeVideo: async () => {},
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(appendCalls, 1);
    assert.deepEqual(taskRuns, []);
    assert.deepEqual(finishedRuns, [{ status: 'completed' }]);
    assert.equal(
      errorLogs.some(([, message]) => String(message).includes('观测写入失败，后续将跳过：appendAgentTaskRun:build_character_registry - append failed')),
      true
    );
  });
});

test('runEpisodePipeline records cached and skipped task states on rerun', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const taskRuns = [];
    const state = {
      characterRegistry: [{ name: '沈清', basePromptTokens: 'shen qing' }],
      promptList: [{ shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' }],
      imageResults: [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true }],
      audioResults: [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
      consistencyCheckDone: true,
    };

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_cached_observability',
      loadJSON: () => structuredClone(state),
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '缓存观测',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'] }],
      }),
      createRunJob: () => {},
      appendAgentTaskRun: (_runJobRef, taskRun) => taskRuns.push(structuredClone(taskRun)),
      finishRunJob: () => {},
      generateCharacterRefSheets: async () => [{ characterId: '沈清', characterName: '沈清', imagePath: '/tmp/ref_shenqing.png', success: true }],
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({ results: [] }),
      composeVideo: async () => {},
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: { skipConsistencyCheck: true },
    });

    assert.deepEqual(
      taskRuns.map((taskRun) => [taskRun.step, taskRun.status]),
      [
        ['build_character_registry', 'cached'],
        ['generate_character_ref_sheets', 'completed'],
        ['generate_prompts', 'cached'],
        ['generate_images', 'cached'],
        ['consistency_check', 'skipped'],
        ['continuity_check', 'skipped'],
        ['plan_scene_grammar', 'completed'],
        ['plan_director_packs', 'completed'],
        ['plan_motion', 'completed'],
        ['plan_performance', 'completed'],
        ['route_video_shots', 'completed'],
        ['preflight_qa', 'completed'],
        ['generate_video_clips', 'completed'],
        ['enhance_video_clips', 'completed'],
        ['shot_qa', 'completed'],
        ['plan_bridge_shots', 'completed'],
        ['route_bridge_shots', 'completed'],
        ['generate_bridge_clips', 'completed'],
        ['bridge_qa', 'completed'],
        ['plan_action_sequences', 'completed'],
        ['route_action_sequences', 'completed'],
        ['generate_sequence_clips', 'completed'],
        ['sequence_qa', 'completed'],
        ['normalize_dialogue', 'completed'],
        ['generate_audio', 'completed'],
        ['tts_qa', 'completed'],
        ['lipsync', 'completed'],
        ['compose_video', 'completed'],
      ]
    );
  });
});

test('runEpisodePipeline runs TTS QA after audio generation and before composition', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const callOrder = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_tts_qa_order',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '观测测试',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'], dialogue: '你来了。', duration: 3 }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' },
      ],
      generateAllImages: async () => [
        {
          shotId: 'shot_1',
          imagePath: '/tmp/shot_1.png',
          success: true,
        },
      ],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      generateAllAudio: async () => {
        callOrder.push('generate_audio');
        return [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', hasDialogue: true }];
      },
      runTtsQa: async (_shots, _audioResults, _voiceResolution, options) => {
        callOrder.push('tts_qa');
        assert.ok(options.artifactContext);
        return { status: 'pass', blockers: [], warnings: [] };
      },
      runLipsync: async (_shots, _images, _audioResults, options) => {
        callOrder.push('lipsync');
        assert.ok(options.artifactContext);
        return { results: [{ shotId: 'shot_1', videoPath: '/tmp/shot_1-lipsync.mp4' }] };
      },
      composeVideo: async () => {
        callOrder.push('compose_video');
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.deepEqual(callOrder, ['generate_audio', 'tts_qa', 'lipsync', 'compose_video']);
  });
});

test('runEpisodePipeline passes lipsync results into video composition', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const composeCalls = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_lipsync_bridge',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '口型桥接',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'], dialogue: '你来了。', camera_type: '特写', duration: 3 }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [{ shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' }],
      generateAllImages: async () => [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true }],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', hasDialogue: true }],
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({
        results: [{ shotId: 'shot_1', videoPath: '/tmp/shot_1-lipsync.mp4', status: 'completed' }],
      }),
      composeVideo: async (_shots, _images, _audio, _outputPath, options) => {
        composeCalls.push(options);
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(composeCalls.length, 1);
    assert.deepEqual(composeCalls[0].lipsyncClips, [
      { shotId: 'shot_1', videoPath: '/tmp/shot_1-lipsync.mp4', status: 'completed' },
    ]);
  });
});

test('runEpisodePipeline passes QA-approved generated video clips into video composition', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const composeCalls = [];
    const performanceCalls = [];
    const enhancerCalls = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_video_bridge',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '动态镜头桥接',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [
          { id: 'shot_1', scene: '长廊', action: '缓步逼近', dialogue: '别退。', characters: ['沈清'], duration: 4 },
          { id: 'shot_2', scene: '殿门', action: '停步', dialogue: '', characters: ['沈清'], duration: 3 },
        ],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async (shots) =>
        shots.map((shot) => ({ shotId: shot.id, image_prompt: shot.scene, negative_prompt: 'none' })),
      generateAllImages: async (prompts) =>
        prompts.map((prompt) => ({ shotId: prompt.shotId, imagePath: `/tmp/${prompt.shotId}.png`, success: true })),
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      planMotion: async (shots) =>
        shots.map((shot) => ({
          shotId: shot.id,
          shotType: 'dialogue_medium',
          durationTargetSec: shot.duration,
          cameraIntent: 'slow_dolly',
          cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
          videoGenerationMode: 'runway_image_to_video',
          visualGoal: shot.scene,
        })),
      planPerformance: async (motionPlan) => {
        performanceCalls.push(motionPlan.map((item) => item.shotId));
        return motionPlan.map((item) => ({
          shotId: item.shotId,
          performanceTemplate: item.shotId === 'shot_1' ? 'dialogue_two_shot_tension' : 'ambient_transition_motion',
          actionBeatList: [],
          cameraMovePlan: { pattern: 'push_in' },
          generationTier: item.shotId === 'shot_1' ? 'enhanced' : 'base',
          variantCount: item.shotId === 'shot_1' ? 2 : 1,
          enhancementHints: item.shotId === 'shot_1' ? ['timing_normalizer'] : [],
        }));
      },
      routeVideoShots: async (shots) =>
        shots.map((shot) => ({
          shotId: shot.id,
          shotType: 'dialogue_medium',
          durationTargetSec: shot.duration,
          visualGoal: shot.scene,
          cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
          referenceImages: [{ type: 'keyframe', path: `/tmp/${shot.id}.png` }],
          preferredProvider: 'runway',
          fallbackProviders: ['static_image'],
          audioRef: null,
          performanceTemplate: shot.id === 'shot_1' ? 'dialogue_two_shot_tension' : 'ambient_transition_motion',
          generationTier: shot.id === 'shot_1' ? 'enhanced' : 'base',
          variantCount: shot.id === 'shot_1' ? 2 : 1,
          enhancementHints: shot.id === 'shot_1' ? ['timing_normalizer'] : [],
          qaRules: { mustProbeWithFfprobe: true },
        })),
      runPreflightQa: async (shotPackages) => ({
        reviewedPackages: shotPackages,
        report: { status: 'pass', passCount: shotPackages.length, warnCount: 0, blockCount: 0, entries: [] },
      }),
      runSora2Video: async () => ({
        results: [
          { shotId: 'shot_1', provider: 'sora2', model: 'veo-3.0-fast-generate-001', status: 'completed', videoPath: '/tmp/shot_1.mp4', targetDurationSec: 4 },
          { shotId: 'shot_2', provider: 'sora2', model: 'veo-3.0-fast-generate-001', status: 'completed', videoPath: '/tmp/shot_2.mp4', targetDurationSec: 3 },
        ],
        report: { status: 'pass', warnings: [], blockers: [] },
      }),
      runMotionEnhancer: async (rawResults) => {
        enhancerCalls.push(rawResults.map((item) => item.shotId));
        return [
          {
            shotId: 'shot_1',
            sourceVideoPath: '/tmp/shot_1.mp4',
            enhancementApplied: true,
            enhancementProfile: 'timing_normalizer',
            enhancementActions: ['timing_normalizer'],
            enhancedVideoPath: '/tmp/shot_1-enhanced.mp4',
            durationAdjusted: true,
            cameraMotionInjected: false,
            interpolationApplied: false,
            stabilizationApplied: false,
            qualityDelta: 'improved',
            status: 'completed',
            error: null,
          },
          {
            shotId: 'shot_2',
            sourceVideoPath: '/tmp/shot_2.mp4',
            enhancementApplied: false,
            enhancementProfile: 'none',
            enhancementActions: [],
            enhancedVideoPath: '/tmp/shot_2.mp4',
            durationAdjusted: false,
            cameraMotionInjected: false,
            interpolationApplied: false,
            stabilizationApplied: false,
            qualityDelta: 'unchanged',
            status: 'completed',
            error: null,
          },
        ];
      },
      runShotQa: async () => ({
        status: 'warn',
        entries: [
          { shotId: 'shot_1', canUseVideo: true, fallbackToImage: false, finalDecision: 'pass_with_enhancement' },
          { shotId: 'shot_2', canUseVideo: false, fallbackToImage: true, finalDecision: 'fallback_to_image', reason: 'duration_out_of_range' },
        ],
        engineeringPassedCount: 2,
        motionPassedCount: 1,
        fallbackCount: 1,
        fallbackShots: ['shot_2'],
        warnings: ['shot_2:duration_out_of_range'],
      }),
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3' }],
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({ results: [], report: { status: 'pass', blockers: [], warnings: [] } }),
      composeVideo: async (_shots, _images, _audio, _outputPath, options) => {
        composeCalls.push(options);
      },
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(composeCalls.length, 1);
    assert.deepEqual(performanceCalls, [['shot_1', 'shot_2']]);
    assert.deepEqual(enhancerCalls, [['shot_1', 'shot_2']]);
    assert.deepEqual(composeCalls[0].videoClips, [
      {
        shotId: 'shot_1',
        videoPath: '/tmp/shot_1-enhanced.mp4',
        durationSec: 4,
        status: 'completed',
        provider: 'sora2',
      },
    ]);
  });
});

test('runEpisodePipeline can switch to seedance provider and pass provider-tagged clips into video composition', async () => {
  await withTempRoot(async (tempRoot) => {
    const previousVideoProvider = process.env.VIDEO_PROVIDER;
    process.env.VIDEO_PROVIDER = 'seedance';
    try {
      const dirs = createDirs(path.join(tempRoot, 'job'));
      const composeCalls = [];

      const director = createDirector({
        initDirs: () => dirs,
        generateJobId: () => 'job_seedance',
        loadJSON: () => null,
        saveJSON: () => {},
        loadScript: () => ({
          id: 'script_1',
          title: 'Seedance 动态镜头',
          characters: [{ name: '沈清' }],
        }),
        loadEpisode: () => ({
          id: 'episode_1',
          title: '第一集',
          shots: [{ id: 'shot_1', scene: '长廊', action: '缓步逼近', dialogue: '', characters: ['沈清'], duration: 4 }],
        }),
        buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
        generateAllPrompts: async (shots) =>
          shots.map((shot) => ({ shotId: shot.id, image_prompt: shot.scene, negative_prompt: 'none' })),
        generateAllImages: async (prompts) =>
          prompts.map((prompt) => ({ shotId: prompt.shotId, imagePath: `/tmp/${prompt.shotId}.png`, success: true })),
        runConsistencyCheck: async () => ({ needsRegeneration: [] }),
        runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
        planMotion: async (shots) =>
          shots.map((shot) => ({
            shotId: shot.id,
            shotType: 'dialogue_medium',
            durationTargetSec: shot.duration,
            cameraIntent: 'slow_dolly',
            cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
            videoGenerationMode: 'seedance_image_to_video',
            visualGoal: shot.scene,
          })),
        planPerformance: async (motionPlan) =>
          motionPlan.map((item) => ({
            shotId: item.shotId,
            performanceTemplate: 'dialogue_two_shot_tension',
            actionBeatList: [],
            cameraMovePlan: { pattern: 'push_in' },
            generationTier: 'enhanced',
            variantCount: 1,
            enhancementHints: [],
          })),
        routeVideoShots: async (shots) =>
          shots.map((shot) => ({
            shotId: shot.id,
            shotType: 'dialogue_medium',
            durationTargetSec: shot.duration,
            visualGoal: shot.scene,
            cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
            referenceImages: [{ type: 'keyframe', path: `/tmp/${shot.id}.png` }],
            preferredProvider: 'seedance',
            fallbackProviders: ['static_image'],
            providerRequestHints: { shotId: shot.id, hasReferenceImage: true },
            qaRules: { mustProbeWithFfprobe: true },
          })),
        runPreflightQa: async (shotPackages) => ({
          reviewedPackages: shotPackages,
          report: { status: 'pass', passCount: shotPackages.length, warnCount: 0, blockCount: 0, entries: [] },
        }),
        runSeedanceVideo: async () => ({
          results: [
            {
              shotId: 'shot_1',
              provider: 'seedance',
              status: 'completed',
              videoPath: '/tmp/shot_1.mp4',
              targetDurationSec: 4,
              actualDurationSec: 4,
            },
          ],
          report: { status: 'pass', warnings: [], blockers: [] },
        }),
        runMotionEnhancer: async () => [
          {
            shotId: 'shot_1',
            sourceVideoPath: '/tmp/shot_1.mp4',
            enhancementApplied: false,
            enhancementProfile: 'none',
            enhancementActions: [],
            enhancedVideoPath: '/tmp/shot_1.mp4',
            durationAdjusted: false,
            cameraMotionInjected: false,
            interpolationApplied: false,
            stabilizationApplied: false,
            qualityDelta: 'unchanged',
            status: 'completed',
            error: null,
          },
        ],
        runShotQa: async () => ({
          status: 'pass',
          entries: [{ shotId: 'shot_1', canUseVideo: true, fallbackToImage: false, finalDecision: 'pass' }],
          engineeringPassedCount: 1,
          motionPassedCount: 1,
          fallbackCount: 0,
          fallbackShots: [],
          warnings: [],
        }),
        normalizeDialogueShots: async (shots) => shots,
        generateAllAudio: async () => [],
        runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
        runLipsync: async () => ({ results: [], report: { status: 'pass', blockers: [], warnings: [] } }),
        composeVideo: async (_shots, _images, _audio, _outputPath, options) => {
          composeCalls.push(options);
        },
      });

      await director.runEpisodePipeline({
        projectId: 'project_1',
        scriptId: 'script_1',
        episodeId: 'episode_1',
        options: {},
      });

      assert.equal(composeCalls.length, 1);
      assert.deepEqual(composeCalls[0].videoClips, [
        {
          shotId: 'shot_1',
          videoPath: '/tmp/shot_1.mp4',
          durationSec: 4,
          status: 'completed',
          provider: 'seedance',
        },
      ]);
    } finally {
      if (previousVideoProvider == null) {
        delete process.env.VIDEO_PROVIDER;
      } else {
        process.env.VIDEO_PROVIDER = previousVideoProvider;
      }
    }
  });
});

test('runEpisodePipeline blocks delivery when lip-sync QA returns block', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    let composeCalled = false;

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_lipsync_block',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '口型阻断',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'], dialogue: '你来了。', camera_type: '特写', duration: 3 }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [{ shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' }],
      generateAllImages: async () => [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true }],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', hasDialogue: true }],
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({
        results: [
          {
            shotId: 'shot_1',
            status: 'failed',
            qaStatus: 'block',
            qaBlockers: ['critical_lipsync_failed'],
            manualReviewRequired: true,
          },
        ],
        report: {
          status: 'block',
          blockers: ['shot_1:critical_lipsync_failed'],
          warnings: [],
          manualReviewShots: ['shot_1'],
        },
      }),
      composeVideo: async () => {
        composeCalled = true;
      },
    });

    await assert.rejects(
      director.runEpisodePipeline({
        projectId: 'project_1',
        scriptId: 'script_1',
        episodeId: 'episode_1',
        options: {},
      }),
      /Lip-sync QA 阻断交付/
    );

    assert.equal(composeCalled, false);
  });
});

test('runEpisodePipeline writes delivery summary with lipsync review and downgrade details', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_delivery_summary',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '交付摘要',
        characters: [{ name: '沈清' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '回廊', characters: ['沈清'], dialogue: '你来了。', camera_type: '特写', duration: 3 }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [{ shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' }],
      generateAllImages: async () => [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true }],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      generateAllAudio: async () => [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', hasDialogue: true }],
      runTtsQa: async () => ({
        status: 'warn',
        blockers: [],
        warnings: ['fallback 使用率 100.0%'],
        manualReviewPlan: {
          recommendedShotIds: ['shot_1', 'shot_3'],
        },
      }),
      runLipsync: async () => ({
        results: [
          {
            shotId: 'shot_1',
            status: 'completed',
            qaStatus: 'warn',
            qaWarnings: ['manual_review_required_without_evaluator'],
            manualReviewRequired: true,
            downgradeApplied: false,
            fallbackApplied: true,
            fallbackFrom: 'funcineforge',
            provider: 'mock',
          },
          {
            shotId: 'shot_2',
            status: 'failed',
            qaStatus: 'warn',
            qaWarnings: ['lipsync_failed_downgraded_to_standard_comp'],
            manualReviewRequired: false,
            downgradeApplied: true,
            downgradeReason: 'provider_error',
          },
        ],
        report: {
          status: 'warn',
          blockers: [],
          warnings: [
            'shot_1:manual_review_required_without_evaluator',
            'shot_2:lipsync_failed_downgraded_to_standard_comp',
          ],
          entries: [
            {
              shotId: 'shot_1',
              fallbackApplied: true,
              fallbackFrom: 'funcineforge',
              provider: 'mock',
            },
            {
              shotId: 'shot_2',
              fallbackApplied: false,
              fallbackFrom: null,
              provider: null,
            },
          ],
          fallbackCount: 1,
          fallbackShots: ['shot_1'],
          manualReviewShots: ['shot_1'],
          downgradedCount: 1,
        },
      }),
      composeVideo: async () => {},
    });

    const outputPath = await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    const summaryPath = path.join(path.dirname(outputPath), 'delivery-summary.md');
    const summary = fs.readFileSync(summaryPath, 'utf-8');
    assert.match(summary, /TTS QA：warn/);
    assert.match(summary, /Lip-sync QA：warn/);
    assert.match(summary, /Preflight Pass Count：1/);
    assert.match(summary, /Preflight Warn Count：0/);
    assert.match(summary, /Preflight Block Count：0/);
    assert.match(summary, /Preflight Blocked Shots：无/);
    assert.match(summary, /人工抽查建议：shot_1, shot_3/);
    assert.match(summary, /人工复核镜头：shot_1/);
    assert.match(summary, /降级镜头数：1/);
    assert.match(summary, /Lip-sync Fallback Count：1/);
    assert.match(summary, /Lip-sync Fallback Shots：shot_1:funcineforge->mock/);
  });
});

test('runEpisodePipeline consumes structured composer result and writes compose summary fields', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_structured_compose_result',
      loadJSON: () => null,
      saveJSON: () => {},
      loadProject: () => ({ id: 'project_1', name: '结构化交付' }),
      loadScript: () => ({ id: 'script_1', title: '第一卷', characters: [{ name: '沈清' }] }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        episodeNo: 1,
        shots: [{ id: 'shot_001', scene: '宫道', dialogue: '你好', characters: ['沈清'] }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [{ shotId: 'shot_001', image_prompt: 'prompt', negative_prompt: '' }],
      generateAllImages: async () => [{ shotId: 'shot_001', imagePath: path.join(dirs.images, 'shot_001.png'), success: true }],
      runConsistencyCheck: async () => ({ reports: [], needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async () => [{ shotId: 'shot_001', audioPath: path.join(dirs.audio, 'shot_001.mp3') }],
      runTtsQa: async () => ({
        status: 'pass',
        blockers: [],
        warnings: [],
        dialogueShotCount: 1,
        budgetPassRate: 1,
        fallbackCount: 0,
        fallbackRate: 0,
        manualReviewPlan: { recommendedShotIds: [] },
      }),
      runLipsync: async () => ({
        results: [],
        report: {
          status: 'pass',
          blockers: [],
          warnings: [],
          triggeredCount: 0,
          generatedCount: 0,
          failedCount: 0,
          fallbackCount: 0,
          fallbackShots: [],
          manualReviewShots: [],
          downgradedCount: 0,
        },
      }),
      composeVideo: async () => ({
        status: 'completed_with_warnings',
        outputVideo: {
          uri: path.join(dirs.output, '结构化交付__project_1', '第01集__episode_1', 'final-video.mp4'),
          format: 'mp4',
        },
        report: {
          warnings: ['subtitle_timing_derived_from_shot_duration'],
          blockedReasons: [],
        },
        artifacts: {
          composePlanUri: '/tmp/compose-plan.json',
        },
      }),
    });

    const outputPath = await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(
      outputPath,
      path.join(dirs.output, '结构化交付__project_1', '第01集__episode_1', 'final-video.mp4')
    );
    const summaryPath = path.join(path.dirname(outputPath), 'delivery-summary.md');
    const summary = fs.readFileSync(summaryPath, 'utf-8');
    assert.match(summary, /Compose Status：completed_with_warnings/);
    assert.match(summary, /Compose Warnings：subtitle_timing_derived_from_shot_duration/);
    assert.match(summary, /Compose Plan Artifact：\/tmp\/compose-plan.json/);
  });
});

test('runEpisodePipeline writes block qa-overview when the run fails before final delivery', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_failed_overview',
      loadJSON: () => null,
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      loadProject: () => ({ id: 'project_1', name: '失败验收项目' }),
      loadScript: () => ({ id: 'script_1', title: '第一卷', characters: [{ name: '沈清' }] }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        episodeNo: 1,
        shots: [{ id: 'shot_001', scene: '宫道', dialogue: '你好', characters: ['沈清'] }],
      }),
      buildCharacterRegistry: async () => [{ name: '沈清', basePromptTokens: 'shen qing' }],
      generateAllPrompts: async () => [{ shotId: 'shot_001', image_prompt: 'prompt', negative_prompt: '' }],
      generateAllImages: async () => [{ shotId: 'shot_001', imagePath: path.join(dirs.images, 'shot_001.png'), success: true }],
      runConsistencyCheck: async () => ({ reports: [], needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async () => [{ shotId: 'shot_001', audioPath: path.join(dirs.audio, 'shot_001.mp3') }],
      runTtsQa: async () => ({
        status: 'pass',
        blockers: [],
        warnings: [],
        dialogueShotCount: 1,
        budgetPassRate: 1,
        fallbackCount: 0,
        fallbackRate: 0,
      }),
      runLipsync: async () => ({
        results: [],
        report: {
          status: 'pass',
          blockers: [],
          warnings: [],
          triggeredCount: 0,
          generatedCount: 0,
          failedCount: 0,
          fallbackCount: 0,
          manualReviewCount: 0,
        },
      }),
      composeVideo: async () => {
        throw new Error('ffmpeg failed');
      },
    });

    await assert.rejects(
      director.runEpisodePipeline({
        projectId: 'project_1',
        scriptId: 'script_1',
        episodeId: 'episode_1',
        options: {
          storeOptions: { baseTempDir: tempRoot },
          startedAt: '2026-04-03T12:00:00.000Z',
          runAttemptId: 'run_failed_overview',
        },
      }),
      /ffmpeg failed/
    );

    const runDir = path.join(
      tempRoot,
      'projects',
      '失败验收项目__project_1',
      'scripts',
      '第一卷__script_1',
      'episodes',
      '第01集__episode_1',
      'runs',
      '2026-04-03_120000__run_failed_overview'
    );
    const qaOverview = JSON.parse(fs.readFileSync(path.join(runDir, 'qa-overview.json'), 'utf-8'));
    assert.equal(qaOverview.status, 'block');
    assert.equal(qaOverview.releasable, false);
    assert.match(qaOverview.headline, /阻断状态/);
    assert.match(qaOverview.summary, /生成前质检结果：pass 1，warn 0，block 0/);
  });
});

test('runEpisodePipeline includes preflight blocked shots in delivery summary and qa overview', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const runAttemptId = 'run_job_preflight_visibility_20260414100000000_deadbeef';
    const startedAt = '2026-04-14T10:00:00.000Z';

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_preflight_visibility',
      loadJSON: () => null,
      saveJSON: () => {},
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      loadProject: () => ({ id: 'project_1', name: '预检可见性' }),
      loadScript: () => ({
        id: 'script_1',
        title: '预检可见性',
        characters: [{ name: '林岚' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        episodeNo: 1,
        shots: [{ id: 'shot_1', scene: '未知空间', action: '快速移动', characters: ['林岚'], duration: 4 }],
      }),
      buildCharacterRegistry: async () => [{ name: '林岚', basePromptTokens: 'lin lan' }],
      generateAllPrompts: async () => [{ shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' }],
      generateAllImages: async () => [{ shotId: 'shot_1', imagePath: null, success: false }],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      planMotion: async () => [{
        shotId: 'shot_1',
        shotType: 'dialogue_medium',
        durationTargetSec: 4,
        cameraIntent: 'whip_pan',
        cameraSpec: { moveType: 'whip_pan', framing: 'wide', ratio: '9:16' },
        videoGenerationMode: 'seedance_image_to_video',
        visualGoal: '快速移动',
      }],
      planPerformance: async () => [{
        shotId: 'shot_1',
        performanceTemplate: 'dialogue_two_shot_tension',
        actionBeatList: [],
        cameraMovePlan: { pattern: 'push_in' },
        generationTier: 'enhanced',
        variantCount: 1,
        enhancementHints: [],
      }],
      routeVideoShots: async () => [{
        shotId: 'shot_1',
        preferredProvider: 'seedance',
        fallbackProviders: ['static_image'],
        referenceImages: [],
        durationTargetSec: 4,
        generationPack: { reference_stack: [] },
        seedancePromptBlocks: [],
        qualityIssues: ['missing_scene_pack', 'missing_reference_stack', 'entry_state_missing', 'exit_state_missing'],
        providerRequestHints: {},
      }],
      runMotionEnhancer: async () => [],
      runShotQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async () => [],
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({ results: [], report: { status: 'pass', blockers: [], warnings: [] } }),
      composeVideo: async () => ({
        status: 'completed',
        outputVideo: {
          uri: path.join(dirs.output, '预检可见性__project_1', '第01集__episode_1', 'final-video.mp4'),
          format: 'mp4',
        },
        report: { warnings: [], blockedReasons: [] },
      }),
    });

    const outputPath = await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {
        runAttemptId,
        startedAt,
        storeOptions: {
          baseTempDir: tempRoot,
        },
      },
    });

    const summaryPath = path.join(path.dirname(outputPath), 'delivery-summary.md');
    const summary = fs.readFileSync(summaryPath, 'utf-8');
    assert.match(summary, /Preflight Block Count：1/);
    assert.match(summary, /Preflight Blocked Shots：shot_1/);
    assert.match(summary, /Preflight Fix Brief Count：1/);
    assert.match(summary, /Preflight Fix Brief Artifact：runs\/2026-04-14_100000__run_job_preflight_visibility_20260414100000000_deadbeef\/09bc-preflight-qa-agent\/1-outputs\/preflight-fix-brief.md/);
    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '预检可见性',
      scriptId: 'script_1',
      scriptTitle: '预检可见性',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: runAttemptId,
      startedAt,
    });
    const qaOverview = JSON.parse(fs.readFileSync(artifactContext.qaOverviewJsonPath, 'utf-8'));
    assert.match(qaOverview.summary, /生成前质检结果：pass 0，warn 0，block 1/);
    assert.equal(
      qaOverview.topIssues.some((item) => /Preflight QA Agent: shot_1 block - 场景目标缺失，建议：先把这个分镜要讲清楚的戏剧动作写明/.test(item)),
      true
    );
    assert.equal(
      qaOverview.topIssues.some((item) => /Preflight Fix Brief: shot_1 应优先回修，先处理场景目标缺失/.test(item)),
      true
    );
    const fixBrief = JSON.parse(
      fs.readFileSync(path.join(artifactContext.agents.preflightQaAgent.outputsDir, 'preflight-fix-brief.json'), 'utf-8')
    );
    assert.equal(fixBrief.entries[0].priority, 'P0');
    assert.equal(fixBrief.entries[0].ownerSummary, 'Scene Grammar Agent, Seedance Prompt Agent, Director Pack Agent');
    const reviewedPackages = JSON.parse(
      fs.readFileSync(path.join(artifactContext.agents.preflightQaAgent.outputsDir, 'preflight-reviewed-packages.json'), 'utf-8')
    );
    assert.equal(reviewedPackages[0].preflightDecision, 'block');
  });
});

test('runEpisodePipeline surfaces seedance director inference counts in delivery summary and qa overview', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const runAttemptId = 'run_job_seedance_inference_20260414102000000_deadbeef';
    const startedAt = '2026-04-14T10:20:00.000Z';

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_seedance_inference',
      loadJSON: () => null,
      saveJSON: () => {},
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      loadProject: () => ({ id: 'project_1', name: '推断可见性' }),
      loadScript: () => ({
        id: 'script_1',
        title: '推断可见性',
        characters: [{ name: '林岚' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        episodeNo: 1,
        shots: [{ id: 'shot_1', scene: '走廊', action: '角色短暂停步', characters: ['林岚'], duration: 4 }],
      }),
      buildCharacterRegistry: async () => [{ name: '林岚', basePromptTokens: 'lin lan' }],
      generateAllPrompts: async () => [{ shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' }],
      generateAllImages: async () => [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true }],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      planSceneGrammar: async () => [{
        scene_id: 'scene_1',
        scene_goal: '交代角色犹豫。',
        dramatic_question: '她是否迈出下一步？',
        start_state: '角色停在走廊口',
        end_state: '角色仍未行动',
        location_anchor: '走廊',
        cast: ['林岚'],
        delivery_priority: 'narrative_clarity',
        forbidden_choices: [],
        action_beats: [{ beat_id: 'beat_01', shot_ids: ['shot_1'], summary: '角色短暂停步' }],
      }],
      planDirectorPacks: async () => [{
        scene_id: 'scene_1',
        cinematic_intent: '保持克制。',
        shot_order_plan: [{ beat_id: 'beat_01', coverage: '', emphasis: 'hesitation' }],
        blocking_map: [{ beat_id: 'beat_01', subject_positions: [], movement_note: 'hold' }],
        continuity_locks: [],
      }],
      planMotion: async () => [{
        shotId: 'shot_1',
        shotType: 'dialogue_medium',
        durationTargetSec: 4,
        cameraIntent: 'slow_dolly',
        cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
        videoGenerationMode: 'seedance_image_to_video',
        visualGoal: '角色短暂停步',
      }],
      planPerformance: async () => [{
        shotId: 'shot_1',
        performanceTemplate: 'dialogue_two_shot_tension',
        actionBeatList: [],
        cameraMovePlan: { pattern: 'push_in' },
        generationTier: 'enhanced',
        variantCount: 1,
        enhancementHints: [],
      }],
      runMotionEnhancer: async () => [],
      runShotQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async () => [],
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({ results: [], report: { status: 'pass', blockers: [], warnings: [] } }),
      composeVideo: async () => ({
        status: 'completed',
        outputVideo: {
          uri: path.join(dirs.output, '推断可见性__project_1', '第01集__episode_1', 'final-video.mp4'),
          format: 'mp4',
        },
        report: { warnings: [], blockedReasons: [] },
      }),
    });

    const outputPath = await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {
        runAttemptId,
        startedAt,
        storeOptions: {
          baseTempDir: tempRoot,
        },
      },
    });

    const summary = fs.readFileSync(path.join(path.dirname(outputPath), 'delivery-summary.md'), 'utf-8');
    assert.match(summary, /Seedance Inferred Coverage Count：1/);
    assert.match(summary, /Seedance Inferred Blocking Count：1/);
    assert.match(summary, /Seedance Inferred Continuity Count：1/);
    assert.match(summary, /Seedance Inferred Shot Count：1/);
    assert.match(summary, /Seedance Inference Risk：warn/);

    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '推断可见性',
      scriptId: 'script_1',
      scriptTitle: '推断可见性',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: runAttemptId,
      startedAt,
    });
    const qaOverview = JSON.parse(fs.readFileSync(artifactContext.qaOverviewJsonPath, 'utf-8'));
    assert.equal(qaOverview.status, 'warn');
    assert.match(qaOverview.headline, /Seedance 输入补全占比过高/);
    assert.match(qaOverview.summary, /Seedance 输入补全：coverage 1，blocking 1，continuity 1/);
    assert.equal(
      qaOverview.topIssues.some((item) => /Seedance Prompt Agent: 有 1 个镜头的 coverage 依赖系统兜底推断/.test(item)),
      true
    );
  });
});

test('runEpisodePipeline blocks formal delivery when seedance inference risk stays high across multiple shots', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const runAttemptId = 'run_job_seedance_inference_gate_20260414103000000_deadbeef';
    const startedAt = '2026-04-14T10:30:00.000Z';
    const savedStates = [];
    let composeCalled = false;

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_seedance_inference_gate',
      loadJSON: () => null,
      saveJSON: (_filePath, data) => savedStates.push(structuredClone(data)),
      createRunJob: () => {},
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      loadProject: () => ({ id: 'project_1', name: '推断门禁' }),
      loadScript: () => ({
        id: 'script_1',
        title: '推断门禁',
        characters: [{ name: '林岚' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        episodeNo: 1,
        shots: [
          { id: 'shot_1', scene: '走廊', action: '角色短暂停步', characters: ['林岚'], duration: 4 },
          { id: 'shot_2', scene: '走廊', action: '角色继续犹豫', characters: ['林岚'], duration: 4 },
        ],
      }),
      buildCharacterRegistry: async () => [{ name: '林岚', basePromptTokens: 'lin lan' }],
      generateAllPrompts: async () => [
        { shotId: 'shot_1', image_prompt: 'prompt 1', negative_prompt: 'none' },
        { shotId: 'shot_2', image_prompt: 'prompt 2', negative_prompt: 'none' },
      ],
      generateAllImages: async () => [
        { shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true },
        { shotId: 'shot_2', imagePath: '/tmp/shot_2.png', success: true },
      ],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      planSceneGrammar: async () => [{
        scene_id: 'scene_1',
        scene_goal: '交代角色持续犹豫。',
        dramatic_question: '她是否迈出下一步？',
        start_state: '角色停在走廊口',
        end_state: '角色仍未行动',
        location_anchor: '走廊',
        cast: ['林岚'],
        delivery_priority: 'narrative_clarity',
        forbidden_choices: [],
        action_beats: [
          { beat_id: 'beat_01', shot_ids: ['shot_1'], summary: '角色短暂停步' },
          { beat_id: 'beat_02', shot_ids: ['shot_2'], summary: '角色继续犹豫' },
        ],
      }],
      planDirectorPacks: async () => [{
        scene_id: 'scene_1',
        cinematic_intent: '保持克制。',
        shot_order_plan: [
          { beat_id: 'beat_01', coverage: '', emphasis: 'hesitation' },
          { beat_id: 'beat_02', coverage: '', emphasis: 'hesitation' },
        ],
        blocking_map: [
          { beat_id: 'beat_01', subject_positions: [], movement_note: 'hold' },
          { beat_id: 'beat_02', subject_positions: [], movement_note: 'hold' },
        ],
        continuity_locks: [],
      }],
      planMotion: async () => [
        {
          shotId: 'shot_1',
          shotType: 'dialogue_medium',
          durationTargetSec: 4,
          cameraIntent: 'slow_dolly',
          cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
          videoGenerationMode: 'seedance_image_to_video',
          visualGoal: '角色短暂停步',
        },
        {
          shotId: 'shot_2',
          shotType: 'dialogue_medium',
          durationTargetSec: 4,
          cameraIntent: 'slow_dolly',
          cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
          videoGenerationMode: 'seedance_image_to_video',
          visualGoal: '角色继续犹豫',
        },
      ],
      planPerformance: async () => [
        {
          shotId: 'shot_1',
          performanceTemplate: 'dialogue_two_shot_tension',
          actionBeatList: [],
          cameraMovePlan: { pattern: 'push_in' },
          generationTier: 'enhanced',
          variantCount: 1,
          enhancementHints: [],
        },
        {
          shotId: 'shot_2',
          performanceTemplate: 'dialogue_two_shot_tension',
          actionBeatList: [],
          cameraMovePlan: { pattern: 'push_in' },
          generationTier: 'enhanced',
          variantCount: 1,
          enhancementHints: [],
        },
      ],
      runMotionEnhancer: async () => [],
      runShotQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async () => [],
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({ results: [], report: { status: 'pass', blockers: [], warnings: [] } }),
      composeVideo: async () => {
        composeCalled = true;
        return {
          status: 'completed',
          outputVideo: {
            uri: path.join(dirs.output, '推断门禁__project_1', '第01集__episode_1', 'final-video.mp4'),
            format: 'mp4',
          },
          report: { warnings: [], blockedReasons: [] },
        };
      },
    });

    await assert.rejects(
      director.runEpisodePipeline({
        projectId: 'project_1',
        scriptId: 'script_1',
        episodeId: 'episode_1',
        options: {
          runAttemptId,
          startedAt,
          storeOptions: {
            baseTempDir: tempRoot,
          },
        },
      }),
      /Seedance 输入补全占比过高，阻止正式交付/
    );

    assert.equal(composeCalled, true);
    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '推断门禁',
      scriptId: 'script_1',
      scriptTitle: '推断门禁',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: runAttemptId,
      startedAt,
    });
    const qaOverview = JSON.parse(fs.readFileSync(artifactContext.qaOverviewJsonPath, 'utf-8'));
    assert.equal(qaOverview.releasable, false);
    assert.equal(qaOverview.status, 'block');
    assert.match(qaOverview.summary, /Seedance 输入补全：coverage 2，blocking 2，continuity 2/);
    const state = savedStates.at(-1);
    assert.ok(state, 'expected state to be captured before formal delivery was blocked');
    const summary = fs.readFileSync(state.deliverySummaryPath, 'utf-8');
    assert.match(summary, /Seedance Inference Delivery Gate：block_formal_delivery/);
    assert.match(state.previewOutputPath, /final-video\.mp4$/);
  });
});

test('runEpisodePipeline passes scenePacks and directorPacks into routeVideoShots', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const routeCalls = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_route_director_layers',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '导演层传递',
        characters: [{ name: '林岚' }, { name: '阿哲' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [
          { id: 'shot_1', scene: '仓库主通道', action: '林岚举枪逼近阿哲', dialogue: '把箱子放下。', characters: ['林岚', '阿哲'], duration: 4 },
        ],
      }),
      buildCharacterRegistry: async () => [{ name: '林岚', basePromptTokens: 'lin lan' }, { name: '阿哲', basePromptTokens: 'a zhe' }],
      generateAllPrompts: async (shots) =>
        shots.map((shot) => ({ shotId: shot.id, image_prompt: shot.scene, negative_prompt: 'none' })),
      generateAllImages: async (prompts) =>
        prompts.map((prompt) => ({ shotId: prompt.shotId, imagePath: `/tmp/${prompt.shotId}.png`, success: true })),
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      planMotion: async (shots) =>
        shots.map((shot) => ({
          shotId: shot.id,
          shotType: 'dialogue_medium',
          durationTargetSec: shot.duration,
          cameraIntent: 'slow_dolly',
          cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
          videoGenerationMode: 'seedance_image_to_video',
          visualGoal: shot.scene,
        })),
      planPerformance: async (motionPlan) =>
        motionPlan.map((item) => ({
          shotId: item.shotId,
          performanceTemplate: 'dialogue_two_shot_tension',
          actionBeatList: [],
          cameraMovePlan: { pattern: 'push_in' },
          generationTier: 'enhanced',
          variantCount: 1,
          enhancementHints: [],
        })),
      routeVideoShots: async (shots, motionPlan, imageResults, options) => {
        routeCalls.push({
          scenePacks: options.scenePacks,
          directorPacks: options.directorPacks,
          shotIds: shots.map((shot) => shot.id),
        });
        return shots.map((shot) => ({
          shotId: shot.id,
          preferredProvider: 'static_image',
          fallbackProviders: [],
          referenceImages: [],
          providerRequestHints: { shotId: shot.id, hasReferenceImage: false },
          durationTargetSec: 4,
          generationPack: {
            scene_id: options.scenePacks[0].scene_id,
            shot_id: shot.id,
          },
          seedancePromptBlocks: [
            { key: 'cinematic_intent', text: options.directorPacks[0].cinematic_intent },
          ],
        }));
      },
      runSeedanceVideo: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
      runSora2Video: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
      runMotionEnhancer: async () => [],
      runShotQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async () => [],
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({ results: [], report: { status: 'pass', blockers: [], warnings: [] } }),
      planBridgeShots: async () => [],
      routeBridgeShots: async () => [],
      generateBridgeClips: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
      runBridgeQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
      planActionSequences: async () => [],
      routeActionSequencePackages: async () => [],
      generateSequenceClips: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
      runSequenceQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
      composeVideo: async () => {},
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(routeCalls.length, 1);
    assert.equal(Array.isArray(routeCalls[0].scenePacks), true);
    assert.equal(Array.isArray(routeCalls[0].directorPacks), true);
    assert.equal(routeCalls[0].scenePacks[0].scene_goal.includes('掌控局面'), true);
    assert.equal(routeCalls[0].directorPacks[0].cinematic_intent.includes('写实'), true);
  });
});

test('runEpisodePipeline blocks weak dynamic shots before provider generation and routes them to static fallback', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    let seedanceCalls = 0;

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_preflight_block',
      loadJSON: () => null,
      saveJSON: () => {},
      loadScript: () => ({
        id: 'script_1',
        title: '生成前门禁',
        characters: [{ name: '林岚' }],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        shots: [{ id: 'shot_1', scene: '未知空间', action: '快速移动', characters: ['林岚'], duration: 4 }],
      }),
      buildCharacterRegistry: async () => [{ name: '林岚', basePromptTokens: 'lin lan' }],
      generateAllPrompts: async () => [{ shotId: 'shot_1', image_prompt: 'prompt', negative_prompt: 'none' }],
      generateAllImages: async () => [{ shotId: 'shot_1', imagePath: null, success: false }],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      runContinuityCheck: async () => ({ reports: [], flaggedTransitions: [] }),
      planMotion: async () => [{
        shotId: 'shot_1',
        shotType: 'dialogue_medium',
        durationTargetSec: 4,
        cameraIntent: 'whip_pan',
        cameraSpec: { moveType: 'whip_pan', framing: 'wide', ratio: '9:16' },
        videoGenerationMode: 'seedance_image_to_video',
        visualGoal: '快速移动',
      }],
      planPerformance: async () => [{
        shotId: 'shot_1',
        performanceTemplate: 'dialogue_two_shot_tension',
        actionBeatList: [],
        cameraMovePlan: { pattern: 'push_in' },
        generationTier: 'enhanced',
        variantCount: 1,
        enhancementHints: [],
      }],
      routeVideoShots: async () => [{
        shotId: 'shot_1',
        preferredProvider: 'seedance',
        fallbackProviders: ['static_image'],
        referenceImages: [],
        durationTargetSec: 4,
        generationPack: {
          reference_stack: [],
        },
        seedancePromptBlocks: [],
        qualityIssues: ['missing_scene_pack', 'missing_reference_stack', 'entry_state_missing', 'exit_state_missing'],
        providerRequestHints: {},
      }],
      runSeedanceVideo: async (shotPackages) => {
        seedanceCalls += 1;
        assert.equal(shotPackages[0].preferredProvider, 'static_image');
        return { results: [], report: { status: 'pass', warnings: [], blockers: [] } };
      },
      runSora2Video: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
      runMotionEnhancer: async () => [],
      runShotQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
      normalizeDialogueShots: async (shots) => shots,
      generateAllAudio: async () => [],
      runTtsQa: async () => ({ status: 'pass', blockers: [], warnings: [] }),
      runLipsync: async () => ({ results: [], report: { status: 'pass', blockers: [], warnings: [] } }),
      planBridgeShots: async () => [],
      routeBridgeShots: async () => [],
      generateBridgeClips: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
      runBridgeQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
      planActionSequences: async () => [],
      routeActionSequencePackages: async () => [],
      generateSequenceClips: async () => ({ results: [], report: { status: 'pass', warnings: [], blockers: [] } }),
      runSequenceQa: async () => ({ status: 'pass', entries: [], warnings: [], blockers: [] }),
      composeVideo: async () => {},
    });

    await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {},
    });

    assert.equal(seedanceCalls, 0);
  });
});

test('buildBridgeClipBridge drops continuity clips when QA report is missing', () => {
  const bridgeClips = directorTestables.buildBridgeClipBridge(
    [{ bridgeId: 'bridge_001', fromShotId: 'shot_001', toShotId: 'shot_002' }],
    [{ bridgeId: 'bridge_001', status: 'completed', videoPath: '/tmp/bridge.mp4', actualDurationSec: 1.8 }],
    null
  );

  assert.deepEqual(bridgeClips, []);
});

test('assertContinuityDeliveryGate blocks delivery when sequence clips exist without approved QA', () => {
  assert.throws(
    () =>
      directorTestables.assertContinuityDeliveryGate({
        actionSequencePlan: [{ sequenceId: 'sequence_001', shotIds: ['shot_001', 'shot_002'] }],
        sequenceClipResults: [{ sequenceId: 'sequence_001', status: 'completed', videoPath: '/tmp/sequence.mp4' }],
        sequenceQaReport: null,
      }),
    /Continuity delivery gate blocked/
  );
});
