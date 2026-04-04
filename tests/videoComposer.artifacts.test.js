import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { composeVideo } from '../src/agents/videoComposer.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { withManagedTempRoot } from './helpers/testArtifacts.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-video-composer-artifacts-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('video composer writes compose plan metrics and ffmpeg evidence on failure', async () => {
  await withTempRoot(async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_video_artifacts',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    const imagePath = path.join(tempRoot, 'shot_001.png');
    const audioPath = path.join(tempRoot, 'shot_001.mp3');
    const outputPath = path.join(tempRoot, 'output', 'final-video.mp4');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(imagePath, 'fake-image');
    fs.writeFileSync(audioPath, 'fake-audio');

    const failingError = new Error('ffmpeg failed');
    failingError.ffmpegCommand = 'ffmpeg -i input -vf ass=subtitle.ass output.mp4';
    failingError.ffmpegStderr = 'Invalid argument';

    await assert.rejects(
      () =>
        composeVideo(
          [{ id: 'shot_001', dialogue: '你好', durationSec: 3 }],
          [{ shotId: 'shot_001', imagePath, success: true }],
          [{ shotId: 'shot_001', audioPath }],
          outputPath,
          {
            artifactContext: ctx.agents.videoComposer,
            allowedRoots: [tempRoot],
            checkFFmpeg: async () => {},
            generateSubtitleFile: (_plan, subtitlePath) => {
              fs.writeFileSync(subtitlePath, 'fake subtitle');
            },
            mergeWithFFmpeg: async () => {
              throw failingError;
            },
          }
        ),
      /ffmpeg failed/
    );

    const composePlan = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.videoComposer.outputsDir, 'compose-plan.json'), 'utf-8')
    );
    assert.deepEqual(composePlan, [
      {
        shotId: 'shot_001',
        visualType: 'static_image',
        imagePath,
        audioPath,
        dialogue: '你好',
        duration: 3,
      },
    ]);

    const segmentIndex = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.videoComposer.outputsDir, 'segment-index.json'), 'utf-8')
    );
    assert.deepEqual(segmentIndex, [
      {
        shotId: 'shot_001',
        visualType: 'static_image',
        imagePath,
        audioPath,
        dialogue: '你好',
        duration: 3,
        segmentPath: path.join(outputPath.replace(/\.mp4$/i, '_segments'), '000_shot_001.mp4'),
      },
    ]);

    const metrics = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.videoComposer.metricsDir, 'video-metrics.json'), 'utf-8')
    );
    assert.deepEqual(metrics, {
      composed_shot_count: 1,
      subtitle_count: 1,
      total_duration_sec: 3,
      output_path: outputPath,
    });

    const commandText = fs.readFileSync(
      path.join(ctx.agents.videoComposer.errorsDir, 'ffmpeg-command.txt'),
      'utf-8'
    );
    const stderrText = fs.readFileSync(
      path.join(ctx.agents.videoComposer.errorsDir, 'ffmpeg-stderr.txt'),
      'utf-8'
    );
    assert.match(commandText, /ffmpeg -i input/);
    assert.match(stderrText, /Invalid argument/);

    const manifest = JSON.parse(fs.readFileSync(ctx.agents.videoComposer.manifestPath, 'utf-8'));
    assert.deepEqual(manifest, {
      status: 'failed',
      composedShotCount: 1,
      outputFiles: ['compose-plan.json', 'segment-index.json', 'video-metrics.json'],
    });
  });
});

test('video composer returns structured result with artifact index and delivery report on success', async () => {
  await withTempRoot(async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_video_success',
      startedAt: '2026-04-01T09:10:00.000Z',
    });

    const imagePath = path.join(tempRoot, 'shot_001.png');
    const audioPath = path.join(tempRoot, 'shot_001.mp3');
    const outputPath = path.join(tempRoot, 'output', 'final-video.mp4');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(imagePath, 'fake-image');
    fs.writeFileSync(audioPath, 'fake-audio');

    const result = await composeVideo(
      [{ id: 'shot_001', dialogue: '你好', durationSec: 3 }],
      [{ shotId: 'shot_001', imagePath, success: true }],
      [{ shotId: 'shot_001', audioPath }],
      outputPath,
      {
        artifactContext: ctx.agents.videoComposer,
        allowedRoots: [tempRoot],
        checkFFmpeg: async () => {},
        generateSubtitleFile: (_plan, subtitlePath) => {
          fs.writeFileSync(subtitlePath, 'fake subtitle');
        },
        mergeWithFFmpeg: async (_plan, _subtitlePath, targetOutputPath) => {
          fs.writeFileSync(targetOutputPath, 'fake-video');
        },
        ttsQaReport: {
          status: 'warn',
          warnings: ['镜头 shot_001 使用了 fallback voice'],
          manualReviewPlan: { recommendedShotIds: ['shot_001'] },
        },
        lipsyncReport: {
          status: 'warn',
          warnings: ['shot_001:manual_review_required_without_evaluator'],
          fallbackCount: 1,
          fallbackShots: ['shot_001'],
          downgradedCount: 0,
          manualReviewShots: ['shot_001'],
        },
      }
    );

    assert.equal(result.status, 'completed_with_warnings');
    assert.deepEqual(result.outputVideo, {
      type: 'video',
      uri: outputPath,
      format: 'mp4',
    });
    assert.deepEqual(result.artifacts, {
      composePlanUri: path.join(ctx.agents.videoComposer.outputsDir, 'compose-plan.json'),
      segmentIndexUri: path.join(ctx.agents.videoComposer.outputsDir, 'segment-index.json'),
      metricsUri: path.join(ctx.agents.videoComposer.metricsDir, 'video-metrics.json'),
      qaOverviewUri: path.join(ctx.agents.videoComposer.metricsDir, 'qa-summary.json'),
      ffmpegCommandUri: null,
      ffmpegStderrUri: null,
    });
    assert.deepEqual(result.report.manualReviewShots, ['shot_001']);
    assert.equal(result.report.fallbackCount, 1);
    assert.equal(result.report.qaSummary.lipsyncCoverage, 'warn');
    assert.equal(fs.existsSync(outputPath), true);
  });
});

test('video composer can render a playable mp4 with real ffmpeg inputs', async (t) => {
  await withManagedTempRoot(t, 'aivf-video-composer-real-render', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_real_render',
      projectName: '真实出片测试',
      scriptId: 'script_real_render',
      scriptTitle: '第一卷',
      episodeId: 'episode_real_render',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_video_real_render',
      startedAt: '2026-04-04T09:00:00.000Z',
    });

    const imagePath = path.join(tempRoot, 'shot_real_001.png');
    const outputPath = path.join(tempRoot, 'output', 'final-video.mp4');

    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 3,
        background: { r: 24, g: 32, b: 48 },
      },
    })
      .png()
      .toFile(imagePath);

    const result = await composeVideo(
      [{ id: 'shot_real_001', dialogue: '', durationSec: 1.2 }],
      [{ shotId: 'shot_real_001', imagePath, success: true }],
      [],
      outputPath,
      {
        artifactContext: ctx.agents.videoComposer,
        allowedRoots: [tempRoot],
      }
    );

    assert.equal(result.status, 'completed');
    assert.equal(fs.existsSync(outputPath), true);
    assert.ok(fs.statSync(outputPath).size > 1024);

    const fileHeader = fs.readFileSync(outputPath).subarray(0, 32).toString('latin1');
    assert.match(fileHeader, /ftyp/);
    assert.equal(fs.existsSync(path.join(ctx.agents.videoComposer.outputsDir, 'compose-plan.json')), true);
  });
});
