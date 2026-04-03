import fs from 'node:fs';
import path from 'node:path';

import { createLipsyncClip } from '../apis/lipsyncApi.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import logger from '../utils/logger.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function normalizeCameraType(shot) {
  return String(shot?.camera_type || shot?.cameraType || shot?.camera || '').trim().toLowerCase();
}

function inferShotScale(shot) {
  const cameraType = normalizeCameraType(shot);
  if (shot?.isCloseUp === true || /特写|close[-_\s]?up|cu/.test(cameraType)) {
    return 'close_up';
  }
  if (/近景|中景|medium|mc|ms/.test(cameraType)) {
    return 'medium';
  }
  return 'other';
}

function getTriggerReasons(shot) {
  const reasons = [];
  const shotScale = inferShotScale(shot);

  if (shot.visualSpeechRequired === true) reasons.push('visual_speech_required');
  if (shot.isCloseUp === true || shotScale === 'close_up') reasons.push('close_up');
  if (shotScale === 'medium') reasons.push('medium_shot');
  if (shot.isKeyShot === true || shot.storyKey === true || shot.keyDialogue === true) {
    reasons.push('key_shot');
  }

  return Array.from(new Set(reasons));
}

export function shouldApplyLipsync(shot) {
  if (!shot?.dialogue || !String(shot.dialogue).trim()) {
    return false;
  }

  if (shot.visualSpeechRequired === true || shot.isCloseUp === true) {
    return true;
  }

  const cameraType = normalizeCameraType(shot);
  if (!cameraType) {
    return false;
  }

  return /特写|近景|中景|close[-_\s]?up|medium|cu|mc|ms/.test(cameraType);
}

function buildResultStatus(result) {
  if (result?.success === false) return 'failed';
  if (result?.videoPath) return 'completed';
  return 'skipped';
}

function resolveProviderFailureReason(error) {
  const category = String(error?.category || '').trim().toLowerCase();
  if (category) {
    return category;
  }

  const code = String(error?.code || '').trim().toUpperCase();
  if (code.includes('TIMEOUT')) {
    return 'timeout';
  }
  if (code.includes('NETWORK')) {
    return 'network_error';
  }
  if (code.includes('INVALID_RESPONSE')) {
    return 'invalid_response';
  }

  return 'provider_error';
}

function deriveEntryQa(result, shot) {
  const shotScale = inferShotScale(shot);
  const triggerReasons = getTriggerReasons(shot);
  const warnings = [];
  const blockers = [];
  const timingOffsetMs = Number.isFinite(result?.timingOffsetMs) ? result.timingOffsetMs : null;
  const manualReviewRequired =
    shotScale === 'close_up' ||
    triggerReasons.includes('key_shot') ||
    triggerReasons.includes('visual_speech_required');

  if (result.status === 'failed') {
    if (manualReviewRequired) {
      blockers.push('critical_lipsync_failed');
    } else {
      warnings.push('lipsync_failed_downgraded_to_standard_comp');
    }
  } else if (result.status === 'completed') {
    if (timingOffsetMs !== null) {
      const thresholdMs = shotScale === 'close_up' ? 60 : shotScale === 'medium' ? 80 : 120;
      if (timingOffsetMs > thresholdMs) {
        if (shotScale === 'close_up') {
          blockers.push(`timing_offset_exceeded_${thresholdMs}ms`);
        } else {
          warnings.push(`timing_offset_exceeded_${thresholdMs}ms`);
        }
      }
    } else if (manualReviewRequired) {
      warnings.push('manual_review_required_without_evaluator');
    }
  }

  return {
    shotScale,
    triggerReasons,
    manualReviewRequired,
    qaStatus: blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass',
    qaWarnings: warnings,
    qaBlockers: blockers,
  };
}

