import path from 'node:path';

import { writeTextFile, ensureDir, saveJSON } from './fileHelper.js';
import { writeAgentQaSummary } from './qaSummary.js';

function normalizeItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item, index) => ({
      id: item.id || `review_${index + 1}`,
      type: item.type || 'manual_review',
      priority: item.priority || 'medium',
      status: item.status || 'open',
      characterName: item.characterName || item.character || null,
      characterBibleId: item.characterBibleId || null,
      episodeCharacterId: item.episodeCharacterId || null,
      shotId: item.shotId || null,
      reason: item.reason || item.summary || '需要人工确认',
      suggestedAction: item.suggestedAction || item.nextAction || '人工复核后决定是否放行',
      evidence: Array.isArray(item.evidence) ? item.evidence : [],
    }));
}

function consistencyReviewItems(consistencyResult = {}) {
  const normalizedResult =
    consistencyResult && typeof consistencyResult === 'object' ? consistencyResult : {};
  const reports = Array.isArray(normalizedResult.reports) ? normalizedResult.reports : [];
  const flagged = Array.isArray(normalizedResult.needsRegeneration)
    ? normalizedResult.needsRegeneration
    : [];
  // 角色级复核项：从一致性报告中提取每个角色的质量门禁判定。
  // 与下方的 shot_regeneration（镜头级重生成跟踪）是两层视角——
  // 同一个角色可能在两条记录中分别出现：一条侧重“该角色是否通过门槛”，
  // 另一条侧重“该角色的某个镜头是否已重生成”。这是有意为之的双层记录，
  // 便于人审时分别从资产维度和镜头维度跟踪闭环。
  const reportItems = reports
    .filter((report) => ['pass_with_review', 'warn', 'block'].includes(report?.qaDecision?.status))
    .map((report) => ({
      id: `consistency_review_${report.character}`,
      type: 'quality_gate',
      priority: report.qaDecision.status === 'block' ? 'high' : 'medium',
      characterName: report.character,
      reason:
        report.qaDecision.status === 'block'
          ? `角色一致性阻断：${(report.hardFailureReasons || []).join('、') || report.overallScore}`
          : (report.qaDecision.status === 'pass_with_review'
            ? `角色一致性低置信放行：score=${report.overallScore}, threshold=${report.qaDecision.threshold}`
            : `角色一致性警告：score=${report.overallScore}, strategy=${report.regenStrategy}`),
      suggestedAction:
        report.regenStrategy === 'reanchor_regenerate'
          ? '选择最佳 canonical refs 并执行回锚重生成'
          : (report.qaDecision.status === 'pass_with_review'
            ? '异步复核该角色镜头，不阻断当前流水线'
            : '收紧 prompt 身份锚点，必要时升级参考图'),
      status: 'open',
    }));

  const flaggedItems = flagged.map((item) => ({
    id: `shot_regen_review_${item.shotId}`,
    type: 'shot_regeneration',
    priority: item.regenStrategy === 'reanchor_regenerate' ? 'high' : 'medium',
    shotId: item.shotId,
    reason: item.reason,
    suggestedAction:
      item.regenStrategy === 'reanchor_regenerate'
        ? '人工确认参考图后回锚重生成'
        : '确认是否自动重生成或仅记录为 warn',
    status: 'open',
  }));

  return [...reportItems, ...flaggedItems];
}

function costReviewItems(costReport = {}) {
  const normalizedReport = costReport && typeof costReport === 'object' ? costReport : {};
  const issues = [
    ...(Array.isArray(normalizedReport.blockers) ? normalizedReport.blockers : []),
    ...(Array.isArray(normalizedReport.warnings) ? normalizedReport.warnings : []),
  ];
  return issues.map((issue, index) => ({
    id: `cost_review_${index + 1}`,
    type: 'cost_governance',
    priority: (normalizedReport.blockers || []).includes(issue) ? 'high' : 'medium',
    reason: issue,
    suggestedAction: '调整镜头数量、provider、重试次数或显式批准预算后再继续',
    status: 'open',
  }));
}

