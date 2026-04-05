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

  const minDuration = Math.max(0.5, targetDurationSec * 0.7);
  const maxDuration = Math.max(3, targetDurationSec * 1.5);
  return actualDurationSec >= minDuration && actualDurationSec <= maxDuration;
}

function defaultContinuityEvaluation() {
  return {
    continuityStatus: 'pass',
    transitionSmoothness: 'pass',
    identityDriftRisk: 'low',
    cameraAxisStatus: 'pass',
  };
}

function decideFinalAction(continuityEvaluation) {
  if (
    continuityEvaluation.continuityStatus === 'fail' ||
    continuityEvaluation.identityDriftRisk === 'high' ||
    continuityEvaluation.cameraAxisStatus === 'fail'
  ) {
    return {
      finalDecision: 'fallback_to_direct_cut',
      decisionReason: 'continuity_break',
    };
  }

  if (
    continuityEvaluation.continuityStatus === 'warn' &&
    continuityEvaluation.transitionSmoothness === 'warn' &&
    continuityEvaluation.identityDriftRisk === 'low' &&
    continuityEvaluation.cameraAxisStatus === 'pass'
  ) {
    return {
      finalDecision: 'fallback_to_transition_stub',
      decisionReason: 'transition_stub_preferred',
    };
  }

  if (
    continuityEvaluation.continuityStatus === 'warn' ||
    continuityEvaluation.identityDriftRisk === 'medium' ||
    continuityEvaluation.cameraAxisStatus === 'warn'
  ) {
    return {
      finalDecision: 'manual_review',
      decisionReason: 'continuity_needs_review',
    };
  }

  return {
    finalDecision: 'pass',
    decisionReason: null,
  };
}

export async function evaluateBridgeClips(bridgeClipResults = [], options = {}) {
  const entries = [];
  const probe = options.probeVideo || probeVideo;
  const evaluateContinuity = options.evaluateContinuity || (async () => defaultContinuityEvaluation());

  for (const result of bridgeClipResults) {
    if (result.status !== 'completed' || !result.videoPath) {
      entries.push({
        bridgeId: result.bridgeId,
        engineeringStatus: 'fail',
        continuityStatus: 'unknown',
        transitionSmoothness: 'unknown',
        identityDriftRisk: 'unknown',
        cameraAxisStatus: 'unknown',
        finalDecision: 'fallback_to_direct_cut',
        decisionReason: result.failureCategory || result.reason || 'bridge_unavailable',
        durationSec: null,
        targetDurationSec: result.targetDurationSec || null,
      });
      continue;
    }

    if (!fs.existsSync(result.videoPath) || fs.statSync(result.videoPath).size === 0) {
      entries.push({
        bridgeId: result.bridgeId,
        engineeringStatus: 'fail',
        continuityStatus: 'unknown',
        transitionSmoothness: 'unknown',
        identityDriftRisk: 'unknown',
        cameraAxisStatus: 'unknown',
        finalDecision: 'fallback_to_direct_cut',
        decisionReason: 'missing_or_empty_video_file',
        durationSec: null,
        targetDurationSec: result.targetDurationSec || null,
      });
      continue;
    }

    try {
      const probeResult = await probe(result.videoPath);
      const engineeringPass = isDurationAcceptable(result.targetDurationSec, probeResult.durationSec);
      if (!engineeringPass) {
        entries.push({
          bridgeId: result.bridgeId,
          engineeringStatus: 'fail',
          continuityStatus: 'unknown',
          transitionSmoothness: 'unknown',
          identityDriftRisk: 'unknown',
          cameraAxisStatus: 'unknown',
          finalDecision: 'fallback_to_direct_cut',
          decisionReason: 'duration_out_of_range',
          durationSec: probeResult.durationSec,
          targetDurationSec: result.targetDurationSec || null,
        });
        continue;
      }

      const continuityEvaluation = {
        ...defaultContinuityEvaluation(),
        ...(await evaluateContinuity(result, options)),
      };
      const finalDecision = decideFinalAction(continuityEvaluation);
      entries.push({
        bridgeId: result.bridgeId,
        engineeringStatus: 'pass',
        continuityStatus: continuityEvaluation.continuityStatus,
        transitionSmoothness: continuityEvaluation.transitionSmoothness,
        identityDriftRisk: continuityEvaluation.identityDriftRisk,
        cameraAxisStatus: continuityEvaluation.cameraAxisStatus,
        finalDecision: finalDecision.finalDecision,
        decisionReason: finalDecision.decisionReason,
        durationSec: probeResult.durationSec,
        targetDurationSec: result.targetDurationSec || null,
      });
    } catch (error) {
      entries.push({
        bridgeId: result.bridgeId,
        engineeringStatus: 'fail',
        continuityStatus: 'unknown',
        transitionSmoothness: 'unknown',
        identityDriftRisk: 'unknown',
        cameraAxisStatus: 'unknown',
        finalDecision: 'fallback_to_direct_cut',
        decisionReason: 'ffprobe_failed',
        durationSec: null,
        targetDurationSec: result.targetDurationSec || null,
        error: error.message,
      });
    }
  }

  return entries;
}