function writeArtifacts(report, results, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'lipsync.index.json'), results);
  saveJSON(path.join(artifactContext.metricsDir, 'lipsync-report.json'), report);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'lipsync-report.md'),
    [
      '| Shot ID | Triggered | Exec Status | QA Status | Review | Reason | Output |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...results.map((result) =>
        `| ${result.shotId} | ${result.triggered ? 'yes' : 'no'} | ${result.status} | ${result.qaStatus || ''} | ${result.manualReviewRequired ? 'yes' : 'no'} | ${result.reason || ''} | ${result.videoPath || ''} |`
      ),
    ].join('\n') + '\n'
  );

  for (const result of results.filter((item) => item.status === 'failed')) {
    saveJSON(path.join(artifactContext.errorsDir, `${result.shotId}-lipsync-error.json`), result);
  }

  saveJSON(artifactContext.manifestPath, {
    status: report.status,
    triggeredCount: report.triggeredCount,
    generatedCount: report.generatedCount,
    failedCount: report.failedCount,
    skippedCount: report.skippedCount,
    downgradedCount: report.downgradedCount,
    fallbackCount: report.fallbackCount,
    fallbackShots: report.fallbackShots,
    manualReviewCount: report.manualReviewCount,
    manualReviewShots: report.manualReviewShots,
    outputFiles: ['lipsync.index.json', 'lipsync-report.json', 'lipsync-report.md'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'lipsyncAgent',
      agentName: 'Lip-sync Agent',
      status: report.status,
      headline:
        report.status === 'pass'
          ? `已完成 ${report.generatedCount} 个口型镜头生成`
          : report.status === 'warn'
            ? `口型链路可继续，但有 ${report.warnings.length} 个风险提醒`
            : `口型链路被阻断，有 ${report.blockers.length} 个关键问题`,
      summary:
        report.status === 'pass'
          ? '当前口型镜头已达到最小可交付状态。'
          : report.status === 'warn'
            ? '部分镜头已降级或需要人工复核，但主链路仍可继续。'
            : '关键口型镜头存在阻断问题，建议先修复再交付。',
      passItems: [
        `触发镜头数：${report.triggeredCount}`,
        `成功生成数：${report.generatedCount}`,
      ],
      warnItems: report.warnings,
      blockItems: report.blockers,
      nextAction:
        report.status === 'pass'
          ? '可以继续进入最终视频合成。'
          : report.status === 'warn'
            ? '优先查看需要人工复核和发生 fallback 的镜头。'
            : '先修复阻断镜头，再重新运行口型同步。',
      evidenceFiles: [
        '2-metrics/lipsync-report.json',
        '1-outputs/lipsync-report.md',
        '1-outputs/lipsync.index.json',
      ],
      metrics: {
        triggeredCount: report.triggeredCount,
        generatedCount: report.generatedCount,
        failedCount: report.failedCount,
        fallbackCount: report.fallbackCount,
        manualReviewCount: report.manualReviewCount,
      },
    },
    artifactContext
  );
}

