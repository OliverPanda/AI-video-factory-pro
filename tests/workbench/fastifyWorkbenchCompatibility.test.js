import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createWorkbenchServer as createFastifyWorkbenchServer } from '../../src/app/workbench/server.js';

async function requestRaw(port, pathname, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.stringify(options.body) : null;

  return await new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${pathname}`,
      {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(options.headers || {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            text: buffer.toString('utf8'),
            buffer,
          });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function requestJson(port, pathname, options = {}) {
  const response = await requestRaw(port, pathname, options);
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    payload: JSON.parse(response.text || '{}'),
  };
}

async function collectSseEvents(port, pathname) {
  return await new Promise((resolve, reject) => {
    const events = [];
    let settled = false;
    let buffer = '';
    const req = http.request(`http://127.0.0.1:${port}${pathname}`, { method: 'GET' }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += String(chunk);
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks.filter(Boolean)) {
          const lines = block.split('\n');
          const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
          const dataLine = lines.find((line) => line.startsWith('data:'));
          let data = null;
          if (dataLine) {
            data = JSON.parse(dataLine.slice(5).trim());
          }
          events.push({ event, data });
          if (event === 'done' && !settled) {
            settled = true;
            req.destroy();
            resolve(events);
          }
        }
      });
      res.on('end', () => {
        if (!settled) {
          settled = true;
          resolve(events);
        }
      });
    });
    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    req.end();
  });
}

async function withServer(server, fn) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    await server.close();
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

test('Fastify compatibility serves /api/workbench', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-fastify-workbench-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  fs.mkdirSync(tempProjectsDir, { recursive: true });

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await withServer(server, async (port) => {
    const response = await requestJson(port, '/api/workbench');
    assert.equal(response.statusCode, 200);
    assert.equal(typeof response.payload.summary?.runCount, 'number');
  });
});

test('Fastify compatibility preserves professionalize endpoint behavior', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-fastify-professionalize-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  fs.mkdirSync(tempProjectsDir, { recursive: true });

  const server = createFastifyWorkbenchServer({
    workspaceRoot,
    tempProjectsDir,
    scriptProfessionalizeChat: async () =>
      [
        '【画面1】',
        '场景：智能公寓客厅，夜晚。',
        '人物：周凛。',
        '动作：周凛按下平板上的灯光按钮，吊灯闪烁后熄灭。',
        '对白：周凛（压低声音）：这套系统到底还能不能用？',
        '时长：6秒',
      ].join('\n'),
  });

  await withServer(server, async (port) => {
    const response = await requestJson(port, '/api/scripts/professionalize', {
      method: 'POST',
      body: {
        title: '精英的困境',
        content: '周凛家里的智能系统坏了，他很生气。',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.payload.content, /【画面1】/);
    assert.equal(response.payload.source, 'llm');
  });
});

test('Fastify compatibility enforces Bearer token on protected writes', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-fastify-token-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  fs.mkdirSync(tempProjectsDir, { recursive: true });
  const previousToken = process.env.WORKBENCH_TOKEN;
  process.env.WORKBENCH_TOKEN = 'fastify-secret-token';

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });

  try {
    await withServer(server, async (port) => {
      const unauthorized = await requestJson(port, '/api/settings/providers', {
        method: 'PUT',
        body: { sections: [] },
      });
      assert.equal(unauthorized.statusCode, 401);

      const authorized = await requestJson(port, '/api/settings/providers', {
        method: 'PUT',
        headers: { authorization: 'Bearer fastify-secret-token' },
        body: { sections: [] },
      });
      assert.equal(authorized.statusCode, 200);
    });
  } finally {
    if (previousToken === undefined) {
      delete process.env.WORKBENCH_TOKEN;
    } else {
      process.env.WORKBENCH_TOKEN = previousToken;
    }
  }
});

test('Fastify compatibility preserves SSE streaming for /api/runs/:id/stream', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-fastify-sse-small-'));
  const tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects');
  const episodeDir = path.join(
    tempProjectsDir,
    'project_stream',
    'scripts',
    'script_stream',
    'episodes',
    'episode_stream'
  );
  writeJson(path.join(episodeDir, 'run-jobs', 'run_stream.json'), {
    id: 'run_stream',
    projectId: 'project_stream',
    scriptId: 'script_stream',
    episodeId: 'episode_stream',
    status: 'completed',
    startedAt: '2026-06-26T00:00:00.000Z',
    finishedAt: '2026-06-26T00:01:00.000Z',
    agentTaskRuns: [{ id: 'task_1', step: 'compose_video', status: 'completed' }],
  });

  const server = createFastifyWorkbenchServer({ workspaceRoot, tempProjectsDir });
  await withServer(server, async (port) => {
    const events = await collectSseEvents(port, '/api/runs/run_stream/stream');
    assert.equal(events[0]?.event, 'status');
    assert.equal(events[0]?.data?.id, 'run_stream');
    assert.equal(events.at(-1)?.event, 'done');
    assert.equal(events.at(-1)?.data?.status, 'completed');
  });
});
