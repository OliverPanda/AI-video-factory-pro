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

test('dialogue normalizer preserves speaker metadata from professional audio cues', () => {
  const normalized = normalizeDialogueShots([
    {
      id: 'shot_multi_speaker',
      dialogue: '  你好。 \n 我一直在等你。 ',
      speaker: '沈砚',
      audioCues: [
        { type: 'dialogue', speaker: '沈砚', performance: '低声', text: '  你好。 ' },
        { type: 'dialogue', speaker: '洛迟', text: ' 我一直在等你。 ' },
      ],
    },
  ]);

  assert.equal(normalized[0].dialogue, '你好。\n我一直在等你。');
  assert.deepEqual(normalized[0].dialogueSegments, [
    {
      id: 'shot_multi_speaker_dialogue_01',
      speaker: '沈砚',
      performance: '低声',
      text: '你好。',
      dialogueDurationMs: normalized[0].dialogueSegments[0].dialogueDurationMs,
    },
    {
      id: 'shot_multi_speaker_dialogue_02',
      speaker: '洛迟',
      performance: undefined,
      text: '我一直在等你。',
      dialogueDurationMs: normalized[0].dialogueSegments[1].dialogueDurationMs,
    },
  ]);
  assert.equal(normalized[0].dialogueSegments[0].dialogueDurationMs > 0, true);
  assert.equal(normalized[0].dialogueSegments[1].dialogueDurationMs > 0, true);
});
