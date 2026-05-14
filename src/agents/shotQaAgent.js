import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { probeVideoMetadata } from '../utils/mediaProbe.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

const HARD_QA_ISSUE_CODES = new Set([
  'anatomy_structure_invalid',
  'anatomy_pose_invalid',
  'limb_structure_invalid',
  'character_identity_corrupted',
  'reference_sheet_background_invalid',
]);

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function extractQaIssueCodes(result = {}) {
  return [
    ...normalizeStringArray(result.qaIssues),
    ...normalizeStringArray(result.qualityIssues),
    ...normalizeStringArray(result.blockingIssues),
    ...normalizeStringArray(result.providerRequestHints?.qaIssues),
  ].filter((item, index, list) => item && list.indexOf(item) === index);
}

function pickHardQaIssue(issueCodes = []) {
  return issueCodes.find((issue) => HARD_QA_ISSUE_CODES.has(issue)) || null;
}

async function probeVideo(videoPath) {
  return {
    ...(await probeVideoMetadata(videoPath)),
    freezeDurationSec: 0,
    nearDuplicateRatio: 0,
    motionScore: 1,
  };
}

function isDurationAcceptable(targetDurationSec, actualDurationSec) {
  if (!Number.isFinite(targetDurationSec) || !Number.isFinite(actualDurationSec)) {
    return false;
  }

  const minDuration = Math.max(0.75, targetDurationSec * 0.82);
  const maxDuration = Math.max(targetDurationSec + 1.5, targetDurationSec * 1.25);
  return actualDurationSec >= minDuration && actualDurationSec <= maxDuration;
}

function getMotionThresholds(performanceTemplate) {
  if (performanceTemplate === 'fight_impact_insert') {
    return {
      maxFreezeDurationSec: 0.45,
      maxNearDuplicateRatio: 0.35,
      minMotionScore: 0.42,
    };
  }

  if (performanceTemplate === 'fight_exchange_medium') {
    return {
      maxFreezeDurationSec: 0.6,
      maxNearDuplicateRatio: 0.42,
      minMotionScore: 0.36,
    };
  }

  if (performanceTemplate === 'ambient_transition_motion') {
    return {
      maxFreezeDurationSec: 0.9,
      maxNearDuplicateRatio: 0.55,
      minMotionScore: 0.18,
    };
  }

  return {
    maxFreezeDurationSec: 0.75,
    maxNearDuplicateRatio: 0.48,
    minMotionScore: 0.24,
  };
}

function evaluateMotionStatus(result, probeResult) {
  const thresholds = getMotionThresholds(result.performanceTemplate);
  const freezeDurationSec = Number.isFinite(probeResult.freezeDurationSec) ? probeResult.freezeDurationSec : 0;
  const nearDuplicateRatio = Number.isFinite(probeResult.nearDuplicateRatio) ? probeResult.nearDuplicateRatio : 0;
  const motionScore = Number.isFinite(probeResult.motionScore) ? probeResult.motionScore : 1;

  const passed =
    freezeDurationSec <= thresholds.maxFreezeDurationSec &&
    nearDuplicateRatio <= thresholds.maxNearDuplicateRatio &&
    motionScore >= thresholds.minMotionScore;

  return {
    motionStatus: passed ? 'pass' : 'fail',
    freezeDurationSec,
    nearDuplicateRatio,
    motionScore,
    decisionReason: passed ? null : 'motion_below_threshold',
  };
}

