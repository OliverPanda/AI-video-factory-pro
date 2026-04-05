import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeVideoProviderError,
  normalizeVideoProviderRequest,
  normalizeVideoProviderResult,
} from '../src/apis/videoProviderProtocol.js';

test('normalizeVideoProviderResult keeps provider metadata stable', () => {
  const result = normalizeVideoProviderResult({
    provider: 'seedance',
    shotId: 'shot_001',
    providerJobId: 'job-1',
    videoPath: 'temp/video/shot_001.mp4',
    request: {
      model: 'seedance-2.0-pro',
      duration: 5,
    },
    metadata: {
      region: 'cn-north-1',
    },
  });

  assert.equal(result.provider, 'seedance');
  assert.equal(result.shotId, 'shot_001');
  assert.equal(result.taskId, 'job-1');
  assert.equal(result.providerJobId, 'job-1');
  assert.equal(result.providerRequest.model, 'seedance-2.0-pro');
  assert.equal(result.providerMetadata.region, 'cn-north-1');
});

test('normalizeVideoProviderRequest returns auditable provider request summary', () => {
  const request = normalizeVideoProviderRequest({
    provider: 'runway',
    request: { model: 'gen4_turbo', duration: 5 },
    metadata: { ratio: '9:16' },
  });

  assert.deepEqual(request, {
    provider: 'runway',
    providerRequest: { model: 'gen4_turbo', duration: 5 },
    providerMetadata: { ratio: '9:16' },
  });
});

test('normalizeVideoProviderError keeps standardized provider error fields', () => {
  const error = normalizeVideoProviderError({
    message: 'auth failed',
    code: 'RUNWAY_AUTH_ERROR',
    category: 'provider_auth_error',
    status: 401,
    details: { requestId: 'req-1' },
  });

  assert.equal(error.message, 'auth failed');
  assert.equal(error.code, 'RUNWAY_AUTH_ERROR');
  assert.equal(error.category, 'provider_auth_error');
  assert.equal(error.status, 401);
  assert.deepEqual(error.details, { requestId: 'req-1' });
});
