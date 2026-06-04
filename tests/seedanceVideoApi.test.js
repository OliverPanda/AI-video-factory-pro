import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import { __testables, seedanceImageToVideo } from '../src/apis/seedanceVideoApi.js';
import { createUnifiedVideoProviderClient } from '../src/apis/unifiedVideoProviderClient.js';
import { resolveVideoGenerationConfig } from '../src/apis/videoGenerationConfig.js';
import {
  __testables as videoTransportTestables,
  createRelayMediaTaskTransport,
  createRelaySeedanceV2VideoTransport,
} from '../src/apis/videoTransports.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-seedance-api-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('buildSeedanceVideoRequest maps shot package into official create-task payload', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const request = await __testables.buildSeedanceVideoRequest(
      {
        shotId: 'shot_001',
        durationTargetSec: 4,
        visualGoal: '皇城长廊里人物缓慢回头',
        cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
        sequenceContextSummary: 'sequence type: fight_exchange_sequence | shot coverage: shot_001 -> shot_002',
        providerRequestHints: {
          referenceTier: 'image',
          hasAudioBeatHints: true,
          audioBeatHints: ['beat_1'],
          sequenceGoal: '让动作衔接更连贯',
          entryConstraint: '接住上一镜的起手姿态',
          exitConstraint: '落到下一镜的收势',
          continuityTargets: ['weapon_path', 'char_a', 'lighting'],
          preserveElements: ['subject_identity'],
          cameraFlowIntent: 'push_in_then_follow',
          hardContinuityRules: ['avoid abrupt pose reset'],
        },
      },
      {
        SEEDANCE_MODEL_ID: 'doubao-seedance-2-0-260128',
      }
    );

    assert.equal(request.model, 'doubao-seedance-2-0-260128');
    assert.equal(request.duration, 4);
    assert.equal(request.ratio, '9:16');
    assert.equal(request.generate_audio, false);
    assert.equal(request.content[0].type, 'text');
    assert.equal(request.content[1].type, 'image_url');
    assert.equal(request.content[1].role, 'first_frame');
    assert.match(request.content[1].image_url.url, /^data:image\/jpeg;base64,/);
    assert.match(request.content[0].text, /sequence type: fight_exchange_sequence/i);
    assert.match(request.content[0].text, /reference tier: image/i);
    assert.match(request.content[0].text, /audio beat hints: beat_1/i);
    assert.match(request.content[0].text, /continuous attack-and-defense exchange/i);
    assert.match(request.content[0].text, /entry anchor:/i);
    assert.match(request.content[0].text, /hard continuity rules:/i);
  });
});

test('buildPromptText keeps specialized sequence templates and preserves generic context fields', async () => {
  const chasePrompt = await __testables.buildPromptText({
    visualGoal: 'character high speed chase',
    sequenceContextSummary:
      'sequence type: chase_run_sequence | shot coverage: shot_100 -> shot_101 | template: sustain forward chase momentum and keep acceleration coherent',
    cameraSpec: { moveType: 'follow_run', framing: 'wide' },
    providerRequestHints: {
      referenceTier: 'video',
      audioBeatHints: ['beat_1'],
      entryConstraint: 'catch the running direction from previous shot',
      exitConstraint: 'land on the forward rush point of next shot',
      continuityTargets: ['direction_of_travel', 'runner_a', 'street'],
      preserveElements: ['subject_identity'],
      cameraFlowIntent: 'long_follow',
      hardContinuityRules: ['avoid abrupt pose reset'],
    },
  });

  assert.match(chasePrompt, /sustain forward chase momentum/i);
  assert.match(chasePrompt, /entry anchor:/i);
  assert.match(chasePrompt, /exit anchor:/i);
  assert.match(chasePrompt, /continuity locks: direction_of_travel, runner_a, street/i);
  assert.match(chasePrompt, /preserve elements: subject_identity/i);
  assert.match(chasePrompt, /camera motion: follow_run/i);
  assert.match(chasePrompt, /camera flow intent: long_follow/i);
  assert.match(chasePrompt, /reference tier: video/i);
  assert.match(chasePrompt, /audio beat hints: beat_1/i);
  assert.match(chasePrompt, /hard continuity rules: avoid abrupt pose reset/i);
});

