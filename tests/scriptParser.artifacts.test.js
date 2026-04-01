import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseScript } from '../src/agents/scriptParser.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-script-parser-artifacts-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('script parser writes source script shot table and parser metrics', async () => {
  await withTempRoot(async (tempRoot) => {
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
      mode: 'legacy-flat-parse',
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
  });
});
