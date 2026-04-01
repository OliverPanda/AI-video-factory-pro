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
      delete globalThis.__parser_call_count;
    });
}

test('script parser writes source script shot table and parser metrics', async () => {
  await withTempRoot(async (tempRoot) => {
    const fakeChatJSON = async (_messages) => {
      if (!globalThis.__parser_call_count) globalThis.__parser_call_count = 0;
      globalThis.__parser_call_count += 1;
      if (globalThis.__parser_call_count === 1) {
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

    assert.equal(
      fs.existsSync(path.join(ctx.agents.scriptParser.inputsDir, 'source-script.txt')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.scriptParser.outputsDir, 'shots.flat.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.scriptParser.outputsDir, 'shots.table.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.scriptParser.metricsDir, 'parser-metrics.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.scriptParser.outputsDir, 'characters.extracted.json')),
      true
    );
    assert.equal(fs.existsSync(ctx.agents.scriptParser.manifestPath), true);
  });
});