test('buildPromptText gives sequence packages explicit multi-image multi-video binding and handoff instructions', async () => {
  const promptText = await __testables.buildPromptText({
    sequenceId: 'seq_900',
    shotIds: ['shot_100', 'shot_101'],
    visualGoal: 'keep the chase readable and relentless',
    sequenceContextSummary:
      'sequence type: chase_run_sequence | shot coverage: shot_100 -> shot_101 | template: sustain forward chase momentum and keep acceleration coherent',
    cameraSpec: { moveType: 'follow_run', framing: 'wide' },
    referenceImages: [
      { path: '/tmp/shot_100.png', shotId: 'shot_100', role: 'first_frame' },
      { path: '/tmp/shot_101.png', shotId: 'shot_101', role: 'supporting_reference' },
    ],
    referenceVideos: [
      { path: '/tmp/shot_100.mp4', shotId: 'shot_100', type: 'qa_passed_video' },
    ],
    providerRequestHints: {
      referenceTier: 'video',
      audioBeatHints: ['beat_1'],
      sequenceGoal: 'sustain forward chase momentum',
      entryConstraint: 'catch the running direction from previous shot',
      exitConstraint: 'land on the forward rush point of next shot',
      continuityTargets: ['direction_of_travel', 'runner_a', 'street'],
      preserveElements: ['subject_identity'],
      cameraFlowIntent: 'long_follow',
      hardContinuityRules: ['avoid abrupt pose reset'],
    },
  });

  assert.match(promptText, /subject and action:/i);
  assert.match(promptText, /scene and style:/i);
  assert.match(promptText, /camera and timing:/i);
  assert.match(promptText, /reference binding:/i);
  assert.match(promptText, /image1 is the first frame/i);
  assert.match(promptText, /image2 is the supporting reference/i);
  assert.match(promptText, /video1 is the qa passed video/i);
  assert.match(promptText, /entry anchor: catch the running direction/i);
  assert.match(promptText, /exit anchor: land on the forward rush point/i);
  assert.match(promptText, /sustain forward chase momentum/i);
});

test('buildPromptText prefers structured seedancePromptBlocks when present', async () => {
  const promptText = await __testables.buildPromptText({
    seedancePromptBlocks: [
      { key: 'cinematic_intent', text: 'Keep the confrontation grounded and legible.' },
      { key: 'entry_exit', text: 'entry: gun raised; exit: opponent pinned by the shelf' },
      { key: 'timecoded_beats', text: '0s raise weapon | 2s pressure forward' },
    ],
    providerRequestHints: {
      cameraFlowIntent: 'this should be ignored when blocks exist',
    },
  });

  assert.match(promptText, /grounded and legible/i);
  assert.match(promptText, /entry:/i);
  assert.doesNotMatch(promptText, /this should be ignored/i);
});

test('buildPromptText turns structured blocks into Seedance-style subject environment camera and reference instructions', async () => {
  const promptText = await __testables.buildPromptText({
    seedancePromptBlocks: [
      { key: 'subject_action', text: 'Two rivals confront each other as Lin Lan raises the pistol and presses forward.' },
      { key: 'scene_environment', text: 'Set the scene in the warehouse main aisle at cold industrial night, with cold industrial realism and practical top light.' },
      { key: 'cinematography', text: 'Use medium framing, slow push camera motion, clarity_first coverage, and restrained pressure movement.' },
      { key: 'reference_binding', text: 'image1 is the first frame keyframe for the opening pose. image2 is a supporting character consistency reference.' },
      { key: 'entry_exit', text: 'entry: Lin Lan enters frame with the pistol already raised; exit: A Zhe is forced back toward the shelf' },
    ],
  });

  const subjectIndex = promptText.indexOf('subject and action');
  const environmentIndex = promptText.indexOf('scene and style');
  const cameraIndex = promptText.indexOf('camera and timing');
  const referenceIndex = promptText.indexOf('reference binding');

  assert.notEqual(subjectIndex, -1);
  assert.notEqual(environmentIndex, -1);
  assert.notEqual(cameraIndex, -1);
  assert.notEqual(referenceIndex, -1);
  assert.equal(subjectIndex < environmentIndex, true);
  assert.equal(environmentIndex < cameraIndex, true);
  assert.equal(cameraIndex < referenceIndex, true);
  assert.match(promptText, /image1 is the first frame keyframe/i);
});

