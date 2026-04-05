import test from 'node:test';
import assert from 'node:assert/strict';

import { probeVideoDurationSec } from '../src/utils/mediaProbe.js';

test('probeVideoDurationSec reads duration from fluent-ffmpeg ffprobe metadata', async () => {
  const durationSec = await probeVideoDurationSec('C:/tmp/sequence.mp4', {
    ffprobe: (videoPath, callback) => {
      assert.equal(videoPath, 'C:/tmp/sequence.mp4');
      callback(null, {
        format: {
          duration: '4.25',
        },
      });
    },
  });

  assert.equal(durationSec, 4.25);
});

test('probeVideoDurationSec returns null when metadata duration is not finite', async () => {
  const durationSec = await probeVideoDurationSec('C:/tmp/invalid.mp4', {
    ffprobe: (_videoPath, callback) => {
      callback(null, {
        format: {
          duration: 'not-a-number',
        },
      });
    },
  });

  assert.equal(durationSec, null);
});

test('probeVideoDurationSec surfaces ffprobe errors', async () => {
  await assert.rejects(
    () =>
      probeVideoDurationSec('C:/tmp/error.mp4', {
        ffprobe: (_videoPath, callback) => {
          callback(new Error('ffprobe boom'));
        },
      }),
    /ffprobe boom/
  );
});
