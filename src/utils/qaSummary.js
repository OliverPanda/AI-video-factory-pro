import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, saveJSON } from './fileHelper.js';

function normalizeList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function writeAgentQaSummary(summary, artifactContext) {
  if (!artifactContext || !summary) {
    return null;
  }

  const payload = {
    agentKey: summary.agentKey,
    agentName: summary.agentName,
    status: summary.status || 'pass',
    headline: summary.headline || '',
    summary: summary.summary || '',
    passItems: normalizeList(summary.passItems),
    warnItems: normalizeList(summary.warnItems),
    blockItems: normalizeList(summary.blockItems),
    nextAction: summary.nextAction || '',
    evidenceFiles: normalizeList(summary.evidenceFiles),
    metrics: summary.metrics || {},
  };

  saveJSON(path.join(artifactContext.metricsDir, 'qa-summary.json'), payload);

  const lines = [
    '# QA Summary',
    '',
    `- Agent: ${payload.agentName}`,
    `- Status: ${payload.status}`,
    `- 一句话结论: ${payload.headline || '无'}`,
    `- 结果说明: ${payload.summary || '无'}`,
    '',
    '## 达标项',
    ...(payload.passItems.length > 0 ? payload.passItems.map((item) => `- ${item}`) : ['- 无']),
    '',
    '## 风险项',
    ...(payload.warnItems.length > 0 ? payload.warnItems.map((item) => `- ${item}`) : ['- 无']),
    '',
    '## 阻断项',
    ...(payload.blockItems.length > 0 ? payload.blockItems.map((item) => `- ${item}`) : ['- 无']),
    '',
    `## 建议下一步`,
    payload.nextAction || '无',
    '',
    '## 关键证据',
    ...(payload.evidenceFiles.length > 0 ? payload.evidenceFiles.map((item) => `- ${item}`) : ['- 无']),
    '',
  ];

  writeTextFile(path.join(artifactContext.outputsDir, 'qa-summary.md'), lines.join('\n'));
  return payload;
}

export function writeRunQaOverview(overview, artifactContext) {
  if (!artifactContext || !overview) {
    return null;
  }

  const payload = {
    status: overview.status || 'pass',
    releasable: overview.releasable !== false,
    headline: overview.headline || '',
    summary: overview.summary || '',
    passCount: Number(overview.passCount || 0),
    warnCount: Number(overview.warnCount || 0),
    blockCount: Number(overview.blockCount || 0),
    agentSummaries: Array.isArray(overview.agentSummaries) ? overview.agentSummaries : [],
    topIssues: normalizeList(overview.topIssues),
  };

  saveJSON(artifactContext.qaOverviewJsonPath, payload);

  const lines = [
    '# Run QA Overview',
    '',
    `- 总体状态: ${payload.status}`,
    `- 是否可交付: ${payload.releasable ? '可以' : '不可以'}`,
    `- 一句话结论: ${payload.headline || '无'}`,
    `- 总结: ${payload.summary || '无'}`,
    `- Pass 数: ${payload.passCount}`,
    `- Warn 数: ${payload.warnCount}`,
    `- Block 数: ${payload.blockCount}`,
    '',
    '## 各 Agent 结果',
  ];

  if (payload.agentSummaries.length === 0) {
    lines.push('- 无');
  } else {
    for (const summary of payload.agentSummaries) {
      lines.push(`- ${summary.agentName}: ${summary.status} - ${summary.headline || summary.summary || '无摘要'}`);
    }
  }

  lines.push('', '## 最该先看的问题');
  if (payload.topIssues.length === 0) {
    lines.push('- 无');
  } else {
    for (const issue of payload.topIssues) {
      lines.push(`- ${issue}`);
    }
  }
  lines.push('');

  writeTextFile(artifactContext.qaOverviewMarkdownPath, lines.join('\n'));
  return payload;
}