export function buildHumanReviewQueue({
  assetGovernanceReport = null,
  consistencyResult = null,
  costReport = null,
  extraItems = [],
  now = new Date().toISOString(),
} = {}) {
  const items = normalizeItems([
    ...(assetGovernanceReport?.reviewItems || []),
    ...consistencyReviewItems(consistencyResult),
    ...costReviewItems(costReport),
    ...extraItems,
  ]);

  const highPriorityCount = items.filter((item) => item.priority === 'high').length;
  const mediumPriorityCount = items.filter((item) => item.priority === 'medium').length;

  return {
    generatedAt: now,
    status: highPriorityCount > 0 ? 'block' : (items.length > 0 ? 'warn' : 'pass'),
    summary: {
      openCount: items.length,
      highPriorityCount,
      mediumPriorityCount,
      lowPriorityCount: items.filter((item) => item.priority === 'low').length,
    },
    items,
  };
}

export function buildHumanReviewQueueMarkdown(queue = {}) {
  const lines = [
    '# Human Review Queue',
    '',
    `- Status: ${queue.status || 'unknown'}`,
    `- Open Items: ${queue.summary?.openCount || 0}`,
    `- High Priority: ${queue.summary?.highPriorityCount || 0}`,
    '',
    '| Priority | Type | Character | Shot | Reason | Suggested Action |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const item of queue.items || []) {
    lines.push(
      `| ${item.priority || ''} | ${item.type || ''} | ${item.characterName || ''} | ${item.shotId || ''} | ${item.reason || ''} | ${item.suggestedAction || ''} |`
    );
  }

  if ((queue.items || []).length === 0) {
    lines.push('|  |  |  |  | 无 |  |');
  }

  lines.push('');
  return lines.join('\n');
}

export function writeHumanReviewQueueArtifacts(queue, artifactContext) {
  if (!artifactContext || !queue) {
    return null;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'human-review-queue.json'), queue);
  writeTextFile(path.join(artifactContext.outputsDir, 'human-review-queue.md'), buildHumanReviewQueueMarkdown(queue));
  saveJSON(path.join(artifactContext.metricsDir, 'human-review-metrics.json'), queue.summary || {});
  saveJSON(artifactContext.manifestPath, {
    status: queue.status === 'block' ? 'completed_with_warnings' : 'completed',
    openCount: queue.summary?.openCount || 0,
    highPriorityCount: queue.summary?.highPriorityCount || 0,
    outputFiles: ['human-review-queue.json', 'human-review-queue.md', 'human-review-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'humanReviewQueue',
      agentName: 'Human Review Queue',
      status: queue.status,
      headline:
        queue.summary?.openCount > 0
          ? `待人工复核 ${queue.summary.openCount} 项`
          : '当前没有待人工复核项',
      summary: '人审队列汇总角色资产治理、质量门禁、成本治理产生的人工决策点。',
      passItems: queue.summary?.openCount === 0 ? ['无需人工复核'] : [],
      warnItems:
        queue.status === 'warn'
          ? [`中优先级复核项：${queue.summary?.mediumPriorityCount || 0}`]
          : [],
      blockItems:
        queue.status === 'block'
          ? [`高优先级复核项：${queue.summary?.highPriorityCount || 0}`]
          : [],
      nextAction:
        queue.summary?.openCount > 0
          ? '先处理 human-review-queue.json 中的高优先级项，再决定是否继续生产或升级资产。'
          : '可以继续自动化生产。',
      evidenceFiles: ['1-outputs/human-review-queue.json', '1-outputs/human-review-queue.md'],
      metrics: queue.summary || {},
    },
    artifactContext
  );

  return queue;
}

export default {
  buildHumanReviewQueue,
  buildHumanReviewQueueMarkdown,
  writeHumanReviewQueueArtifacts,
};