test('buildSeedanceVideoRequest prioritizes structured prompt blocks over legacy provider hints in final request text', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const request = await __testables.buildSeedanceVideoRequest({
      shotId: 'shot_priority',
      durationTargetSec: 4,
      visualGoal: 'legacy visual goal should not dominate',
      cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
      referenceImages: [{ path: imagePath }],
      providerRequestHints: {
        sequenceGoal: 'legacy hint should be secondary',
        cameraFlowIntent: 'legacy_camera_flow',
      },
      seedancePromptBlocks: [
        { key: 'cinematic_intent', text: 'Keep the confrontation grounded and spatially legible.' },
        { key: 'entry_exit', text: 'entry: gun raised; exit: opponent pinned by the shelf' },
        { key: 'timecoded_beats', text: '0s raise weapon | 2s pressure forward' },
      ],
    });

    assert.match(request.content[0].text, /grounded and spatially legible/i);
    assert.match(request.content[0].text, /entry: gun raised/i);
    assert.doesNotMatch(request.content[0].text, /legacy_camera_flow/i);
    assert.doesNotMatch(request.content[0].text, /legacy hint should be secondary/i);
  });
});

test('classifySeedanceError categorizes auth rate-limit invalid-request timeout and server errors', () => {
  assert.equal(
    __testables.classifySeedanceError({ message: 'unauthorized', response: { status: 401, data: {} } }).category,
    'provider_auth_error'
  );
  assert.equal(
    __testables.classifySeedanceError({ message: 'slow down', response: { status: 429, data: {} } }).category,
    'provider_rate_limit'
  );
  assert.equal(
    __testables.classifySeedanceError({ message: 'bad request', response: { status: 400, data: {} } }).category,
    'provider_invalid_request'
  );
  assert.equal(
    __testables.classifySeedanceError({ message: 'timeout', code: 'ECONNABORTED' }).category,
    'provider_timeout'
  );
  assert.equal(
    __testables.classifySeedanceError({ message: 'server boom', response: { status: 500, data: {} } }).category,
    'provider_generation_failed'
  );
});

test('seedanceImageToVideo submits, polls, downloads and writes mp4 file', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    const outputPath = path.join(tempRoot, 'shot.mp4');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    const calls = [];
    const httpClient = {
      async post(url, body) {
        calls.push(['post', url, body.model]);
        return { data: { id: 'cgt-2026-demo' } };
      },
      async get(url) {
        calls.push(['get', url]);
        return {
          data: {
            id: 'cgt-2026-demo',
            status: 'succeeded',
            duration: 4,
            ratio: '9:16',
            resolution: '720p',
            content: { video_url: 'https://example.com/seedance.mp4' },
          },
        };
      },
    };
    const binaryHttpClient = {
      async get(url) {
        calls.push(['download', url]);
        return { data: Buffer.from('fake-mp4') };
      },
    };

    const result = await seedanceImageToVideo(
      {
        sequenceId: 'seq_001',
        shotId: 'shot_001',
        preferredProvider: 'seedance',
        durationTargetSec: 4,
        visualGoal: '人物回身拔剑',
        cameraSpec: { moveType: 'tracking_pan', framing: 'medium', ratio: '9:16' },
        referenceImages: [{ path: imagePath }],
        referenceStrategy: 'image_first',
        providerRequestHints: {
          referenceTier: 'image',
          referenceCount: 1,
        },
      },
      outputPath,
      {
        apiKey: 'demo-key',
        httpClient,
        binaryHttpClient,
        sleep: async () => {},
        pollIntervalMs: 1,
        overallTimeoutMs: 50,
      },
      {}
    );

    assert.equal(result.provider, 'seedance');
    assert.equal(result.providerJobId, 'cgt-2026-demo');
    assert.equal(result.taskId, 'cgt-2026-demo');
    assert.equal(result.providerRequest.model, 'doubao-seedance-2-0-260128');
    assert.equal(result.providerMetadata.shotId, 'shot_001');
    assert.equal(result.providerMetadata.sequenceId, 'seq_001');
    assert.equal(result.providerMetadata.referenceTier, 'image');
    assert.equal(result.providerMetadata.referenceStrategy, 'image_first');
    assert.equal(fs.existsSync(outputPath), true);
    assert.deepEqual(calls.map((item) => item[0]), ['post', 'get', 'download']);
  });
});

