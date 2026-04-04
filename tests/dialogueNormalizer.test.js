import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { normalizeDialogueShots } from '../src/agents/dialogueNormalizer.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { withManagedTempRoot } from './helpers/testArtifacts.js';

test('dialogue normalizer trims dialogue, applies lexicon replacements, and computes dialogueDurationMs', async (t) => {
  await withManagedTempRoot(t, 'aivf-dialogue-normalizer', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '标准化项目',
      scriptId: 'script_1',
      scriptTitle: '第一卷',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_dialogue_normalizer',
      startedAt: '2026-04-03T12:00:00.000Z',
    });

    const normalized = normalizeDialogueShots(
      [
        {
          id: 'shot_1',
          dialogue: '  AI  TTS v1  来了！  ',
          duration: 4,
        },
      ],
      {
        pronunciationLexicon: [
          { source: 'AI', target: 'A I' },
          { source: 'TTS', target: 'T T S' },
        ],
        artifactContext: ctx.agents.ttsAgent,
      }
    );

    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].dialogueOriginal, '  AI  TTS v1  来了！  ');
    assert.equal(normalized[0].dialogue, 'A I T T S v1 来了！');
    assert.equal(normalized[0].dialogueDurationMs > 0, true);
    assert.deepEqual(normalized[0].dialogueSegments, ['A I T T S v1 来了！']);

    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.inputsDir, 'dialogue-normalized.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.inputsDir, 'pronunciation-lexicon.json')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(ctx.agents.ttsAgent.outputsDir, 'tts-segments.json')),
      true
    );
  }, 'tts-agent');
});

test('dialogue normalizer splits long dialogue into sentence-level segments and keeps no-dialogue shots intact', () => {
  const normalized = normalizeDialogueShots([
    {
      id: 'shot_1',
      dialogue: '第一句很短。第二句也不长。第三句收尾。',
      duration: 8,
    },
    {
      id: 'shot_2',
      dialogue: '',
      duration: 3,
    },
  ]);

  assert.equal(normalized[0].dialogueSegments.length, 3);
  assert.equal(normalized[0].dialogueSegments[0], '第一句很短。');
  assert.equal(normalized[0].dialogueSegments[2], '第三句收尾。');
  assert.equal(normalized[1].dialogue, '');
  assert.equal(normalized[1].dialogueDurationMs, null);
  assert.deepEqual(normalized[1].dialogueSegments, []);
});
