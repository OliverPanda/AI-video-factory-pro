import fs from 'node:fs';
import path from 'node:path';

import { buildPostComposeReview } from '../domain/postComposeReview.js';
import { writeTextFile, ensureDir, saveBuffer, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function buildMetrics(result) {
  const pack = result.editTaskPack;
  const byAction = {};
  const byPriority = {};
  for (const task of pack.tasks) {
    byAction[task.action] = (byAction[task.action] || 0) + 1;
    byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;
  }
  return {
    schemaVersion: pack.schemaVersion,
    status: result.status,
    totalFindings: pack.findings.length,
    blockingFindings: pack.reviewSummary.blockingFindings,
    taskCount: pack.tasks.length,
    manualReviewItemCount: pack.humanReview.items.length,
    executionMode: pack.executionMode,
    manualExecutionRequired: pack.manualExecutionRequired,
    byAction,
    byPriority,
  };
}

function renderReviewMarkdown(result, metrics) {
  const report = result.report;
  return [
    '# Post Compose Review',
    '',
    `- Status: ${report.status}`,
    `- Project: ${report.projectId}`,
    `- Run: ${report.runId}`,
    `- Findings: ${metrics.totalFindings}`,
    `- Tasks: ${metrics.taskCount}`,
    `- Execution mode: ${metrics.executionMode}`,
    '',
    '## Findings',
    report.findings.length === 0
      ? '- None'
      : report.findings
          .map((finding) => `- ${finding.severity} | ${finding.category} | ${finding.targetRef.type}:${finding.targetRef.id} | ${finding.message}`)
          .join('\n'),
    '',
  ].join('\n');
}

function renderTaskPackMarkdown(pack) {
  const lines = [
    '# Edit Task Pack',
    '',
    `- Status: ${pack.reviewSummary.status}`,
    `- Execution mode: ${pack.executionMode}`,
    `- Manual execution required: ${pack.manualExecutionRequired}`,
    '',
    '| Priority | Action | Target | Status | Reason |',
    '| --- | --- | --- | --- | --- |',
  ];

  if (pack.tasks.length === 0) {
    lines.push('|  |  |  |  | None |');
  } else {
    for (const task of pack.tasks) {
      lines.push(
        `| ${task.priority} | ${task.action} | ${task.targetRef.type}:${task.targetRef.id} | ${task.status} | ${task.reason} |`
      );
    }
  }

  lines.push('', '## Human Review');
  if (pack.humanReview.items.length === 0) {
    lines.push('- None');
  } else {
    for (const item of pack.humanReview.items) {
      lines.push(`- ${item.taskId}: ${item.reviewType} (${item.priority})`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function persistReviewFinalVideo(result, artifactContext) {
  if (!artifactContext?.outputsDir) {
    return result;
  }

  const sourcePath = result?.editTaskPack?.finalVideoRef;
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    return result;
  }

  const normalizedSourcePath = sourcePath.trim();
  if (!path.isAbsolute(normalizedSourcePath) || !fs.existsSync(normalizedSourcePath)) {
    return result;
  }

  const persistedFileName = 'review-final-video.mp4';
  const persistedAbsolutePath = path.join(artifactContext.outputsDir, persistedFileName);
  if (path.resolve(normalizedSourcePath) !== path.resolve(persistedAbsolutePath)) {
    saveBuffer(persistedAbsolutePath, fs.readFileSync(normalizedSourcePath));
  }

  return {
    ...result,
    editTaskPack: {
      ...result.editTaskPack,
      finalVideoRef: persistedFileName,
    },
  };
}

function writeArtifacts(result, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const persistedResult = persistReviewFinalVideo(result, artifactContext);
  const metrics = buildMetrics(persistedResult);
  saveJSON(path.join(artifactContext.outputsDir, 'post-compose-review.json'), persistedResult.report);
  saveJSON(path.join(artifactContext.outputsDir, 'edit-task-pack.json'), persistedResult.editTaskPack);
  writeTextFile(path.join(artifactContext.outputsDir, 'post-compose-review.md'), renderReviewMarkdown(persistedResult, metrics));
  writeTextFile(path.join(artifactContext.outputsDir, 'edit-task-pack.md'), renderTaskPackMarkdown(persistedResult.editTaskPack));
  saveJSON(path.join(artifactContext.metricsDir, 'post-compose-review-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: persistedResult.status === 'approved' ? 'completed' : 'completed_with_warnings',
    reviewStatus: persistedResult.status,
    findingCount: metrics.totalFindings,
    taskCount: metrics.taskCount,
    manualReviewItemCount: metrics.manualReviewItemCount,
    outputFiles: [
      'post-compose-review.json',
      'post-compose-review.md',
      'edit-task-pack.json',
      'edit-task-pack.md',
      'post-compose-review-metrics.json',
      ...(persistedResult.editTaskPack.finalVideoRef === 'review-final-video.mp4' ? ['review-final-video.mp4'] : []),
    ],
  });

  writeAgentQaSummary(
    {
      agentKey: 'postComposeReviewAgent',
      agentName: 'Post Compose Review Agent',
      status: persistedResult.status === 'approved' ? 'pass' : 'warn',
      headline:
        persistedResult.status === 'approved'
          ? '成片预览后审查通过'
          : `生成 ${metrics.taskCount} 个待确认编辑任务`,
      summary: '第一版只生成 edit-task-pack，不自动调用 provider，不修改最终视频或 compose plan。',
      passItems: persistedResult.status === 'approved' ? ['没有发现成片级后处理风险'] : [],
      warnItems: persistedResult.editTaskPack.tasks
        .filter((task) => task.action !== 'approve')
        .map((task) => `${task.action}: ${task.targetRef.type}:${task.targetRef.id}`),
      blockItems: persistedResult.editTaskPack.findings
        .filter((finding) => ['blocker', 'block', 'fail', 'high'].includes(String(finding.severity || '').toLowerCase()))
        .map((finding) => `${finding.category}: ${finding.message}`),
      nextAction:
        persistedResult.status === 'approved'
          ? 'Director 可以交付成片。'
          : 'Director 或人工先审阅 edit-task-pack，再决定 approve、skip 或后续重跑。',
      evidenceFiles: [
        '1-outputs/post-compose-review.json',
        '1-outputs/post-compose-review.md',
        '1-outputs/edit-task-pack.json',
        '1-outputs/edit-task-pack.md',
        '2-metrics/post-compose-review-metrics.json',
      ],
      metrics,
    },
    artifactContext
  );
}

export async function runPostComposeReview(input = {}, options = {}) {
  const result = buildPostComposeReview({
    ...input,
    now: input.now || options.now,
  });
  const artifactContext = options.artifactContext || input.artifactContext;
  const persistedResult = artifactContext ? persistReviewFinalVideo(result, artifactContext) : result;
  writeArtifacts(persistedResult, artifactContext);
  return {
    ...persistedResult,
    editTaskPackPath: options.artifactContext
      ? path.join(options.artifactContext.outputsDir, 'edit-task-pack.json')
      : null,
    markdownSummaryPath: options.artifactContext
      ? path.join(options.artifactContext.outputsDir, 'post-compose-review.md')
      : null,
  };
}

export const __testables = {
  buildMetrics,
  renderReviewMarkdown,
  renderTaskPackMarkdown,
  writeArtifacts,
};

export default {
  runPostComposeReview,
};