function buildReport(entries = []) {
  const passedEntries = entries.filter((entry) => entry.finalDecision === 'pass');
  const fallbackEntries = entries.filter(
    (entry) =>
      entry.finalDecision === 'fallback_to_direct_cut' || entry.finalDecision === 'fallback_to_transition_stub'
  );
  const manualReviewEntries = entries.filter((entry) => entry.finalDecision === 'manual_review');
  return {
    status: fallbackEntries.length > 0 || manualReviewEntries.length > 0 ? 'warn' : 'pass',
    entries,
    passedCount: passedEntries.length,
    fallbackCount: fallbackEntries.length,
    manualReviewCount: manualReviewEntries.length,
    warnings: entries
      .filter((entry) => entry.finalDecision !== 'pass')
      .map((entry) => `${entry.bridgeId}:${entry.decisionReason || entry.finalDecision}`),
    blockers: [],
  };
}

function writeArtifacts(report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'bridge-qa-report.json'), report);
  saveJSON(path.join(artifactContext.metricsDir, 'bridge-qa-metrics.json'), {
    passedCount: report.passedCount,
    fallbackCount: report.fallbackCount,
    manualReviewCount: report.manualReviewCount,
  });
  writeTextFile(
    path.join(artifactContext.outputsDir, 'bridge-qa-report.md'),
    [
      '| Bridge ID | Engineering | Continuity | Decision | Reason | Duration | Target |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...report.entries.map((entry) =>
        `| ${entry.bridgeId} | ${entry.engineeringStatus} | ${entry.continuityStatus} | ${entry.finalDecision} | ${entry.decisionReason || ''} | ${entry.durationSec || ''} | ${entry.targetDurationSec || ''} |`
      ),
      '',
    ].join('\n')
  );
  saveJSON(artifactContext.manifestPath, {
    status: report.status === 'warn' ? 'completed_with_errors' : 'completed',
    passedCount: report.passedCount,
    fallbackCount: report.fallbackCount,
    manualReviewCount: report.manualReviewCount,
    outputFiles: ['bridge-qa-report.json', 'bridge-qa-metrics.json', 'bridge-qa-report.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'bridgeQaAgent',
      agentName: 'Bridge QA Agent',
      status: report.status,
      headline:
        report.status === 'warn'
          ? `有 ${report.fallbackCount} 个 bridge clip 需回退，${report.manualReviewCount} 个需人工复核`
          : `所有 ${report.passedCount} 个 bridge clip 通过基础验收`,
      summary:
        report.status === 'warn'
          ? '部分 bridge clip 未通过工程或连续性验收，但主时间线仍可回退为 direct cut 或 transition stub。'
          : '当前 bridge clip 满足 Phase 3 MVP 的工程验收要求。',
      passItems: [`通过 bridge clip 数：${report.passedCount}`],
      warnItems: report.warnings,
      nextAction: '仅将通过桥接 QA 的片段写入最终时间线，其余片段执行回退策略。',
      evidenceFiles: ['1-outputs/bridge-qa-report.json', '2-metrics/bridge-qa-metrics.json'],
      metrics: {
        passedCount: report.passedCount,
        fallbackCount: report.fallbackCount,
        manualReviewCount: report.manualReviewCount,
      },
    },
    artifactContext
  );
}

export async function runBridgeQa(bridgeClipResults = [], options = {}) {
  const entries = await evaluateBridgeClips(bridgeClipResults, options);
  const report = buildReport(entries);
  writeArtifacts(report, options.artifactContext);
  return report;
}

export const __testables = {
  buildReport,
  decideFinalAction,
  evaluateBridgeClips,
  isDurationAcceptable,
};

export default {
  runBridgeQa,
};