test('seedanceImageToVideo throws timeout category when polling exceeds deadline', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'shot.jpg');
    fs.writeFileSync(imagePath, 'jpeg-binary');

    await assert.rejects(
      () =>
        seedanceImageToVideo(
          {
            shotId: 'shot_001',
            preferredProvider: 'seedance',
            durationTargetSec: 4,
            visualGoal: '人物慢慢转头',
            cameraSpec: { moveType: 'slow_dolly', framing: 'medium', ratio: '9:16' },
            referenceImages: [{ path: imagePath }],
          },
          path.join(tempRoot, 'timeout.mp4'),
          {
            apiKey: 'demo-key',
            httpClient: {
              async post() {
                return { data: { id: 'cgt-timeout' } };
              },
              async get() {
                return { data: { status: 'running' } };
              },
            },
            sleep: async () => {},
            pollIntervalMs: 1,
            overallTimeoutMs: 1,
          },
          {}
        ),
      (error) => error?.category === 'provider_timeout'
    );
  });
});

test('createUnifiedVideoProviderClient routes seedance sequence packages through seedance handlers and preserves package metadata', async () => {
  const calls = [];
  const client = createUnifiedVideoProviderClient({
    seedanceHandlers: {
      async submitVideoGeneration(videoPackage) {
        calls.push(['submit', videoPackage.packageType, videoPackage.sequenceId]);
        return {
          taskId: 'task_seedance_sequence',
          provider: 'seedance',
          model: 'doubao-seedance-2-0-260128',
          packageType: videoPackage.packageType,
          packageId: videoPackage.sequenceId,
        };
      },
      async pollVideoGeneration(taskId) {
        calls.push(['poll', taskId]);
        return {
          status: 'COMPLETED',
          outputUrl: 'https://example.com/seedance-sequence.mp4',
        };
      },
      async downloadVideoGeneration(outputUrl, outputPath) {
        calls.push(['download', outputUrl, outputPath]);
      },
    },
  });

  const submitResult = await client.submit({
    packageType: 'sequence',
    sequenceId: 'seq_900',
    preferredProvider: 'seedance',
  });
  const pollResult = await client.poll(submitResult.taskId);
  await client.download(pollResult.outputUrl, '/tmp/seq_900.mp4');

  assert.equal(submitResult.provider, 'seedance');
  assert.equal(submitResult.packageType, 'sequence');
  assert.equal(submitResult.packageId, 'seq_900');
  assert.deepEqual(calls, [
    ['submit', 'sequence', 'seq_900'],
    ['poll', 'task_seedance_sequence'],
    ['download', 'https://example.com/seedance-sequence.mp4', '/tmp/seq_900.mp4'],
  ]);
});

