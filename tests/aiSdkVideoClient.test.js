/**
 * AI SDK 视频客户端单元测试
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldUseAiSdk,
  generateVideoClip,
  createAiSdkVideoClient,
  __testables,
} from '../src/apis/aiSdkVideoClient.js';

const { parseAiSdkModel, normalizePrompt, resolveReferenceImage, AI_SDK_VIDEO_MODELS } = __testables;

describe('aiSdkVideoClient', () => {
  describe('parseAiSdkModel', () => {
    it('应解析 fal/minimax-video', () => {
      const result = parseAiSdkModel('fal/minimax-video');
      assert.deepEqual(result, { provider: 'fal', modelId: 'minimax-video' });
    });

    it('应解析 google/veo-3.1', () => {
      const result = parseAiSdkModel('google/veo-3.1');
      assert.deepEqual(result, { provider: 'google', modelId: 'veo-3.1-generate-001' });
    });

    it('应解析 openai/sora-2', () => {
      const result = parseAiSdkModel('openai/sora-2');
      assert.deepEqual(result, { provider: 'openai', modelId: 'sora-2' });
    });

    it('应解析直接格式 klingai/kling-v2.6-t2v', () => {
      const result = parseAiSdkModel('klingai/kling-v2.6-t2v');
      assert.deepEqual(result, { provider: 'klingai', modelId: 'kling-v2.6-t2v' });
    });

    it('空值应返回 null', () => {
      assert.equal(parseAiSdkModel(null), null);
      assert.equal(parseAiSdkModel(''), null);
    });

    it('无效格式应返回 null', () => {
      assert.equal(parseAiSdkModel('invalid'), null);
    });
  });

  describe('shouldUseAiSdk', () => {
    it('应返回 true 当 VIDEO_MODEL 是 fal/* 格式', () => {
      assert.equal(shouldUseAiSdk({ VIDEO_MODEL: 'fal/minimax-video' }), true);
    });

    it('应返回 true 当 VIDEO_MODEL 是 google/* 格式', () => {
      assert.equal(shouldUseAiSdk({ VIDEO_MODEL: 'google/veo-3.1' }), true);
    });

    it('应返回 true 当 VIDEO_MODEL 是 openai/* 格式', () => {
      assert.equal(shouldUseAiSdk({ VIDEO_MODEL: 'openai/sora-2' }), true);
    });

    it('应返回 false 当 VIDEO_MODEL 未设置', () => {
      assert.equal(shouldUseAiSdk({}), false);
    });

    it('应返回 false 当 VIDEO_MODEL 是旧格式', () => {
      assert.equal(shouldUseAiSdk({ VIDEO_MODEL: 'happyhorse-1.0-r2v' }), false);
    });
  });

  describe('normalizePrompt', () => {
    it('应从 seedancePromptBlocks 提取 prompt', () => {
      const pkg = {
        seedancePromptBlocks: [
          { text: '一个女孩' },
          { text: '在樱花树下' },
        ],
      };
      assert.equal(normalizePrompt(pkg), '一个女孩. 在樱花树下');
    });

    it('应从 promptDirectives 提取 prompt', () => {
      const pkg = {
        promptDirectives: ['奔跑', '微笑'],
      };
      assert.equal(normalizePrompt(pkg), '奔跑. 微笑');
    });

    it('应从 visualGoal 等字段提取 prompt', () => {
      const pkg = {
        visualGoal: '女孩奔跑',
        sequenceContextSummary: '春天场景',
      };
      assert.equal(normalizePrompt(pkg), '女孩奔跑. 春天场景');
    });

    it('空对象应返回空字符串', () => {
      assert.equal(normalizePrompt({}), '');
    });
  });

  describe('resolveReferenceImage', () => {
    it('应返回 url 如果没有 path', async () => {
      const pkg = {
        referenceImages: [{ url: 'https://example.com/ref.jpg' }],
      };
      assert.equal(await resolveReferenceImage(pkg), 'https://example.com/ref.jpg');
    });

    it('无参考图应返回 null', async () => {
      assert.equal(await resolveReferenceImage({}), null);
      assert.equal(await resolveReferenceImage({ referenceImages: [] }), null);
    });
  });

  describe('createAiSdkVideoClient', () => {
    it('应返回 submit/poll/download 方法', () => {
      const client = createAiSdkVideoClient({ env: { VIDEO_MODEL: 'fal/minimax-video' } });
      assert.equal(typeof client.submit, 'function');
      assert.equal(typeof client.poll, 'function');
      assert.equal(typeof client.download, 'function');
    });

    it('submit 应返回正确的结构', async () => {
      const client = createAiSdkVideoClient({ env: { VIDEO_MODEL: 'fal/minimax-video' } });
      const pkg = {
        visualGoal: '测试视频',
        cameraSpec: { ratio: '16:9' },
        durationTargetSec: 5,
      };

      const result = await client.submit(pkg, '/tmp/test.mp4');

      assert.equal(result.provider, 'ai_sdk');
      assert.equal(result.model, 'fal/minimax-video');
      assert.equal(result.transport, 'ai_sdk');
      assert.ok(result.taskId.startsWith('ai_sdk_'));
      assert.equal(result.providerMetadata.aiSdk, true);
    });
  });
});
