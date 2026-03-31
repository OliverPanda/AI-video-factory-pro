import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getEpisodeFilePath,
  getProjectFilePath,
  getScriptFilePath,
} from '../src/utils/fileHelper.js';
import {
  loadEpisode,
  loadProject,
  loadScript,
  saveEpisode,
  saveProject,
  saveScript,
} from '../src/utils/projectStore.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-project-store-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('saveProject and loadProject round-trip project JSON in the project tree', async () => {
  await withTempRoot(async (tempRoot) => {
    const project = {
      id: 'project_123',
      name: '宫廷短剧',
      code: 'gongting',
      status: 'draft',
    };

    saveProject(project, { baseTempDir: tempRoot });

    const filePath = getProjectFilePath(project.id, tempRoot);
    assert.equal(fs.existsSync(filePath), true);
    assert.deepEqual(loadProject(project.id, { baseTempDir: tempRoot }), project);
  });
});

test('saveScript and loadScript persist nested script JSON', async () => {
  await withTempRoot(async (tempRoot) => {
    const projectId = 'project_123';
    const script = {
      id: 'script_456',
      projectId,
      title: '第一卷',
      sourceText: '原始剧本',
    };

    saveScript(projectId, script, { baseTempDir: tempRoot });

    const filePath = getScriptFilePath(projectId, script.id, tempRoot);
    assert.equal(fs.existsSync(filePath), true);
    assert.deepEqual(loadScript(projectId, script.id, { baseTempDir: tempRoot }), script);
  });
});

test('saveEpisode and loadEpisode persist nested episode JSON', async () => {
  await withTempRoot(async (tempRoot) => {
    const projectId = 'project_123';
    const scriptId = 'script_456';
    const episode = {
      id: 'episode_789',
      projectId,
      scriptId,
      episodeNo: 1,
      title: '试播集',
    };

    saveEpisode(projectId, scriptId, episode, { baseTempDir: tempRoot });

    const filePath = getEpisodeFilePath(projectId, scriptId, episode.id, tempRoot);
    assert.equal(fs.existsSync(filePath), true);
    assert.deepEqual(
      loadEpisode(projectId, scriptId, episode.id, { baseTempDir: tempRoot }),
      episode
    );
  });
});

test('load helpers return null when the persisted JSON is missing', async () => {
  await withTempRoot(async (tempRoot) => {
    assert.equal(loadProject('missing-project', { baseTempDir: tempRoot }), null);
    assert.equal(loadScript('missing-project', 'missing-script', { baseTempDir: tempRoot }), null);
    assert.equal(
      loadEpisode('missing-project', 'missing-script', 'missing-episode', { baseTempDir: tempRoot }),
      null
    );
  });
});

test('save helpers reject mismatched parent ids', async () => {
  await withTempRoot(async (tempRoot) => {
    assert.throws(
      () =>
        saveScript(
          'project_123',
          {
            id: 'script_456',
            projectId: 'project_999',
            title: '第一卷',
          },
          { baseTempDir: tempRoot }
        ),
      /script\.projectId must match the provided parent id/
    );

    assert.throws(
      () =>
        saveEpisode(
          'project_123',
          'script_456',
          {
            id: 'episode_789',
            projectId: 'project_123',
            scriptId: 'script_999',
            title: '试播集',
          },
          { baseTempDir: tempRoot }
        ),
      /episode\.scriptId must match the provided parent id/
    );

    assert.throws(
      () =>
        saveEpisode(
          'project_123',
          'script_456',
          {
            id: 'episode_789',
            projectId: 'project_999',
            scriptId: 'script_456',
            title: '试播集',
          },
          { baseTempDir: tempRoot }
        ),
      /episode\.projectId must match the provided parent id/
    );
  });
});

test('save and load helpers reject invalid or empty ids consistently', async () => {
  await withTempRoot(async (tempRoot) => {
    assert.throws(
      () => saveProject({ id: '', name: '空项目' }, { baseTempDir: tempRoot }),
      /project\.id must be a non-empty string/
    );
    assert.throws(
      () => saveScript('', { id: 'script_456', title: '第一卷' }, { baseTempDir: tempRoot }),
      /projectId must be a non-empty string/
    );
    assert.throws(
      () =>
        saveEpisode('project_123', '', { id: 'episode_789', title: '试播集' }, { baseTempDir: tempRoot }),
      /scriptId must be a non-empty string/
    );
    assert.throws(
      () => loadProject('', { baseTempDir: tempRoot }),
      /projectId must be a non-empty string/
    );
    assert.throws(
      () => loadScript('project_123', '   ', { baseTempDir: tempRoot }),
      /scriptId must be a non-empty string/
    );
    assert.throws(
      () => loadEpisode('project_123', 'script_456', '', { baseTempDir: tempRoot }),
      /episodeId must be a non-empty string/
    );
  });
});