test('createUnifiedVideoProviderClient routes compatibility bridge packages through fallback handlers with normalized provider semantics', async () => {
  const calls = [];
  const client = createUnifiedVideoProviderClient({
    fallbackHandlers: {
      async submitVideoGeneration(videoPackage) {
        calls.push(['submit', videoPackage.packageType, videoPackage.bridgeId, videoPackage.preferredProvider]);
        return {
          taskId: 'task_bridge_compat',
          provider: 'sora2',
          model: 'relay-seedance-compatible',
          packageType: videoPackage.packageType,
          packageId: videoPackage.bridgeId,
        };
      },
      async pollVideoGeneration(taskId) {
        calls.push(['poll', taskId]);
        return {
          status: 'COMPLETED',
          outputUrl: 'https://example.com/bridge.mp4',
        };
      },
      async downloadVideoGeneration(outputUrl, outputPath) {
        calls.push(['download', outputUrl, outputPath]);
      },
    },
  });

  const submitResult = await client.submit({
    packageType: 'bridge',
    bridgeId: 'bridge_compat_1',
    preferredProvider: 'fallback_video',
  });
  const pollResult = await client.poll(submitResult.taskId);
  await client.download(pollResult.outputUrl, '/tmp/bridge_compat_1.mp4');

  assert.equal(submitResult.provider, 'sora2');
  assert.equal(submitResult.packageType, 'bridge');
  assert.equal(submitResult.packageId, 'bridge_compat_1');
  assert.deepEqual(calls, [
    ['submit', 'bridge', 'bridge_compat_1', 'fallback_video'],
    ['poll', 'task_bridge_compat'],
    ['download', 'https://example.com/bridge.mp4', '/tmp/bridge_compat_1.mp4'],
  ]);
});

test('createUnifiedVideoProviderClient routes vercel ai gateway packages through injected vercel handlers', async () => {
  const calls = [];
  const client = createUnifiedVideoProviderClient({
    vercelHandlers: {
      async submitVideoGeneration(videoPackage) {
        calls.push(['submit', videoPackage.packageType, videoPackage.shotId, videoPackage.preferredProvider]);
        return {
          taskId: 'task_vercel_001',
          provider: 'vercel_ai_gateway',
          model: 'bytedance/seedance-v1.5-pro',
        };
      },
      async pollVideoGeneration(taskId) {
        calls.push(['poll', taskId]);
        return {
          status: 'COMPLETED',
          outputUrl: 'https://example.com/vercel-shot.mp4',
        };
      },
      async downloadVideoGeneration(outputUrl, outputPath) {
        calls.push(['download', outputUrl, outputPath]);
      },
    },
  });

  const submitResult = await client.submit({
    packageType: 'shot',
    shotId: 'shot_vercel_001',
    preferredProvider: 'vercel_ai_gateway',
  });
  const pollResult = await client.poll(submitResult.taskId);
  await client.download(pollResult.outputUrl, '/tmp/shot_vercel_001.mp4', {
    preferredProvider: 'vercel_ai_gateway',
  });

  assert.equal(submitResult.provider, 'vercel_ai_gateway');
  assert.equal(submitResult.packageType, 'shot');
  assert.equal(submitResult.packageId, 'shot_vercel_001');
  assert.deepEqual(calls, [
    ['submit', 'shot', 'shot_vercel_001', 'vercel_ai_gateway'],
    ['poll', 'task_vercel_001'],
    ['download', 'https://example.com/vercel-shot.mp4', '/tmp/shot_vercel_001.mp4'],
  ]);
});

test('createUnifiedVideoProviderClient can route seedance business packages through vercel transport provider from env', async () => {
  const calls = [];
  const client = createUnifiedVideoProviderClient({
    seedanceHandlers: {
      async submitVideoGeneration() {
        throw new Error('seedance handlers should not be used when VIDEO_TRANSPORT_PROVIDER=vercel_ai_gateway');
      },
    },
    vercelHandlers: {
      async submitVideoGeneration(videoPackage) {
        calls.push(['submit', videoPackage.packageType, videoPackage.shotId, videoPackage.preferredProvider]);
        return {
          taskId: 'task_vercel_transport_001',
          provider: 'vercel_ai_gateway',
          model: 'bytedance/seedance-v1.5-pro',
        };
      },
      async pollVideoGeneration(taskId) {
        calls.push(['poll', taskId]);
        return {
          status: 'COMPLETED',
          outputUrl: 'https://example.com/vercel-transport-shot.mp4',
        };
      },
      async downloadVideoGeneration(outputUrl, outputPath) {
        calls.push(['download', outputUrl, outputPath]);
      },
    },
  });

  const submitResult = await client.submit({
    packageType: 'shot',
    shotId: 'shot_transport_env_001',
    preferredProvider: 'seedance',
  }, null, {
    env: {
      VIDEO_TRANSPORT_PROVIDER: 'vercel_ai_gateway',
    },
  });
  const pollResult = await client.poll(submitResult.taskId);
  await client.download(pollResult.outputUrl, '/tmp/shot_transport_env_001.mp4', {
    preferredProvider: 'seedance',
    transportProvider: 'vercel_ai_gateway',
  });

  assert.equal(submitResult.provider, 'vercel_ai_gateway');
  assert.equal(submitResult.packageType, 'shot');
  assert.equal(submitResult.packageId, 'shot_transport_env_001');
  assert.deepEqual(calls, [
    ['submit', 'shot', 'shot_transport_env_001', 'seedance'],
    ['poll', 'task_vercel_transport_001'],
    ['download', 'https://example.com/vercel-transport-shot.mp4', '/tmp/shot_transport_env_001.mp4'],
  ]);
});

