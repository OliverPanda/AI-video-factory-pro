import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

const execFileAsync = promisify(execFile);

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

async function probeVideo(videoPath) {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ],
    { windowsHide: true }
  );

  const durationSec = Number.parseFloat(String(stdout || '').trim());
  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : null,
  };
}

function isDurationAcceptable(targetDurationSec, actualDurationSec) {
  if (!Number.isFinite(targetDurationSec) || !Number.isFinite(actualDurationSec)) {
    return false;
  }

  const minDuration = Math.max(0.5, targetDurationSec * 0.6);
  const maxDuration = Math.max(targetDurationSec + 5, targetDurationSec * 2.5);
  return actualDurationSec >= minDuration && actualDurationSec <= maxDuration;
}

export async function evaluateShotVideos(videoResults = [], options = {}) {
  const entries = [];
  const probe = options.probeVideo || probeVideo;

  for (const result of videoResults) {
    if (result.status !== 'completed' || !result.videoPath) {
      entries.push({
        shotId: result.shotId,
        qaStatus: 'warn',
        canUseVideo: false,
        fallbackToImage: true,
        reason: result.failureCategory || result.reason || 'video_unavailable',
        durationSec: null,
        targetDurationSec: result.targetDurationSec || null,
      });
      continue;
    }

    if (!fs.existsSync(result.videoPath) || fs.statSync(result.videoPath).size === 0) {
      entries.push({
        shotId: result.shotId,
        qaStatus: 'warn',
        canUseVideo: false,
        fallbackToImage: true,
        reason: 'missing_or_empty_video_file',
        durationSec: null,
        targetDurationSec: result.targetDurationSec || null,
      });
      continue;
    }

    try {
      const probeResult = await probe(result.videoPath);
      const acceptable = isDurationAcceptable(result.targetDurationSec, probeResult.durationSec);
      entries.push({
        shotId: result.shotId,
        qaStatus: acceptable ? 'pass' : 'warn',
        canUseVideo: acceptable,
        fallbackToImage: !acceptable,
        reason: acceptable ? null : 'duration_out_of_range',
        durationSec: probeResult.durationSec,
        targetDurationSec: result.targetDurationSec || null,
      });
    } catch (error) {
      entries.push({
        shotId: result.shotId,
        qaStatus: 'warn',
        canUseVideo: false,
        fallbackToImage: true,
        reason: 'ffprobe_failed',
        durationSec: null,
        targetDurationSec: result.targetDurationSec || null,
        error: error.message,
      });
    }
  }

  return entries;
}

function buildReport(entries) {
  const passedEntries = entries.filter((entry) => entry.canUseVideo);
  const fallbackEntries = entries.filter((entry) => entry.fallbackToImage);
  return {
    status: fallbackEntries.length > 0 ? 'warn' : 'pass',
    entries,
    plannedShotCount: entries.length,
    passedCount: passedEntries.length,
    fallbackCount: fallbackEntries.length,
    fallbackShots: fallbackEntries.map((entry) => entry.shotId),
    warnings: fallbackEntries.map((entry) => `${entry.shotId}:${entry.reason || 'fallback_to_image'}`),
    blockers: [],
  };
}

function writeArtifacts(report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'shot-qa-report.json'), report);
  saveJSON(path.join(artifactContext.metricsDir, 'shot-qa-metrics.json'), {
    plannedShotCount: report.plannedShotCount,
    passedCount: report.passedCount,
    fallbackCount: report.fallbackCount,
  });
  writeTextFile(
    path.join(artifactContext.outputsDir, 'shot-qa-report.md'),
    [
      '| Shot ID | QA Status | Use Video | Fallback | Reason | Duration | Target |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...report.entries.map((entry) =>
        `| ${entry.shotId} | ${entry.qaStatus} | ${entry.canUseVideo ? 'yes' : 'no'} | ${entry.fallbackToImage ? 'yes' : 'no'} | ${entry.reason || ''} | ${entry.durationSec || ''} | ${entry.targetDurationSec || ''} |`
      ),
      '',
    ].join('\n')
  );
  saveJSON(artifactContext.manifestPath, {
    status: report.status === 'warn' ? 'completed_with_errors' : 'completed',
    plannedShotCount: report.plannedShotCount,
    passedCount: report.passedCount,
    fallbackCount: report.fallbackCount,
    fallbackShots: report.fallbackShots,
    outputFiles: ['shot-qa-report.json', 'shot-qa-metrics.json', 'shot-qa-report.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'shotQaAgent',
      agentName: 'Shot QA Agent',
      status: report.status,
      headline:
        report.status === 'warn'
          ? `${report.fallbackCount} 个镜头将回退到静图合成`
          : `所有 ${report.passedCount} 个动态镜头均通过基础验收`,
      summary:
        report.status === 'warn'
          ? '部分动态镜头未达标，但主链路仍可使用静图 fallback 继续交付。'
          : '当前动态镜头满足 Phase 1 的工程验收要求。',
      passItems: [`通过视频镜头数：${report.passedCount}`],
      warnItems: report.warnings,
      nextAction: '将通过 QA 的视频镜头送入最终合成，其余镜头回退到静图路径。',
      evidenceFiles: ['1-outputs/shot-qa-report.json', '2-metrics/shot-qa-metrics.json'],
      metrics: {
        plannedShotCount: report.plannedShotCount,
        passedCount: report.passedCount,
        fallbackCount: report.fallbackCount,
      },
    },
    artifactContext
  );
}

export async function runShotQa(videoResults = [], options = {}) {
  const entries = await evaluateShotVideos(videoResults, options);
  const report = buildReport(entries);
  writeArtifacts(report, options.artifactContext);
  return report;
}

export const __testables = {
  buildReport,
  evaluateShotVideos,
  isDurationAcceptable,
};
