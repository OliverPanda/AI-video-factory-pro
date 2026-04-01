import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../src/apis/ttsApi.js';

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
