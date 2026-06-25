import path from 'node:path';

import { checkCrossVideoConsistency } from '../domain/crossVideoConsistency.js';
import { writeTextFile, ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function buildMarkdown(report) {
  return [
    '# Cross Video Consistency Report',
    '',
    `- Project: ${report.projectKey}`,
    `- Status: ${report.status}`,
    `- Entries: ${report.summary.totalEntries}`,
    `- Main clips: ${report.summary.mainClipCount}`,
    `- Sequence-covered shots: ${report.summary.sequenceCoveredShotCount}`,
    '',
    '## Summary',
    '',
    '| Dimension | Count |',
    '| --- | --- |',
    ...Object.entries(report.summary.byDimension).map(([dimension, count]) => `| ${dimension} | ${count} |`),
    '',
    '## Review Items',
    '',
    report.reviewItems.length === 0
      ? '- None'
      : report.reviewItems
          .map(
            (item) =>
              `- ${item.severity} | ${item.dimension} | ${item.clipId || item.subjectId || 'project'} | ${item.recommendedAction} | ${item.message}`
          )
          .join('\n'),
    '',
    '## Clip Index',
    '',
    '| Kind | ID | Main Timeline | Covered By Sequence | References |',
    '| --- | --- | --- | --- | --- |',
    ...report.clipIndex.clips.map(
      (clip) =>
        `| ${clip.kind} | ${clip.id} | ${clip.isMainTimeline ? 'yes' : 'no'} | ${clip.coveredBySequenceId || ''} | ${(clip.references || []).join(', ')} |`
    ),
    '',
  ].join('\n');
}

function buildMetrics(report) {
  return {
    status: report.status,
    totalEntries: report.summary.totalEntries,
    byDimension: report.summary.byDimension,
    bySeverity: report.summary.bySeverity,
    reviewItemCount: report.reviewItems.length,
    mainClipCount: report.summary.mainClipCount,
    shotCount: report.summary.shotCount,
    sequenceCount: report.summary.sequenceCount,
    bridgeCount: report.summary.bridgeCount,
    lipsyncCount: report.summary.lipsyncCount,
    sequenceCoveredShotCount: report.summary.sequenceCoveredShotCount,
  };
}

function writeArtifacts(report, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = buildMetrics(report);
  saveJSON(path.join(artifactContext.outputsDir, 'cross-video-consistency-report.json'), report);
  saveJSON(path.join(artifactContext.outputsDir, 'cross-video-context-memory.json'), report.contextMemoryPatch);
  saveJSON(path.join(artifactContext.outputsDir, 'flagged-cross-video-links.json'), report.flaggedLinks);
  saveJSON(path.join(artifactContext.metricsDir, 'cross-video-consistency-metrics.json'), metrics);
  writeTextFile(path.join(artifactContext.outputsDir, 'cross-video-consistency-report.md'), buildMarkdown(report));
  saveJSON(artifactContext.manifestPath, {
    status: report.status === 'pass' ? 'completed' : report.status === 'warn' ? 'completed_with_warnings' : 'completed_with_errors',
    reportStatus: report.status,
    entryCount: report.summary.totalEntries,
    reviewItemCount: report.reviewItems.length,
    outputFiles: [
      'cross-video-consistency-report.json',
      'cross-video-consistency-report.md',
      'cross-video-context-memory.json',
      'flagged-cross-video-links.json',
      'cross-video-consistency-metrics.json',
    ],
  });
  writeAgentQaSummary(
    {
      agentKey: 'crossVideoConsistencyAgent',
      agentName: 'Cross Video Consistency Agent',
      status: report.status,
      headline:
        report.status === 'pass'
          ? '跨视频一致性检查通过'
          : report.status === 'block'
            ? `${report.summary.bySeverity.block} 个跨视频问题阻断自动发布`
            : `${report.summary.bySeverity.warn} 个跨视频问题需要复核或降级处理`,
      summary: '第一版基于 metadata、已有 QA report 和 HappyHorse context memory 做确定性检查，不接真实视觉模型。',
      passItems: [`主时间线 clip 数：${report.summary.mainClipCount}`],
      warnItems: report.entries.filter((entry) => entry.status === 'warn').map((entry) => `${entry.dimension}:${entry.message}`),
      blockItems: report.entries.filter((entry) => entry.status === 'block').map((entry) => `${entry.dimension}:${entry.message}`),
      nextAction:
        report.status === 'pass'
          ? '写入 HappyHorse 项目级 context memory，继续下一条视频规划。'
          : '按 reviewItems 执行 regenerate_sequence 或 manual_review；高风险 motion 不自动补盲桥。',
      evidenceFiles: [
        '1-outputs/cross-video-consistency-report.json',
        '1-outputs/cross-video-context-memory.json',
        '1-outputs/flagged-cross-video-links.json',
        '2-metrics/cross-video-consistency-metrics.json',
      ],
      metrics,
    },
    artifactContext
  );
}

export async function runCrossVideoConsistency(input = {}, options = {}) {
  const report = checkCrossVideoConsistency(input);
  writeArtifacts(report, options.artifactContext || input.artifactContext);
  return report;
}

export const __testables = {
  buildMarkdown,
  buildMetrics,
  writeArtifacts,
};

export default {
  runCrossVideoConsistency,
};