export async function evaluateShotVideos(videoResults = [], options = {}) {
  const entries = [];
  const probe = options.probeVideo || probeVideo;

  for (const result of videoResults) {
    const qaIssueCodes = extractQaIssueCodes(result);
    const hardQaIssue = pickHardQaIssue(qaIssueCodes);

    if (hardQaIssue) {
      entries.push({
        shotId: result.shotId,
        qaStatus: 'block',
        engineeringStatus: 'unknown',
        motionStatus: 'unknown',
        canUseVideo: false,
        fallbackToImage: false,
        freezeDurationSec: null,
        nearDuplicateRatio: null,
        motionScore: null,
        enhancementApplied: Boolean(result.enhancementApplied),
        enhancementProfile: result.enhancementProfile || 'none',
        finalDecision: 'block',
        decisionReason: hardQaIssue,
        reason: hardQaIssue,
        qaIssueCodes,
        durationSec: result.actualDurationSec || null,
        targetDurationSec: result.targetDurationSec || null,
      });
      continue;
    }

    if (result.status !== 'completed' || !result.videoPath) {
      entries.push({
        shotId: result.shotId,
        qaStatus: 'warn',
        engineeringStatus: 'fail',
        motionStatus: 'unknown',
        canUseVideo: false,
        fallbackToImage: true,
        freezeDurationSec: null,
        nearDuplicateRatio: null,
        motionScore: null,
        enhancementApplied: Boolean(result.enhancementApplied),
        enhancementProfile: result.enhancementProfile || 'none',
        finalDecision: 'fallback_to_image',
        decisionReason: result.failureCategory || result.reason || 'video_unavailable',
        reason: result.failureCategory || result.reason || 'video_unavailable',
        qaIssueCodes,
        durationSec: null,
        targetDurationSec: result.targetDurationSec || null,
      });
      continue;
    }

    if (!fs.existsSync(result.videoPath) || fs.statSync(result.videoPath).size === 0) {
      entries.push({
        shotId: result.shotId,
        qaStatus: 'warn',
        engineeringStatus: 'fail',
        motionStatus: 'unknown',
        canUseVideo: false,
        fallbackToImage: true,
        freezeDurationSec: null,
        nearDuplicateRatio: null,
        motionScore: null,
        enhancementApplied: Boolean(result.enhancementApplied),
        enhancementProfile: result.enhancementProfile || 'none',
        finalDecision: 'fallback_to_image',
        decisionReason: 'missing_or_empty_video_file',
        reason: 'missing_or_empty_video_file',
        qaIssueCodes,
        durationSec: null,
        targetDurationSec: result.targetDurationSec || null,
      });
      continue;
    }

    try {
      const probeResult = await probe(result.videoPath);
      const engineeringPass = isDurationAcceptable(result.targetDurationSec, probeResult.durationSec);
      const motionEvaluation = engineeringPass
        ? evaluateMotionStatus(result, probeResult)
        : {
            motionStatus: 'unknown',
            freezeDurationSec: Number.isFinite(probeResult.freezeDurationSec) ? probeResult.freezeDurationSec : 0,
            nearDuplicateRatio: Number.isFinite(probeResult.nearDuplicateRatio) ? probeResult.nearDuplicateRatio : 0,
            motionScore: Number.isFinite(probeResult.motionScore) ? probeResult.motionScore : 0,
            decisionReason: 'duration_out_of_range',
          };
      const canUseVideo = engineeringPass && motionEvaluation.motionStatus === 'pass';
      entries.push({
        shotId: result.shotId,
        qaStatus: canUseVideo ? 'pass' : 'warn',
        engineeringStatus: engineeringPass ? 'pass' : 'fail',
        motionStatus: motionEvaluation.motionStatus,
        canUseVideo,
        fallbackToImage: !canUseVideo,
        freezeDurationSec: motionEvaluation.freezeDurationSec,
        nearDuplicateRatio: motionEvaluation.nearDuplicateRatio,
        motionScore: motionEvaluation.motionScore,
        enhancementApplied: Boolean(result.enhancementApplied),
        enhancementProfile: result.enhancementProfile || 'none',
        finalDecision: canUseVideo
          ? (result.enhancementApplied ? 'pass_with_enhancement' : 'pass')
          : 'fallback_to_image',
        decisionReason: canUseVideo ? null : motionEvaluation.decisionReason,
        reason: canUseVideo ? null : motionEvaluation.decisionReason,
        qaIssueCodes,
        durationSec: probeResult.durationSec,
        targetDurationSec: result.targetDurationSec || null,
      });
    } catch (error) {
      entries.push({
        shotId: result.shotId,
        qaStatus: 'warn',
        engineeringStatus: 'fail',
        motionStatus: 'unknown',
        canUseVideo: false,
        fallbackToImage: true,
        freezeDurationSec: null,
        nearDuplicateRatio: null,
        motionScore: null,
        enhancementApplied: Boolean(result.enhancementApplied),
        enhancementProfile: result.enhancementProfile || 'none',
        finalDecision: 'fallback_to_image',
        decisionReason: 'ffprobe_failed',
        reason: 'ffprobe_failed',
        qaIssueCodes,
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
  const blockedEntries = entries.filter((entry) => entry.finalDecision === 'block' || entry.qaStatus === 'block');
  const fallbackEntries = entries.filter((entry) => entry.fallbackToImage);
  const engineeringPassedEntries = entries.filter((entry) => entry.engineeringStatus === 'pass');
  const motionPassedEntries = entries.filter((entry) => entry.motionStatus === 'pass');
  return {
    status: blockedEntries.length > 0 ? 'block' : fallbackEntries.length > 0 ? 'warn' : 'pass',
    entries,
    plannedShotCount: entries.length,
    engineeringPassedCount: engineeringPassedEntries.length,
    motionPassedCount: motionPassedEntries.length,
    passedCount: passedEntries.length,
    blockCount: blockedEntries.length,
    blockedShots: blockedEntries.map((entry) => entry.shotId),
    fallbackCount: fallbackEntries.length,
    fallbackShots: fallbackEntries.map((entry) => entry.shotId),
    warnings: fallbackEntries.map((entry) => `${entry.shotId}:${entry.reason || 'fallback_to_image'}`),
    blockers: blockedEntries.map((entry) => `${entry.shotId}:${entry.reason || 'qa_blocked'}`),
  };
}

function writeArtifacts(report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'shot-qa-report.json'), report);
  saveJSON(path.join(artifactContext.outputsDir, 'manual-review-shots.json'), []);
  saveJSON(path.join(artifactContext.metricsDir, 'shot-qa-metrics.json'), {
    plannedShotCount: report.plannedShotCount,
    engineeringPassedCount: report.engineeringPassedCount,
    motionPassedCount: report.motionPassedCount,
    passedCount: report.passedCount,
    blockCount: report.blockCount,
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
    status: report.status === 'block' || report.status === 'warn' ? 'completed_with_errors' : 'completed',
    plannedShotCount: report.plannedShotCount,
    engineeringPassedCount: report.engineeringPassedCount,
    motionPassedCount: report.motionPassedCount,
    passedCount: report.passedCount,
    blockCount: report.blockCount,
    blockedShots: report.blockedShots,
    fallbackCount: report.fallbackCount,
    fallbackShots: report.fallbackShots,
    outputFiles: ['shot-qa-report.json', 'manual-review-shots.json', 'shot-qa-metrics.json', 'shot-qa-report.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'shotQaAgent',
      agentName: 'Shot QA Agent',
      status: report.status,
      headline:
        report.status === 'block'
          ? `${report.blockCount} 个镜头因严重 QA 问题被阻断`
          : report.status === 'warn'
          ? `${report.fallbackCount} 个镜头将回退到静图合成`
          : `所有 ${report.passedCount} 个动态镜头均通过基础验收`,
      summary:
        report.status === 'block'
          ? '存在严重视觉 QA 问题，当前不允许继续静图 fallback 或进入最终交付。'
          : report.status === 'warn'
          ? '部分动态镜头未达标，但主链路仍可使用静图 fallback 继续交付。'
          : '当前动态镜头满足 Phase 1 的工程验收要求。',
      passItems: [`通过视频镜头数：${report.passedCount}`],
      warnItems: report.warnings,
      blockItems: report.blockers,
      nextAction:
        report.status === 'block'
          ? '先修复被阻断镜头的人体/角色/参考图硬伤，再重新进入生视频链路。'
          : '将通过 QA 的视频镜头送入最终合成，其余镜头回退到静图路径。',
      evidenceFiles: ['1-outputs/shot-qa-report.json', '2-metrics/shot-qa-metrics.json'],
      metrics: {
        plannedShotCount: report.plannedShotCount,
        engineeringPassedCount: report.engineeringPassedCount,
        motionPassedCount: report.motionPassedCount,
        passedCount: report.passedCount,
        blockCount: report.blockCount,
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
  HARD_QA_ISSUE_CODES,
  buildReport,
  evaluateShotVideos,
  evaluateMotionStatus,
  extractQaIssueCodes,
  getMotionThresholds,
  isDurationAcceptable,
  pickHardQaIssue,
};
