import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables, textToSpeech } from '../src/apis/ttsApi.js';

test('讯飞鉴权 URL 会生成 authorization/date/host 查询参数', () => {
  const url = new URL(
    __testables.buildXfyunRequestUrl({
      apiKey: 'demo-key',
      apiSecret: 'demo-secret',
      host: 'tts-api.xfyun.cn',
      pathName: '/v2/tts',
      date: 'Tue, 31 Mar 2026 00:00:00 GMT',
    })
  );

  assert.equal(url.protocol, 'wss:');
  assert.equal(url.hostname, 'tts-api.xfyun.cn');
  assert.ok(url.searchParams.get('authorization'));
  assert.equal(url.searchParams.get('host'), 'tts-api.xfyun.cn');
  assert.equal(url.searchParams.get('date'), 'Tue, 31 Mar 2026 00:00:00 GMT');
});

test('讯飞 payload 会按性别选择音色并编码文本', () => {
  const payload = __testables.buildXfyunPayload(
    '你好，世界',
    { gender: 'female', rate: 0, pitch: 0 },
    {
      XFYUN_TTS_APP_ID: 'appid',
      XFYUN_TTS_VOICE_FEMALE: 'xiaoyan',
      XFYUN_TTS_VOICE_MALE: 'xiaofeng',
    }
  );

  assert.equal(payload.common.app_id, 'appid');
  assert.equal(payload.business.vcn, 'xiaoyan');
  assert.equal(payload.business.aue, 'lame');
  assert.equal(payload.business.speed, 50);
  assert.equal(payload.business.pitch, 50);
  assert.equal(Buffer.from(payload.data.text, 'base64').toString(), '你好，世界');
});

test('TTS provider router resolves placeholder providers explicitly', () => {
  const provider = __testables.resolveTtsProvider({ provider: 'tencent' }, {});
  const handler = __testables.getProviderHandler(provider);

  assert.equal(provider, 'tencent');
  assert.equal(typeof handler, 'function');
  assert.throws(
    () => handler('你好', 'out.mp3', {}),
    /尚未接入|not implemented/i
  );
});

test('textToSpeech dispatches mock provider through the router', async () => {
  const calls = [];
  const result = await textToSpeech('测试一下', 'tmp-output.mp3', {
    provider: 'mock',
    providerHandlers: {
      mock: async (text, outputPath, options) => {
        calls.push({ text, outputPath, options });
        return outputPath;
      },
    },
  });

  assert.equal(result, 'tmp-output.mp3');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, '测试一下');
});

test('CosyVoice request builder uses FastAPI sft defaults', async () => {
  const request = await __testables.buildCosyVoiceRequest(
    '你好，世界',
    {
      provider: 'cosyvoice',
      voice: '中文女',
      baseUrl: 'http://127.0.0.1:50000/',
    },
    {}
  );

  assert.equal(request.mode, 'sft');
  assert.equal(request.url, 'http://127.0.0.1:50000/inference_sft');
  assert.equal(request.body.get('tts_text'), '你好，世界');
  assert.equal(request.body.get('spk_id'), '中文女');
});

test('textToSpeech dispatches cosyvoice provider through the router', async () => {
  const calls = [];
  const result = await textToSpeech('用 CosyVoice 合成', 'cosyvoice-output.wav', {
    provider: 'cosyvoice',
    providerHandlers: {
      cosyvoice: async (text, outputPath, options) => {
        calls.push({ text, outputPath, options });
        return outputPath;
      },
    },
  });

  assert.equal(result, 'cosyvoice-output.wav');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, '用 CosyVoice 合成');
});

test('Fish Speech request builder uses official /v1/tts JSON shape', async () => {
  const request = await __testables.buildFishSpeechRequest(
    '你好，世界',
    {
      provider: 'fish-speech',
      baseUrl: 'http://127.0.0.1:8080/',
      referenceId: 'demo-speaker',
      referenceText: '你好，我是示例音色。',
      format: 'wav',
    },
    {}
  );

  assert.equal(request.url, 'http://127.0.0.1:8080/v1/tts');
  const body = JSON.parse(request.body);
  assert.equal(body.text, '你好，世界');
  assert.equal(body.reference_id, 'demo-speaker');
  assert.equal(body.reference_text, '你好，我是示例音色。');
  assert.equal(body.format, 'wav');
});

test('textToSpeech dispatches fish-speech provider through the router', async () => {
  const calls = [];
  const result = await textToSpeech('用 Fish Speech 合成', 'fish-output.wav', {
    provider: 'fish-speech',
    providerHandlers: {
      'fish-speech': async (text, outputPath, options) => {
        calls.push({ text, outputPath, options });
        return outputPath;
      },
    },
  });

  assert.equal(result, 'fish-output.wav');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, '用 Fish Speech 合成');
});