export async function runLipsync(shots, imageResults = [], audioResults = [], options = {}) {
  const {
    artifactContext,
    generateLipsyncClip = async (shot, imageResult, audioResult, runtimeOptions = {}) =>
      createLipsyncClip(
        {
          shotId: shot.id,
          dialogue: shot.dialogue || '',
          imagePath: imageResult?.imagePath || null,
          audioPath: audioResult?.audioPath || null,
          speaker: shot.speaker || null,
        },
        runtimeOptions.outputPathBuilder
          ? runtimeOptions.outputPathBuilder(shot)
          : path.join(process.env.TEMP_DIR || './temp', 'lipsync', `${shot.id}.mp4`),
        runtimeOptions
      ),
    shouldLipsyncShot = shouldApplyLipsync,
    outputPathBuilder = (shot) =>
      path.join(process.env.TEMP_DIR || './temp', 'lipsync', `${shot.id}.mp4`),
  } = options;

  const imageResultByShotId = new Map((imageResults || []).map((entry) => [entry.shotId, entry]));
  const audioResultByShotId = new Map((audioResults || []).map((entry) => [entry.shotId, entry]));
  const results = [];

  for (const shot of shots || []) {
    const triggered = shouldLipsyncShot(shot);
    const imageResult = imageResultByShotId.get(shot.id) || null;
    const audioResult = audioResultByShotId.get(shot.id) || null;

    if (!triggered) {
      results.push({
        shotId: shot.id,
        triggered: false,
        status: 'skipped',
        reason: 'rule_not_matched',
        triggerReasons: [],
        qaStatus: 'pass',
        qaWarnings: [],
        qaBlockers: [],
        manualReviewRequired: false,
        downgradeApplied: false,
        videoPath: null,
      });
      continue;
    }

    if (!imageResult?.imagePath) {
      const baseResult = {
        shotId: shot.id,
        triggered: true,
        status: 'failed',
        reason: 'missing_image',
        imagePath: null,
        audioPath: audioResult?.audioPath || null,
        videoPath: null,
        downgradeApplied: true,
        downgradeReason: 'missing_image',
      };
      results.push({
        ...baseResult,
        ...deriveEntryQa(baseResult, shot),
      });
      continue;
    }

    if (!audioResult?.audioPath) {
      const baseResult = {
        shotId: shot.id,
        triggered: true,
        status: 'failed',
        reason: 'missing_audio',
        imagePath: imageResult.imagePath,
        audioPath: null,
        videoPath: null,
        downgradeApplied: true,
        downgradeReason: 'missing_audio',
      };
      results.push({
        ...baseResult,
        ...deriveEntryQa(baseResult, shot),
      });
      continue;
    }

    try {
      const clip = await generateLipsyncClip(shot, imageResult, audioResult, {
        ...options,
        outputPathBuilder,
        outputPath: outputPathBuilder(shot),
      });
      const baseResult = {
        shotId: shot.id,
        triggered: true,
        status: buildResultStatus(clip),
        reason: clip?.reason || null,
        provider: clip?.provider || null,
        attemptedProviders: Array.isArray(clip?.attemptedProviders) ? clip.attemptedProviders : [],
        fallbackApplied: clip?.fallbackApplied === true,
        fallbackFrom: clip?.fallbackFrom || null,
        imagePath: imageResult.imagePath,
        audioPath: audioResult.audioPath,
        videoPath: clip?.videoPath || null,
        durationSec: clip?.durationSec || shot.durationSec || shot.duration || null,
        timingOffsetMs: Number.isFinite(clip?.timingOffsetMs) ? clip.timingOffsetMs : null,
        evaluator: clip?.evaluator || null,
        downgradeApplied: false,
        downgradeReason: null,
      };
      results.push({
        ...baseResult,
        ...deriveEntryQa(baseResult, shot),
      });
    } catch (error) {
      logger.error('LipsyncAgent', `${shot.id} 口型同步失败：${error.message}`);
      const failureReason = resolveProviderFailureReason(error);
      const baseResult = {
        shotId: shot.id,
        triggered: true,
        status: 'failed',
        reason: failureReason,
        imagePath: imageResult.imagePath,
        audioPath: audioResult.audioPath,
        videoPath: null,
        error: error.message,
        provider: error?.provider || null,
        errorCode: error?.code || null,
        attemptedProviders: Array.isArray(error?.attemptedProviders) ? error.attemptedProviders : [],
        providerErrors: Array.isArray(error?.providerErrors) ? error.providerErrors : [],
        fallbackApplied: false,
        fallbackFrom: null,
        downgradeApplied: true,
        downgradeReason: failureReason,
      };
      results.push({
        ...baseResult,
        ...deriveEntryQa(baseResult, shot),
      });
    }
  }

  const blockers = results
    .filter((item) => item.qaBlockers?.length)
    .flatMap((item) => item.qaBlockers.map((reason) => `${item.shotId}:${reason}`));
  const warnings = results
    .filter((item) => item.qaWarnings?.length)
    .flatMap((item) => item.qaWarnings.map((reason) => `${item.shotId}:${reason}`));
  const manualReviewShots = results
    .filter((item) => item.manualReviewRequired)
    .map((item) => item.shotId);
  const fallbackShots = results
    .filter((item) => item.fallbackApplied === true)
    .map((item) => item.shotId);

  const report = {
    status: blockers.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass',
    triggeredCount: results.filter((item) => item.triggered).length,
    generatedCount: results.filter((item) => item.status === 'completed').length,
    failedCount: results.filter((item) => item.status === 'failed').length,
    skippedCount: results.filter((item) => item.status === 'skipped').length,
    downgradedCount: results.filter((item) => item.downgradeApplied).length,
    fallbackCount: fallbackShots.length,
    fallbackShots,
    manualReviewCount: manualReviewShots.length,
    manualReviewShots,
    blockers,
    warnings,
    entries: results,
  };

  writeArtifacts(report, results, artifactContext);
  return {
    clips: results.filter((item) => item.videoPath),
    report,
    results,
  };
}

export const __testables = {
  shouldApplyLipsync,
  resolveProviderFailureReason,
};
