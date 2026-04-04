import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, runMotionEnhancer } from '../src/agents/motionEnhancer.js';

test('decideEnhancement returns enhance for completed videos with enhancement hints', () => {
  const decision = __testables.decideEnhancement(
    {
      shotId: 'shot_001',
      status: 'completed',
      videoPath: '/tmp/shot_001.mp4',
    },
    {
      shotId: 'shot_001',
      enhancementHints: ['timing_normalizer'],
    }
  );

  assert.deepEqual(decision, {
    decision: 'enhance',
    profile: 'timing_normalizer',
    reason: 'enhancement_hints_present',
  });
});

test('decideEnhancement skips failed or missing video results', () => {
  assert.deepEqual(
    __testables.decideEnhancement(
      { shotId: 'shot_002', status: 'failed', videoPath: null },
      { shotId: 'shot_002', enhancementHints: ['timing_normalizer'] }
    ),
    {
      decision: 'skip_enhance',
      profile: 'none',
      reason: 'video_unavailable',
    }
  );
});

test('runMotionEnhancer returns enhancedVideoResults with minimum Phase 2 fields', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-motion-enhancer-'));

  try {
    const sourceVideoPath = path.join(tempDir, 'shot_001.mp4');
    fs.writeFileSync(sourceVideoPath, 'fake-video');

    const results = await runMotionEnhancer(
      [
        {
          shotId: 'shot_001',
          status: 'completed',
          videoPath: sourceVideoPath,
          targetDurationSec: 4,
        },
      ],
      [
        {
          shotId: 'shot_001',
          enhancementHints: ['timing_normalizer'],
        },
      ],
      {
        enhanceVideoFile: async ({ outputPath }) => {
          fs.writeFileSync(outputPath, 'enhanced-video');
          return {
            enhancementActions: ['timing_normalizer', 'encoding_normalization'],
            durationAdjusted: true,
            qualityDelta: 'improved',
          };
        },
      }
    );

    assert.equal(results.length, 1);
    assert.deepEqual(results[0], {
      shotId: 'shot_001',
      sourceVideoPath,
      enhancementApplied: true,
      enhancementProfile: 'timing_normalizer',
      enhancementActions: ['timing_normalizer', 'encoding_normalization'],
      enhancedVideoPath: path.join(tempDir, 'enhanced', 'shot_001.mp4'),
      durationAdjusted: true,
      cameraMotionInjected: false,
      interpolationApplied: false,
      stabilizationApplied: false,
      qualityDelta: 'improved',
      status: 'completed',
      error: null,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

