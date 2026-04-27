import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
import { parseScript } from '../src/agents/scriptParser.js';
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

test('script parser writes source script shot table and parser metrics', async (t) => {
  await withManagedTempRoot(t, 'aivf-script-parser-artifacts', async (tempRoot) => {
    let parserCallCount = 0;
    const fakeChatJSON = async (_messages) => {
      parserCallCount += 1;
      if (parserCallCount === 1) {
        return {
          title: '咖啡馆相遇',
          totalDuration: 6,
          characters: [{ name: '小红', gender: 'female' }],
          episodes: [{ episodeNo: 1, title: '试播集', summary: '...' }],
        };
      }
      return {
        shots: [
          { scene: '咖啡馆', characters: ['小红'], action: '整理咖啡杯', duration: 3 },
          { scene: '吧台', characters: ['小红'], action: '抬头微笑', dialogue: '你好', speaker: '小红', duration: 3 },
        ],
      };
    };

    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_parser_artifacts',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    await parseScript('原始剧本文本', {
      inputFormat: 'raw-novel',
      chatJSON: fakeChatJSON,
      artifactContext: ctx.agents.scriptParser,
    });

    const sourceScriptPath = path.join(ctx.agents.scriptParser.inputsDir, 'source-script.txt');
    const parserConfigPath = path.join(ctx.agents.scriptParser.inputsDir, 'parser-config.json');
    const shotsFlatPath = path.join(ctx.agents.scriptParser.outputsDir, 'shots.flat.json');
    const shotsTablePath = path.join(ctx.agents.scriptParser.outputsDir, 'shots.table.md');
    const metricsPath = path.join(ctx.agents.scriptParser.metricsDir, 'parser-metrics.json');
    const charactersPath = path.join(ctx.agents.scriptParser.outputsDir, 'characters.extracted.json');
    const manifestPath = ctx.agents.scriptParser.manifestPath;

    assert.equal(fs.existsSync(sourceScriptPath), true);
    assert.equal(fs.existsSync(parserConfigPath), true);
    assert.equal(fs.existsSync(shotsFlatPath), true);
    assert.equal(fs.existsSync(shotsTablePath), true);
    assert.equal(fs.existsSync(metricsPath), true);
    assert.equal(fs.existsSync(charactersPath), true);
    assert.equal(fs.existsSync(manifestPath), true);

    assert.equal(fs.readFileSync(sourceScriptPath, 'utf-8'), '原始剧本文本');

    const parserConfig = JSON.parse(fs.readFileSync(parserConfigPath, 'utf-8'));
    assert.deepEqual(parserConfig, {
      inputFormat: 'raw-novel',
      parserMode: 'llm-raw-novel',
      detectedFormat: null,
      fallbackUsed: false,
      decompositionPrompt: 'script_decomposition',
      storyboardPrompt: 'episode_storyboard',
    });

    const shotsFlat = JSON.parse(fs.readFileSync(shotsFlatPath, 'utf-8'));
    assert.equal(shotsFlat.length, 2);
    assert.equal(shotsFlat[0].id, 'shot_001');
    assert.equal(shotsFlat[0].scene, '咖啡馆');
    assert.equal(shotsFlat[1].id, 'shot_002');
    assert.equal(shotsFlat[1].dialogue, '你好');

    const shotsTable = fs.readFileSync(shotsTablePath, 'utf-8');
    assert.match(shotsTable, /\| Shot ID \| Scene \| Characters \| Action \| Dialogue \| Duration \|/);
    assert.match(shotsTable, /\| shot_001 \| 咖啡馆 \| 小红 \| 整理咖啡杯 \|  \| 3 \|/);
    assert.match(shotsTable, /\| shot_002 \| 吧台 \| 小红 \| 抬头微笑 \| 你好 \| 3 \|/);

    const parserMetrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
    assert.deepEqual(parserMetrics, {
      input_format: 'raw-novel',
      parser_mode: 'llm-raw-novel',
      episode_count: 1,
      picture_block_count: 0,
      preserved_picture_count: 0,
      sfx_count: 0,
      system_voice_count: 0,
      subtitle_count: 0,
      black_screen_count: 0,
      llm_rewrite_used: true,
      shot_count: 2,
      dialogue_shot_count: 1,
      silent_shot_count: 1,
      character_count: 1,
      total_duration_sec: 6,
      avg_shot_duration_sec: 3,
    });

    const characters = JSON.parse(fs.readFileSync(charactersPath, 'utf-8'));
    assert.deepEqual(characters, [{ name: '小红', gender: 'female' }]);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.deepEqual(manifest, {
      status: 'completed',
      outputFiles: [
        'characters.extracted.json',
        'shots.flat.json',
        'shots.table.md',
        'parser-metrics.json',
      ],
      shotCount: 2,
      characterCount: 1,
    });

    assert.equal(parserCallCount, 2);
  }, 'script-parser');
});