test('relay_seedance_v2 transport respects configured submit and poll paths', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'reference.png');
    await sharp({
      create: {
        width: 1600,
        height: 1600,
        channels: 3,
        background: { r: 40, g: 80, b: 120 },
      },
    })
      .png()
      .toFile(imagePath);

    const calls = [];
    const transport = createRelaySeedanceV2VideoTransport({
      httpClient: {
        async post(url, body) {
          calls.push(['post', url, body.model]);
          return {
            data: {
              code: 'success',
              data: {
                request_id: 'relay_task_001',
                status: 'SUBMITTING',
              },
            },
          };
        },
        async get(url) {
          calls.push(['get', url]);
          return {
            data: {
              data: {
                status: 'COMPLETED',
                video_urls: ['https://example.com/relay-seedance-v2.mp4'],
              },
            },
          };
        },
      },
      sleep: async () => {},
      pollIntervalMs: 1,
      timeoutMs: 20,
    });

    const submitResult = await transport.submit(
      {
        model: 'bytedance/doubao-seedance-2-0',
        prompt: 'test prompt',
        imagePath,
      },
      {
        baseUrl: 'https://router.example.com',
        apiKey: 'demo-key',
        submitPath: '/api/v1/tasks/generations',
      }
    );

    const pollResult = await transport.poll(submitResult.taskId, {
      baseUrl: 'https://router.example.com',
      apiKey: 'demo-key',
      pollPath: '/api/v1/tasks/generations',
    });

    assert.equal(submitResult.taskId, 'relay_task_001');
    assert.equal(pollResult.outputUrl, 'https://example.com/relay-seedance-v2.mp4');
    assert.deepEqual(calls, [
      ['post', '/api/v1/tasks/generations', 'bytedance/doubao-seedance-2-0'],
      ['get', '/api/v1/tasks/generations/relay_task_001'],
    ]);
  });
});

test('relay_seedance_v2 body compresses reference image into jpeg data url', async () => {
  await withTempRoot(async (tempRoot) => {
    const imagePath = path.join(tempRoot, 'reference.png');
    await sharp({
      create: {
        width: 2048,
        height: 2048,
        channels: 3,
        background: { r: 120, g: 60, b: 30 },
      },
    })
      .png()
      .toFile(imagePath);
    const rawPng = fs.readFileSync(imagePath);

    const body = await videoTransportTestables.buildRelaySeedanceV2Body({
      model: 'bytedance/doubao-seedance-2-0',
      prompt: 'test prompt',
      imagePath,
      duration: 3,
      ratio: '9:16',
    });

    assert.equal(body.model, 'bytedance/doubao-seedance-2-0');
    assert.equal(body.duration, 4);
    assert.equal(body.ratio, '9:16');
    assert.equal(body.service_tier, undefined);
    assert.equal(body.content[0].type, 'text');
    assert.equal(body.content[1].type, 'image_url');
    assert.match(body.content[1].image_url.url, /^data:image\/jpeg;base64,/);
    assert.equal(body.content[1].image_url.url.length < `data:image/png;base64,${rawPng.toString('base64')}`.length, true);
  });
});

