import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, saveJSON } from './fileHelper.js';
import {
  normalizeHarnessAgentSummary,
  normalizeHarnessRunDebug,
  normalizeHarnessRunOverview,
} from './runArtifacts.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function writeAgentQaSummary(summary, artifactContext) {
  if (!artifactContext || !summary) {
    return null;
  }

  const payload = normalizeHarnessAgentSummary(summary);

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
    payload.nextActions.length > 0 ? payload.nextActions.join('；') : '无',
    '',
    '## 关键证据',
    ...(payload.evidenceFiles.length > 0 ? payload.evidenceFiles.map((item) => `- ${item}`) : ['- 无']),
    '',
    '## 产物清单',
    ...(payload.artifacts.length > 0
      ? payload.artifacts.map((item) => `- ${item.label || item.path || 'unknown'}${item.path ? ` (${item.path})` : ''}`)
      : ['- 无']),
    '',
  ];

  writeTextFile(path.join(artifactContext.outputsDir, 'qa-summary.md'), lines.join('\n'));
  return payload;
}

export function writeRunQaOverview(overview, artifactContext) {
  if (!artifactContext || !overview) {
    return null;
  }

  const payload = normalizeHarnessRunOverview(overview);
  const runDebug = normalizeHarnessRunDebug(payload.runDebug);
  payload.runDebug = runDebug;

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
      if (summary.nextActions.length > 0) {
        lines.push(`  - 下一步：${summary.nextActions.join('；')}`);
      }
      if (summary.artifacts.length > 0) {
        lines.push(
          `  - 产物：${summary.artifacts
            .map((item) => item.label || item.path || 'unknown')
            .join('、')}`
        );
      }
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
  lines.push('', '## Run Debug Signals');
  lines.push(`- 状态: ${runDebug.status || 'unknown'}`);
  lines.push(`- 卡点步骤: ${runDebug.whereFailed || runDebug.stopStage || '无'}`);
  lines.push(`- 停止原因: ${runDebug.stopReason || '无'}`);
  lines.push(`- 最近错误: ${runDebug.lastError || '无'}`);
  lines.push(`- 缓存步骤: ${runDebug.cachedSteps.length > 0 ? runDebug.cachedSteps.join('，') : '无'}`);
  lines.push(`- 跳过步骤: ${runDebug.skippedSteps.length > 0 ? runDebug.skippedSteps.join('，') : '无'}`);
  lines.push(`- 重试步骤: ${runDebug.retriedSteps.length > 0 ? runDebug.retriedSteps.join('，') : '无'}`);
  lines.push(`- 人工复核步骤: ${runDebug.manualReviewSteps.length > 0 ? runDebug.manualReviewSteps.join('，') : '无'}`);
  lines.push(`- 失败步骤: ${runDebug.failedSteps.length > 0 ? runDebug.failedSteps.join('，') : '无'}`);
  lines.push(`- 提前停止时间: ${runDebug.stoppedBeforeVideoAt || '无'}`);
  lines.push(`- 预览输出: ${runDebug.previewOutputPath || '无'}`);
  lines.push(`- 完成时间: ${runDebug.completedAt || '无'}`);
  lines.push('');

  writeTextFile(artifactContext.qaOverviewMarkdownPath, lines.join('\n'));
  return payload;
}
