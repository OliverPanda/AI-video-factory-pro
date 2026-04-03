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

function normalizeAxis(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^screen_/, '');
  if (normalized === 'left_to_right' || normalized === 'screen_left_to_right') {
    return 'left_to_right';
  }
  if (normalized === 'right_to_left' || normalized === 'screen_right_to_left') {
    return 'right_to_left';
  }
  if (normalized === 'neutral') {
    return 'neutral';
  }
  return null;
}

function normalizePropStateList(propStates = []) {
  return new Map(
    (Array.isArray(propStates) ? propStates : [])
      .filter((item) => item?.name)
      .map((item) => [
        item.name,
        {
          name: item.name,
          holderEpisodeCharacterId: item.holderEpisodeCharacterId ?? null,
          side: item.side ?? null,
          state: item.state ?? null,
        },
      ])
  );
}

function addViolation(target, code, severity, message) {
  target.push({ code, severity, message });
}

function buildHardViolations(previousShot, currentShot) {
  const violations = [];
  const previousState = previousShot?.continuityState ?? {};
  const currentState = currentShot?.continuityState ?? {};
  const previousAxis = normalizeAxis(previousState.cameraAxis);
  const currentAxis = normalizeAxis(currentState.cameraAxis);

  if (
    previousAxis &&
    currentAxis &&
    previousAxis !== 'neutral' &&
    currentAxis !== 'neutral' &&
    previousAxis !== currentAxis
  ) {
    addViolation(
      violations,
      'camera_axis_flip',
      'high',
      `镜头轴线从 ${previousAxis} 变为 ${currentAxis}`
    );
  }

  if (
    previousState.sceneLighting &&
    currentState.sceneLighting &&
    previousState.sceneLighting !== currentState.sceneLighting
  ) {
    addViolation(
      violations,
      'lighting_jump',
      'medium',
      `光照语义从 ${previousState.sceneLighting} 变为 ${currentState.sceneLighting}`
    );
  }

  const previousProps = normalizePropStateList(previousState.propStates);
  const currentProps = normalizePropStateList(currentState.propStates);
  for (const [name, previousProp] of previousProps.entries()) {
    const currentProp = currentProps.get(name);
    if (!currentProp) {
      continue;
    }

    if (
      previousProp.holderEpisodeCharacterId !== currentProp.holderEpisodeCharacterId ||
      previousProp.side !== currentProp.side ||
      previousProp.state !== currentProp.state
    ) {
      addViolation(
        violations,
        'prop_state_break',
        'medium',
        `道具 ${name} 的承接状态发生变化`
      );
    }
  }

  return violations;
}

function normalizeSoftWarnings(rawWarnings = [], rawViolations = []) {
  const warnings = [];
  for (const warning of Array.isArray(rawWarnings) ? rawWarnings : []) {
    if (!warning) continue;
    if (typeof warning === 'string') {
      warnings.push({ code: warning, severity: 'medium', message: warning });
      continue;
    }
    warnings.push({
      code: warning.code || warning.message || 'continuity_warning',
      severity: warning.severity || 'medium',
      message: warning.message || warning.code || 'continuity warning',
    });
  }

  if (warnings.length === 0) {
    for (const violation of Array.isArray(rawViolations) ? rawViolations : []) {
      warnings.push({
        code: violation,
        severity: 'medium',
        message: violation,
      });
    }
  }

  return warnings;
}

function normalizeHardViolations(rawViolations = []) {
  return (Array.isArray(rawViolations) ? rawViolations : [])
    .filter(Boolean)
    .map((item) =>
      typeof item === 'string'
        ? { code: item, severity: 'high', message: item }
        : {
            code: item.code || item.message || 'continuity_violation',
            severity: item.severity || 'high',
            message: item.message || item.code || 'continuity violation',
          }
    );
}