test('resolveVideoGenerationConfig uses relay_seedance_v2 default submit and poll paths', () => {
  const config = resolveVideoGenerationConfig(
    {
      shotId: 'shot_001',
      preferredProvider: 'seedance',
    },
    {},
    {
      VIDEO_PROVIDER: 'seedance',
      VIDEO_TRANSPORT_PROVIDER: 'relay_seedance_v2',
      VIDEO_TRANSPORT_BASE_URL: 'https://router.shengsuanyun.com',
      VIDEO_MODEL_SHOT: 'bytedance/doubao-seedance-2-0',
    }
  );

  assert.equal(config.transport, 'relay_seedance_v2');
  assert.equal(config.submitPath, '/api/v1/tasks/generations');
  assert.equal(config.pollPath, '/api/v1/tasks/generations');
});

test('resolveVideoGenerationConfig routes lingkeai sora2 through relay_media_task with media task paths', () => {
  const config = resolveVideoGenerationConfig(
    {
      shotId: 'shot_zdai_001',
      preferredProvider: 'sora2',
    },
    {},
    {
      VIDEO_PROVIDER: 'sora2',
      ZDAI_SORA2_BASE_URL: 'https://api.lingkeai.ai',
      ZDAI_SORA2_API_KEY: 'zdai-demo-key',
    }
  );

  assert.equal(config.provider, 'sora');
  assert.equal(config.transport, 'relay_media_task');
  assert.equal(config.baseUrl, 'https://api.lingkeai.ai');
  assert.equal(config.apiKey, 'zdai-demo-key');
  assert.equal(config.model, 'sora-2');
  assert.equal(config.submitPath, '/v1/media/generate');
  assert.equal(config.pollPath, '/v1/media/status');
});

test('relay_media_task transport submits and polls media task protocol', async () => {
  const calls = [];
  const transport = createRelayMediaTaskTransport({
    httpClient: {
      async post(url, body) {
        calls.push(['post', url, body.model, body.params?.orientation, body.params?.duration]);
        return {
          data: {
            code: 200,
            data: {
              task_id: 'media_task_001',
            },
          },
        };
      },
      async get(url, options) {
        calls.push(['get', url, options?.params?.task_id]);
        return {
          data: {
            code: 200,
            data: {
              task_id: 'media_task_001',
              state: 'success',
              is_final: true,
              result_url: 'https://example.com/media-task.mp4',
            },
          },
        };
      },
    },
    sleep: async () => {},
    pollIntervalMs: 1,
    timeoutMs: 20,
  });

  const submitResult = await transport.submit(
    {
      model: 'sora-2',
      prompt: 'a cinematic shot',
      params: {
        orientation: 'portrait',
        duration: '4',
      },
    },
    {
      baseUrl: 'https://api.lk888.ai',
      apiKey: 'demo-key',
      submitPath: '/v1/media/generate',
    }
  );
  const pollResult = await transport.poll(submitResult.taskId, {
    baseUrl: 'https://api.lk888.ai',
    apiKey: 'demo-key',
    pollPath: '/v1/media/status',
  });

  assert.equal(submitResult.taskId, 'media_task_001');
  assert.equal(pollResult.outputUrl, 'https://example.com/media-task.mp4');
  assert.deepEqual(calls, [
    ['post', '/v1/media/generate', 'sora-2', 'portrait', '4'],
    ['get', '/v1/media/status', 'media_task_001'],
  ]);
});

test('relay openai transport normalization preserves auth and rate-limit categories before generic 4xx fallback', () => {
  assert.equal(
    videoTransportTestables.normalizeError(
      { message: 'forbidden', response: { status: 403, data: {} } },
      'RELAY_OPENAI_SUBMIT_FAILED',
      'Relay OpenAI submit failed'
    ).category,
    'provider_auth_error'
  );
  assert.equal(
    videoTransportTestables.normalizeError(
      { message: 'slow down', response: { status: 429, data: {} } },
      'RELAY_OPENAI_SUBMIT_FAILED',
      'Relay OpenAI submit failed'
    ).category,
    'provider_rate_limit'
  );
  assert.equal(
    videoTransportTestables.normalizeError(
      { message: 'bad request', response: { status: 400, data: {} } },
      'RELAY_OPENAI_SUBMIT_FAILED',
      'Relay OpenAI submit failed'
    ).category,
    'provider_invalid_request'
  );
});
