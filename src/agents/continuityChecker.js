import fs from 'node:fs';
import path from 'node:path';
import { saveJSON } from '../utils/fileHelper.js';
import logger from '../utils/logger.js';

function writeTextFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildContinuityPairs(shots = [], imageResults = []) {
  const shotMap = new Map(shots.map((shot) => [shot.id, shot]));
  const imageMap = new Map(imageResults.filter((item) => item?.success !== false).map((item) => [item.shotId, item]));

  return shots
    .map((shot, index) => {
      const previousShotId =
        shot?.continuityState?.carryOverFromShotId ??
        shot?.continuitySourceShotId ??
        shots[index - 1]?.id ??
        null;
      if (!previousShotId) {
        return null;
      }

      const previousShot = shotMap.get(previousShotId) ?? null;
      const currentImage = imageMap.get(shot.id) ?? null;
      const previousImage = imageMap.get(previousShotId) ?? null;
      if (!previousShot || !currentImage || !previousImage) {
        return null;
      }

      return {
        previousShot,
        currentShot: shot,
        previousImage,
        currentImage,
      };
    })
    .filter(Boolean);
}

export async function checkShotContinuity(previousShot, currentShot, previousImage, currentImage, options = {}) {
  if (typeof options.checkTransition === 'function') {
    return options.checkTransition(previousShot, currentShot, previousImage, currentImage);
  }

  return {
    previousShotId: previousShot.id,
    shotId: currentShot.id,
    continuityScore: 10,
    violations: [],
    repairHints: [],
    checkedDimensions: {
      lighting: currentShot?.continuityState?.sceneLighting ?? null,
      cameraAxis: currentShot?.continuityState?.cameraAxis ?? null,
      propStates: currentShot?.continuityState?.propStates ?? [],
    },
  };
}

function buildContinuityMarkdown(reports, flaggedTransitions) {
  const lines = [
    '# Continuity Report',
    '',
    `- Checked Transitions: ${reports.length}`,
    `- Flagged Transitions: ${flaggedTransitions.length}`,
    '',
  ];

  for (const report of reports) {
    lines.push(`## ${report.previousShotId} -> ${report.shotId}`);
    lines.push(`- Score: ${report.continuityScore ?? 'n/a'}`);
    lines.push(`- Violations: ${(report.violations || []).join(', ') || 'none'}`);
    lines.push(`- Repair Hints: ${(report.repairHints || []).join(', ') || 'none'}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function writeContinuityArtifacts(reports, flaggedTransitions, artifactContext) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'continuity-report.json'), reports);
  saveJSON(path.join(artifactContext.outputsDir, 'flagged-transitions.json'), flaggedTransitions);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'continuity-report.md'),
    buildContinuityMarkdown(reports, flaggedTransitions)
  );
  saveJSON(path.join(artifactContext.metricsDir, 'continuity-metrics.json'), {
    checked_transition_count: reports.length,
    flagged_transition_count: flaggedTransitions.length,
    avg_continuity_score:
      reports.length > 0
        ? reports.reduce((sum, report) => sum + (report.continuityScore || 0), 0) / reports.length
        : 0,
  });
  saveJSON(artifactContext.manifestPath, {
    status: flaggedTransitions.length > 0 ? 'completed_with_errors' : 'completed',
    checkedTransitionCount: reports.length,
    flaggedTransitionCount: flaggedTransitions.length,
    outputFiles: [
      'continuity-report.json',
      'flagged-transitions.json',
      'continuity-report.md',
      'continuity-metrics.json',
    ],
  });
}

export async function runContinuityCheck(shots, imageResults, options = {}) {
  const pairs = buildContinuityPairs(shots, imageResults);
  const reports = [];

  for (const pair of pairs) {
    const report = await checkShotContinuity(
      pair.previousShot,
      pair.currentShot,
      pair.previousImage,
      pair.currentImage,
      options
    );
    reports.push(report);
  }

  const flaggedTransitions = reports
    .filter((report) => (report.continuityScore ?? 10) < (options.threshold ?? 7))
    .map((report) => ({
      previousShotId: report.previousShotId,
      shotId: report.shotId,
      continuityScore: report.continuityScore,
      violations: report.violations || [],
      repairHints: report.repairHints || [],
    }));

  logger.info('ContinuityChecker', `连贯性检查完成。问题转场：${flaggedTransitions.length} 个`);
  writeContinuityArtifacts(reports, flaggedTransitions, options.artifactContext);
  return { reports, flaggedTransitions };
}

export default {
  checkShotContinuity,
  runContinuityCheck,
};
