import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initSampleProject } from '../scripts/init-sample-project.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-init-sample-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('initSampleProject materializes sample project assets into temp/projects including voice-cast', async () => {
  await withTempRoot(async (tempRoot) => {
    const result = await initSampleProject({
      sampleProjectDir: path.resolve('samples/project-example'),
      baseTempDir: tempRoot,
    });

    assert.equal(result.projectId, 'project-example');
    assert.equal(result.scriptId, 'pilot');
    assert.equal(result.episodeId, 'episode-1');

    const projectFile = path.join(tempRoot, 'projects', 'project-example', 'project.json');
    const scriptFile = path.join(tempRoot, 'projects', 'project-example', 'scripts', 'pilot', 'script.json');
    const episodeFile = path.join(
      tempRoot,
      'projects',
      'project-example',
      'scripts',
      'pilot',
      'episodes',
      'episode-1',
      'episode.json'
    );
    const voiceCastFile = path.join(tempRoot, 'projects', 'project-example', 'voice-cast.json');
    const bibleFile = path.join(
      tempRoot,
      'projects',
      'project-example',
      'character-bibles',
      'bible-shenqing.json'
    );

    assert.equal(fs.existsSync(projectFile), true);
    assert.equal(fs.existsSync(scriptFile), true);
    assert.equal(fs.existsSync(episodeFile), true);
    assert.equal(fs.existsSync(voiceCastFile), true);
    assert.equal(fs.existsSync(bibleFile), true);

    const voiceCast = JSON.parse(fs.readFileSync(voiceCastFile, 'utf-8'));
    assert.equal(Array.isArray(voiceCast), true);
    assert.equal(voiceCast[0].characterId, 'ep-char-shenqing');
    assert.equal(voiceCast[0].voiceProfile.provider, 'xfyun');
  });
});
