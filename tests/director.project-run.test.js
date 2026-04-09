import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
import { buildEpisodeDirName, buildProjectDirName } from '../src/utils/naming.js';

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
        'generate_prompts',
        'generate_images',
        'consistency_check',
        'continuity_check',
        'plan_motion',
        'plan_performance',
        'route_video_shots',
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
        ['generate_prompts', 'cached'],
        ['generate_images', 'cached'],
        ['consistency_check', 'skipped'],
        ['continuity_check', 'skipped'],
        ['plan_motion', 'completed'],
        ['plan_performance', 'completed'],
        ['route_video_shots', 'completed'],
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
  });
});