function dedupeByCode(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.code}:${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeReport(previousShot, currentShot, rawReport = {}, threshold = 7) {
  const ruleHardViolations = buildHardViolations(previousShot, currentShot);
  const reportHardViolations = normalizeHardViolations(rawReport.hardViolations);
  const hardViolations = dedupeByCode([...ruleHardViolations, ...reportHardViolations]);
  const softWarnings = normalizeSoftWarnings(rawReport.softWarnings, rawReport.violations);
  const continuityScore = rawReport.continuityScore ?? 10;
  const repairHints = Array.isArray(rawReport.repairHints) ? rawReport.repairHints : [];

  let recommendedAction = rawReport.recommendedAction;
  if (!recommendedAction) {
    if (hardViolations.some((item) => item.severity === 'high')) {
      recommendedAction = 'regenerate_prompt_and_image';
    } else if (continuityScore < threshold) {
      recommendedAction = 'regenerate_prompt_and_image';
    } else {
      recommendedAction = 'pass';
    }
  }

  const continuityTargets = Array.isArray(rawReport.continuityTargets)
    ? rawReport.continuityTargets
    : [...new Set(hardViolations.map((item) => item.code).concat(softWarnings.map((item) => item.code)))];

  const checkedDimensions = {
    lighting: currentShot?.continuityState?.sceneLighting ?? null,
    cameraAxis: currentShot?.continuityState?.cameraAxis ?? null,
    propStates: currentShot?.continuityState?.propStates ?? [],
    ...(rawReport.checkedDimensions || {}),
  };

  return {
    previousShotId: rawReport.previousShotId ?? previousShot.id,
    shotId: rawReport.shotId ?? currentShot.id,
    checkedDimensions,
    hardViolations,
    softWarnings,
    continuityScore,
    llmObservations: Array.isArray(rawReport.llmObservations) ? rawReport.llmObservations : [],
    repairHints,
    recommendedAction,
    repairMethod:
      rawReport.repairMethod ?? (recommendedAction === 'regenerate_prompt_and_image' ? 'prompt_regen' : 'manual_review'),
    continuityTargets,
    postprocessHints: Array.isArray(rawReport.postprocessHints) ? rawReport.postprocessHints : [],
    violations: [...hardViolations.map((item) => item.code), ...softWarnings.map((item) => item.code)],
  };
}

export async function checkShotContinuity(previousShot, currentShot, previousImage, currentImage, options = {}) {
  const threshold = options.threshold ?? 7;
  if (typeof options.checkTransition === 'function') {
    const rawReport = await options.checkTransition(previousShot, currentShot, previousImage, currentImage);
    return normalizeReport(previousShot, currentShot, rawReport, threshold);
  }

  return normalizeReport(
    previousShot,
    currentShot,
    {
      continuityScore: 10,
      repairHints: [],
      llmObservations: [],
      softWarnings: [],
      postprocessHints: [],
    },
    threshold
  );
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
    lines.push(`- Recommended Action: ${report.recommendedAction || 'pass'}`);
    lines.push(`- Hard Violations: ${(report.hardViolations || []).map((item) => item.code).join(', ') || 'none'}`);
    lines.push(`- Soft Warnings: ${(report.softWarnings || []).map((item) => item.code).join(', ') || 'none'}`);
    lines.push(`- Repair Hints: ${(report.repairHints || []).join(', ') || 'none'}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function buildRepairPlan(flaggedTransitions = []) {
  return flaggedTransitions.map((item) => ({
    shotId: item.shotId,
    previousShotId: item.previousShotId,
    recommendedAction: item.recommendedAction,
    repairMethod: item.repairMethod,
    continuityTargets: item.continuityTargets || [],
    repairHints: item.repairHints || [],
  }));
}

function buildMetrics(reports, flaggedTransitions) {
  return {
    checked_transition_count: reports.length,
    flagged_transition_count: flaggedTransitions.length,
    avg_continuity_score:
      reports.length > 0
        ? reports.reduce((sum, report) => sum + (report.continuityScore || 0), 0) / reports.length
        : 0,
    hard_violation_count: reports.reduce((sum, report) => sum + (report.hardViolations || []).length, 0),
    soft_warning_count: reports.reduce((sum, report) => sum + (report.softWarnings || []).length, 0),
    hard_rule_fail_count: reports.filter((report) => (report.hardViolations || []).length > 0).length,
    llm_review_fail_count: reports.filter((report) => (report.softWarnings || []).length > 0).length,
    action_pass_count: reports.filter((report) => report.recommendedAction === 'pass').length,
    action_regenerate_count: reports.filter((report) => report.recommendedAction === 'regenerate_prompt_and_image')
      .length,
    action_manual_review_count: reports.filter((report) => report.recommendedAction === 'manual_review').length,
  };
}

function writeContinuityArtifacts(reports, flaggedTransitions, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const repairPlan = buildRepairPlan(flaggedTransitions);
  saveJSON(path.join(artifactContext.outputsDir, 'continuity-report.json'), reports);
  saveJSON(path.join(artifactContext.outputsDir, 'flagged-transitions.json'), flaggedTransitions);
  saveJSON(path.join(artifactContext.outputsDir, 'repair-plan.json'), repairPlan);
  saveJSON(path.join(artifactContext.outputsDir, 'repair-attempts.json'), []);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'continuity-report.md'),
    buildContinuityMarkdown(reports, flaggedTransitions)
  );
  saveJSON(path.join(artifactContext.metricsDir, 'continuity-metrics.json'), buildMetrics(reports, flaggedTransitions));
  saveJSON(artifactContext.manifestPath, {
    status: flaggedTransitions.length > 0 ? 'completed_with_errors' : 'completed',
    checkedTransitionCount: reports.length,
    flaggedTransitionCount: flaggedTransitions.length,
    outputFiles: [
      'continuity-report.json',
      'flagged-transitions.json',
      'repair-plan.json',
      'repair-attempts.json',
      'continuity-report.md',
      'continuity-metrics.json',
    ],
  });
}

export async function runContinuityCheck(shots, imageResults, options = {}) {
  const threshold = options.threshold ?? 7;
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
    .filter((report) => report.recommendedAction !== 'pass' || (report.continuityScore ?? 10) < threshold)
    .map((report) => ({
      previousShotId: report.previousShotId,
      shotId: report.shotId,
      triggerSource:
        (report.hardViolations || []).length > 0 && (report.continuityScore ?? 10) < threshold
          ? 'combined'
          : (report.hardViolations || []).length > 0
            ? 'hard_rule'
            : 'llm_score',
      hardViolationCodes: (report.hardViolations || []).map((item) => item.code),
      continuityScore: report.continuityScore,
      violations: report.violations || [],
      repairHints: report.repairHints || [],
      recommendedAction: report.recommendedAction,
      repairMethod: report.repairMethod,
      continuityTargets: report.continuityTargets || [],
    }));

  logger.info('ContinuityChecker', `连贯性检查完成。问题转场：${flaggedTransitions.length} 个`);
  writeContinuityArtifacts(reports, flaggedTransitions, options.artifactContext);
  return { reports, flaggedTransitions };
}

export default {
  checkShotContinuity,
  runContinuityCheck,
};
