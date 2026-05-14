import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';

import { createWorkbenchServer } from '../../src/workbench/http/router.js';

test('GET /api/workbench returns 200 and json', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/workbench`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();

  assert.equal(body.statusCode, 200);
  assert.equal(JSON.parse(body.text).summary.runCount, 2);
});

test('GET /api/projects returns project summaries', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/projects`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();

  const payload = JSON.parse(body.text);
  assert.equal(body.statusCode, 200);
  assert.equal(payload.length, 2);
  assert.equal(payload[0].id, 'project_x');
});

test('GET /api/runs/:runId/qa returns QA payload', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/runs/run_fixture_recent/qa`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();

  const payload = JSON.parse(body.text);
  assert.equal(body.statusCode, 200);
  assert.equal(payload.status, 'warn');
  assert.equal(payload.agentSummaries.length, 1);
});

test('GET /api/runs/:runId/artifacts returns artifact summary', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/runs/run_fixture_recent/artifacts`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();

  const payload = JSON.parse(body.text);
  assert.equal(body.statusCode, 200);
  assert.ok(Array.isArray(payload.agentDirs));
});

test('GET /api/settings/providers returns readonly settings payload', async () => {
  const server = createWorkbenchServer({
    workspaceRoot: process.cwd(),
    tempProjectsDir: path.resolve('tests/fixtures/workbench/minimal-run-jobs'),
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/api/settings/providers`, (response) => {
        let text = '';
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ statusCode: response.statusCode, text });
        });
      })
      .on('error', reject);
  });

  server.close();

  const payload = JSON.parse(body.text);
  assert.equal(body.statusCode, 200);
  assert.equal(payload.mode, 'readonly-workbench');
});