test('professional script parser artifacts record structure metrics', async (t) => {
  await withManagedTempRoot(t, 'aivf-professional-script-artifacts', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_professional',
      projectName: '专业剧本',
      scriptId: 'script_professional',
      scriptTitle: '专业剧本',
      episodeId: 'episode_001',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_professional_parser',
      startedAt: '2026-04-27T09:00:00.000Z',
    });

    await parseScript(
      [
        '《通用短剧》',
        '第1集《开场》',
        '【场景】 天台·夜',
        '【画面1】',
        '远景。城市灯光闪烁。',
        'SFX：风声。',
        '【画面2】',
        '黑屏。',
        '字幕浮现：第1集·开场 完。',
      ].join('\n'),
      { artifactContext: ctx.agents.scriptParser }
    );

    const parserConfig = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.scriptParser.inputsDir, 'parser-config.json'), 'utf-8')
    );
    assert.equal(parserConfig.inputFormat, 'professional-script');
    assert.equal(parserConfig.parserMode, 'deterministic-professional-script');

    const metrics = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.scriptParser.metricsDir, 'parser-metrics.json'), 'utf-8')
    );
    assert.equal(metrics.picture_block_count, 2);
    assert.equal(metrics.preserved_picture_count, 2);
    assert.equal(metrics.sfx_count, 1);
    assert.equal(metrics.subtitle_count, 1);
    assert.equal(metrics.black_screen_count, 1);
    assert.equal(metrics.llm_rewrite_used, false);

    assert.equal(
      fs.existsSync(path.join(ctx.agents.scriptParser.outputsDir, 'professional-script-structure.json')),
      true
    );
  }, 'professional-script-parser');
});

test('auto professional script parser artifact records detected format', async (t) => {
  await withManagedTempRoot(t, 'aivf-auto-professional-script-artifacts', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_auto_professional',
      projectName: '自动专业剧本',
      scriptId: 'script_auto_professional',
      scriptTitle: '自动专业剧本',
      episodeId: 'episode_001',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_auto_professional_parser',
      startedAt: '2026-04-27T10:00:00.000Z',
    });

    await parseScript(
      [
        '第1集《开场》',
        '【场景】 天台·夜',
        '【画面1】',
        '远景。城市灯光闪烁。',
      ].join('\n'),
      {
        inputFormat: 'auto',
        artifactContext: ctx.agents.scriptParser,
      }
    );

    const parserConfig = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.scriptParser.inputsDir, 'parser-config.json'), 'utf-8')
    );
    assert.equal(parserConfig.inputFormat, 'professional-script');
    assert.equal(parserConfig.detectedFormat, 'professional-script');
  }, 'auto-professional-script-parser');
});

