import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchRunReviewClips } from '../../views/src/lib/workbench.ts';

test('fetchRunReviewClips flattens grouped clip payloads and sorts by timeline', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      clips: {
        bridge: [
          { id: 'bridge_001', type: 'bridge', startSec: 2.8, endSec: 3.2, label: 'bridge' },
        ],
        shot: [
          { id: 'shot_002', type: 'shot', startSec: 3, endSec: 7, label: 'shot-2' },
          { id: 'shot_001', type: 'shot', startSec: 0, endSec: 3, label: 'shot-1' },
        ],
        sequence: [
          { id: 'sequence_001', type: 'sequence', startSec: 0, endSec: 7, label: 'sequence' },
        ],
        audio: [
          { id: 'audio_001', type: 'audio', startSec: 0, endSec: 7, label: 'audio' },
        ],
      },
    }),
  });

  try {
    const clips = await fetchRunReviewClips('run_fixture');
    assert.deepEqual(
      clips.map((clip) => [clip.id, clip.kind, clip.startMs, clip.endMs]),
      [
        ['shot_001', 'shot', 0, 3000],
        ['sequence_001', 'sequence', 0, 7000],
        ['audio_001', 'audio', 0, 7000],
        ['bridge_001', 'bridge', 2800, 3200],
        ['shot_002', 'shot', 3000, 7000],
      ]
    );
  } finally {
    global.fetch = originalFetch;
  }
});
