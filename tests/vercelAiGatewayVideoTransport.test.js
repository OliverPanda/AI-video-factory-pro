import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  __testables,
  createVercelAiGatewayVideoTransport,
} from '../src/apis/transports/vercelAiGatewayVideoTransport.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-vercel-video-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
}

test('buildVercelAiGatewayVideoRequest maps shot sequence and bridge packages', () => {
  const shotRequest = __testables.buildVercelAiGatewayVideoRequest({
    shotId: 'shot_001',
    visualGoal: '人物回头',
    durationTargetSec: 4,
    cameraSpec: { ratio: '9:16' },
    referenceImages: [{ path: '/tmp/shot_001.png' }],
  }, { VIDEO_MODEL_SHOT: 'provider/shot-model' });
  assert.equal(shotRequest.packageType, 'shot');
  assert.equal(shotRequest.entityId, 'shot_001');
  assert.equal(shotRequest.model, 'provider/shot-model');
  assert.equal(shotRequest.references[0].role, 'first_frame');

  const sequenceRequest = __testables.buildVercelAiGatewayVideoRequest({
    sequenceId: 'seq_001',
    packageType: 'sequence',
    sequenceContextSummary: 'sequence action',
    referenceImages: [{ path: '/tmp/shot_a.png' }],
    referenceVideos: [{ path: '/tmp/seq.mp4', type: 'motion_reference' }],
  }, { VIDEO_MODEL_SEQUENCE: 'provider/sequence-model' });
  assert.equal(sequenceRequest.packageType, 'sequence');
  assert.equal(sequenceRequest.entityId, 'seq_001');
  assert.equal(sequenceRequest.model, 'provider/sequence-model');
  assert.equal(sequenceRequest.references[1].role, 'reference_video');

  const bridgeRequest = __testables.buildVercelAiGatewayVideoRequest({
    bridgeId: 'bridge_001',
    packageType: 'bridge',
    promptDirectives: ['keep motion smooth'],
    fromReferenceImage: '/tmp/from.png',
    toReferenceImage: '/tmp/to.png',
    fromShotRef: { shotId: 'shot_a' },
    toShotRef: { shotId: 'shot_b' },
  }, { VIDEO_MODEL_BRIDGE: 'provider/bridge-model' });
  assert.equal(bridgeRequest.packageType, 'bridge');
  assert.equal(bridgeRequest.entityId, 'bridge_001');
  assert.equal(bridgeRequest.model, 'provider/bridge-model');
  assert.equal(bridgeRequest.references[0].role, 'first_frame');
  assert.equal(bridgeRequest.references[1].role, 'last_frame');
});

test('createVercelAiGatewayVideoTransport submits polls downloads and normalizes results', async () => {
  await withTempRoot(async (tempRoot) => {
    const outputPath = path.join(tempRoot, 'shot.mp4');
    const calls = [];
    const transport = createVercelAiGatewayVideoTransport({
      httpClient: {
        async post(url, body) {
          calls.push(['post', url, body.model, body.packageType]);
          return { data: { id: 'task_001', outputUrl: 'https://example.com/out.mp4' } };
        },
        async get(url) {
          calls.push(['get', url]);
          return { data: { status: 'completed', outputUrl: 'https://example.com/out.mp4', durationSec: 4 } };
        },
      },
      binaryHttpClient: {
        async get(url) {
          calls.push(['download', url]);
          return { data: Buffer.from('fake-mp4') };
        },
      },
      sleep: async () => {},
    });

    const submitResult = await transport.submitVideoGeneration({
      shotId: 'shot_001',
      preferredProvider: 'seedance',
      visualGoal: '人物回头',
      durationTargetSec: 4,
    });
    const pollResult = await transport.pollVideoGeneration(submitResult.taskId);
    const downloadResult = await transport.downloadVideoGeneration(pollResult.outputUrl, outputPath, {
      shotId: 'shot_001',
      preferredProvider: 'seedance',
      taskId: submitResult.taskId,
      actualDurationSec: pollResult.actualDurationSec,
      providerRequest: submitResult.providerRequest,
      providerMetadata: submitResult.providerMetadata,
    });

    assert.equal(submitResult.provider, 'vercel_ai_gateway');
    assert.equal(submitResult.model, 'bytedance/seedance-v1.5-pro');
    assert.equal(pollResult.status, 'COMPLETED');
    assert.equal(downloadResult.provider, 'vercel_ai_gateway');
    assert.equal(downloadResult.preferredProvider, 'seedance');
    assert.equal(fs.existsSync(outputPath), true);
    assert.deepEqual(calls.map((entry) => entry[0]), ['post', 'get', 'download']);
  });
});

test('classifyVercelAiGatewayVideoError categorizes auth invalid request and timeout', () => {
  assert.equal(
    __testables.classifyVercelAiGatewayVideoError({ message: 'forbidden', response: { status: 403, data: {} } }).category,
    'provider_auth_error'
  );
  assert.equal(
    __testables.classifyVercelAiGatewayVideoError({ message: 'bad request', response: { status: 422, data: {} } }).category,
    'provider_invalid_request'
  );
  assert.equal(
    __testables.classifyVercelAiGatewayVideoError({ message: 'timeout', code: 'ECONNABORTED' }).category,
    'provider_timeout'
  );
});