test('auto raw novel parser artifact records detected format', async (t) => {
  await withManagedTempRoot(t, 'aivf-auto-raw-novel-artifacts', async (tempRoot) => {
    let parserCallCount = 0;
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_auto_raw',
      projectName: '自动原始小说',
      scriptId: 'script_auto_raw',
      scriptTitle: '自动原始小说',
      episodeId: 'episode_001',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_auto_raw_parser',
      startedAt: '2026-04-27T10:30:00.000Z',
    });

    await parseScript('第1集\n沈砚走进雪夜，想起旧约。', {
      inputFormat: 'auto',
      artifactContext: ctx.agents.scriptParser,
      chatJSON: async () => {
        parserCallCount += 1;
        if (parserCallCount === 1) {
          return {
            title: '雪夜旧约',
            totalDuration: 3,
            characters: [],
            episodes: [{ episodeNo: 1, title: '第一集', summary: '沈砚走进雪夜。' }],
          };
        }

        return {
          shots: [{ scene: '雪夜', characters: [], action: '沈砚走进雪夜', duration: 3 }],
        };
      },
    });

    const parserConfig = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.scriptParser.inputsDir, 'parser-config.json'), 'utf-8')
    );
    assert.equal(parserConfig.inputFormat, 'raw-novel');
    assert.equal(parserConfig.detectedFormat, 'raw-novel');
    assert.equal(parserCallCount, 2);
  }, 'auto-raw-novel-parser');
});

test('legacy runPipeline keeps parser artifacts in the final parsed-title run package', async (t) => {
  await withManagedTempRoot(t, 'aivf-script-parser-legacy-run', async (tempRoot) => {
    const legacyRoot = path.join(tempRoot, 'legacy-job');
    const scriptFilePath = path.join(tempRoot, 'filename-bootstrap.txt');
    const projects = new Map();
    const scripts = new Map();
    const episodes = new Map();
    let parserCallCount = 0;

    fs.writeFileSync(scriptFilePath, '原始剧本文本', 'utf-8');

    const director = createDirector({
      initDirs: () => createLegacyDirs(legacyRoot),
      readTextFile: () => '原始剧本文本',
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
      buildCharacterRegistry: async () => [],
      generateAllPrompts: async () => [],
      generateAllImages: async () => [],
      runConsistencyCheck: async () => ({ needsRegeneration: [] }),
      generateAllAudio: async () => [],
      composeVideo: async () => {},
    });

    await director.runPipeline(scriptFilePath, {
      startedAt: '2026-04-01T09:00:00.000Z',
      storeOptions: { baseTempDir: tempRoot },
      parseScriptDeps: {
        inputFormat: 'raw-novel',
        chatJSON: async () => {
          parserCallCount += 1;
          if (parserCallCount === 1) {
            return {
              title: '咖啡馆相遇',
              totalDuration: 6,
              characters: [{ name: '小红', gender: 'female' }],
              episodes: [{ episodeNo: 1, title: '试播集', summary: '...' }],
            };
          }

          return {
            shots: [
              { scene: '咖啡馆', characters: ['小红'], action: '整理咖啡杯', duration: 3 },
              { scene: '吧台', characters: ['小红'], action: '抬头微笑', dialogue: '你好', speaker: '小红', duration: 3 },
            ],
          };
        },
      },
    });

    const sourceScriptFiles = [];
    function collectSourceScriptFiles(rootDir) {
      for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
          collectSourceScriptFiles(fullPath);
        } else if (entry.name === 'source-script.txt') {
          sourceScriptFiles.push(fullPath);
        }
      }
    }

    collectSourceScriptFiles(tempRoot);

    assert.equal(sourceScriptFiles.length, 1);
    const sourceScriptPath = sourceScriptFiles[0];
    assert.equal(sourceScriptPath.includes('咖啡馆相遇'), true);
    assert.equal(sourceScriptPath.includes('filename-bootstrap'), false);

    const parserDir = path.dirname(path.dirname(sourceScriptPath));
    const runDir = path.dirname(parserDir);

    assert.equal(fs.existsSync(path.join(runDir, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(runDir, 'timeline.json')), true);
    assert.equal(fs.existsSync(path.join(parserDir, 'manifest.json')), true);

    const parserManifest = JSON.parse(
      fs.readFileSync(path.join(parserDir, 'manifest.json'), 'utf-8')
    );
    assert.equal(parserManifest.status, 'completed');
    assert.equal(parserManifest.shotCount, 2);
    assert.equal(parserManifest.characterCount, 1);

    assert.equal(parserCallCount, 2);
  }, 'script-parser');
});
