import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables as videoRouterTestables } from '../src/agents/videoRouter.js';
import { __testables as bridgeRouterTestables } from '../src/agents/bridgeShotRouter.js';
import { __testables as sequenceRouterTestables } from '../src/agents/actionSequenceRouter.js';
import { generateBridgeClips } from '../src/agents/bridgeClipGenerator.js';
import { generateSequenceClips } from '../src/agents/sequenceClipGenerator.js';
import { normalizeVideoProvider } from '../src/apis/videoGenerationContract.js';

function writeTinyMp4(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from('00000018667479706d703432', 'hex'));
}

test('video provider harness keeps a configured provider isolated across shot bridge and sequence packages', () => {
  const shotPackages = videoRouterTestables.buildShotPackages(
    [{ id: 'shot_1', scene: 'warehouse', action: 'push forward' }],
    [{ shotId: 'shot_1', shotType: 'medium', durationTargetSec: 4, visualGoal: 'push forward', cameraSpec: { ratio: '9:16' } }],
    [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true }],
    { videoProvider: 'happyhorse' }
  );
  assert.equal(shotPackages[0].preferredProvider, 'happyhorse');
  assert.deepEqual(shotPackages[0].fallbackProviders, []);
  assert.equal(shotPackages[0].qaRules.canFallbackToStaticImage, false);

  const bridgePackages = bridgeRouterTestables.buildBridgeShotPackages(
    [{
      bridgeId: 'bridge_1_2',
      fromShotId: 'shot_1',
      toShotId: 'shot_2',
      bridgeType: 'motion_carry',
      bridgeGoal: 'carry motion',
      durationTargetSec: 1.8,
      bridgeGenerationMode: 'first_last_keyframe',
      preferredProvider: 'happyhorse',
    }],
    {
      imageResults: [
        { shotId: 'shot_1', imagePath: '/tmp/shot_1.png' },
        { shotId: 'shot_2', imagePath: '/tmp/shot_2.png' },
      ],
      videoResults: [],
    }
  );
  assert.equal(bridgePackages[0].preferredProvider, 'happyhorse');
  assert.deepEqual(bridgePackages[0].fallbackProviders, []);
  assert.equal(bridgePackages[0].qaRules.canFallbackToOtherVideoProvider, false);

  const sequencePackages = sequenceRouterTestables.buildActionSequencePackages(
    [{
      sequenceId: 'seq_1',
      shotIds: ['shot_1'],
      durationTargetSec: 4,
      preferredProvider: 'happyhorse',
      generationMode: 'provider-assisted',
      sequenceGoal: 'finish the action beat',
    }],
    {
      imageResults: [{ shotId: 'shot_1', imagePath: '/tmp/shot_1.png', success: true }],
      videoResults: [],
      bridgeClipResults: [],
      performancePlan: [],
    }
  );
  assert.equal(sequencePackages[0].preferredProvider, 'happyhorse');
  assert.deepEqual(sequencePackages[0].fallbackProviders, []);
  assert.match(sequencePackages[0].qaRules.join('\n'), /do_not_fallback_to_other_video_provider/);
});

test('video provider harness does not alias concrete provider names to another model', () => {
  assert.equal(normalizeVideoProvider('happyhorse'), 'happyhorse');
  assert.equal(videoRouterTestables.resolvePreferredVideoProvider({ videoProvider: 'happyhorse' }), 'happyhorse');
});

test('video provider harness runs arbitrary providers through the unified client for bridge and sequence clips', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-video-provider-harness-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const calls = [];
  const providerClient = {
    async submit(videoPackage) {
      calls.push(['submit', videoPackage.packageType, videoPackage.preferredProvider]);
      return { taskId: `task_${videoPackage.packageType}`, provider: videoPackage.preferredProvider, model: 'happyhorse-1.0-r2v' };
    },
    async poll(taskId) {
      calls.push(['poll', taskId]);
      return { status: 'SUCCEEDED', outputUrl: `https://example.com/${taskId}.mp4`, actualDurationSec: 2 };
    },
    async download(_outputUrl, outputPath) {
      calls.push(['download', path.basename(outputPath)]);
      writeTinyMp4(outputPath);
    },
  };

  const bridgeRun = await generateBridgeClips(
    [{
      bridgeId: 'bridge_happyhorse',
      fromShotRef: { shotId: 'shot_1' },
      toShotRef: { shotId: 'shot_2' },
      fromReferenceImage: '/tmp/shot_1.png',
      toReferenceImage: '/tmp/shot_2.png',
      promptDirectives: ['bridge type: motion carry'],
      durationTargetSec: 1.8,
      providerCapabilityRequirement: 'image_to_video',
      firstLastFrameMode: 'disabled',
      preferredProvider: 'happyhorse',
      fallbackProviders: [],
    }],
    path.join(tempRoot, 'bridge'),
    { providerClient }
  );
  assert.equal(bridgeRun.results[0].status, 'completed');
  assert.equal(bridgeRun.results[0].provider, 'happyhorse');

  const sequenceRun = await generateSequenceClips(
    [{
      packageType: 'sequence',
      sequenceId: 'seq_happyhorse',
      shotIds: ['shot_1'],
      durationTargetSec: 2,
      preferredProvider: 'happyhorse',
      referenceImages: [{ path: '/tmp/shot_1.png' }],
      referenceVideos: [],
      bridgeReferences: [],
      providerRequestHints: { referenceTier: 'image', referenceCount: 1 },
    }],
    path.join(tempRoot, 'sequence'),
    { providerClient, probeVideoDurationSec: async () => 2 }
  );
  assert.equal(sequenceRun.results[0].status, 'completed');
  assert.equal(sequenceRun.results[0].provider, 'happyhorse');
  assert.deepEqual(
    calls.filter((entry) => entry[0] === 'submit').map((entry) => entry.slice(1)),
    [
      ['bridge', 'happyhorse'],
      ['sequence', 'happyhorse'],
    ]
  );
});
