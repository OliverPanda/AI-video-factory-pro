/**
 * 图像生成Agent - 调用图像API批量生成分镜图，含并发控制和重试
 */

import path from 'path';
import { generateImage } from '../apis/imageApi.js';
import { imageQueue, queueWithRetry } from '../utils/queue.js';
import logger from '../utils/logger.js';

/**
 * 批量生成所有分镜图像
 * @param {Array<{shotId, image_prompt, negative_prompt}>} promptList - Prompt列表
 * @param {string} imagesDir - 图像保存目录
 * @param {Object} options - { style: 'realistic'|'3d' }
 * @returns {Promise<Array<{shotId, imagePath, success, error}>>}
 */
export async function generateAllImages(promptList, imagesDir, options = {}) {
  logger.info('ImageGenerator', `开始生成 ${promptList.length} 张分镜图像...`);
  const style = options.style || process.env.IMAGE_STYLE || 'realistic';

  const tasks = promptList.map((p) => ({
    shotId: p.shotId,
    prompt: p.image_prompt,
    negativePrompt: p.negative_prompt,
    outputPath: path.join(imagesDir, `${p.shotId}.png`),
  }));

  const results = await Promise.all(
    tasks.map((task, i) =>
      queueWithRetry(
        imageQueue,
        async () => {
          logger.step(i + 1, tasks.length, `生成图像: ${task.shotId}`);
          const imgPath = await generateImage(
            task.prompt,
            task.negativePrompt,
            task.outputPath,
            { style }
          );
          return { shotId: task.shotId, imagePath: imgPath, success: true };
        },
        3,
        task.shotId
      ).catch((err) => {
        logger.error('ImageGenerator', `${task.shotId} 生成失败：${err.message}`);
        return { shotId: task.shotId, imagePath: null, success: false, error: err.message };
      })
    )
  );

  const successCount = results.filter((r) => r.success).length;
  logger.info('ImageGenerator', `图像生成完成：${successCount}/${promptList.length} 成功`);

  return results;
}

/**
 * 重新生成指定分镜图像（一致性检查失败后调用）
 */
export async function regenerateImage(shotId, prompt, negativePrompt, imagesDir, options = {}) {
  logger.info('ImageGenerator', `重新生成图像：${shotId}`);
  const outputPath = path.join(imagesDir, `${shotId}.png`);
  return generateImage(prompt, negativePrompt, outputPath, options);
}
