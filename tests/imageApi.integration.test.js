import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateImage, resolveImageRoute, resolveImageTaskType } from '../src/apis/imageApi.js';

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-api-integration-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test(
  '真实图像 provider 可以生成图片并成功落盘',
  { timeout: 180000 },
  async (t) => {
    assert.ok(process.env.LAOZHANG_API_KEY, '缺少 LAOZHANG_API_KEY');

    const tempDir = makeTempDir(t);
    const outputPath = path.join(tempDir, 'integration-result.png');
    const env = {
      ...process.env,
      VIDEO_WIDTH: '512',
      VIDEO_HEIGHT: '512',
    };

    const taskType = resolveImageTaskType({ style: 'realistic' });
    const route = resolveImageRoute(taskType, env);
    const savedPath = await generateImage(
      'A cozy cafe interior, soft afternoon light, one young woman sitting by the window, realistic photography',
      'blurry, extra limbs, watermark, text',
      outputPath,
      { style: 'realistic', env }
    );

    assert.equal(savedPath, outputPath);
    assert.equal(route.provider, 'laozhang');
    assert.equal(fs.existsSync(outputPath), true);

    const stat = fs.statSync(outputPath);
    assert.ok(stat.size > 0, '生成结果文件为空');
  }
);
