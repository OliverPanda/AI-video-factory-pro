import path from 'node:path';

import { buildStoryboardContextMemoryMarkdown } from '../domain/storyboardContextMemory.js';
import { writeTextFile, ensureDir, saveJSON } from './fileHelper.js';
import { writeAgentQaSummary } from './qaSummary.js';

export function writeStoryboardContextArtifacts(memory, artifactContext) {
  if (!artifactContext || !memory) {
    return null;
  }

  const metrics = memory.metrics || {};
  const status = metrics.warningCount > 0 ? 'completed_with_warnings' : 'completed';

  saveJSON(path.join(artifactContext.outputsDir, 'storyboard-context-memory.json'), memory);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'storyboard-context-memory.md'),
    buildStoryboardContextMemoryMarkdown(memory)
  );
  saveJSON(path.join(artifactContext.outputsDir, 'shot-context-index.json'), memory.shotContextIndex || {});
  saveJSON(path.join(artifactContext.outputsDir, 'transition-context-index.json'), memory.transitionContextIndex || {});
  saveJSON(path.join(artifactContext.metricsDir, 'storyboard-context-memory-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status,
    memoryCount: metrics.memoryCount || 0,
    shotMemoryCount: metrics.shotMemoryCount || 0,
    transitionMemoryCount: metrics.transitionMemoryCount || 0,
    warningCount: metrics.warningCount || 0,
    outputFiles: [
      'storyboard-context-memory.json',
      'storyboard-context-memory.md',
      'shot-context-index.json',
      'transition-context-index.json',
      'storyboard-context-memory-metrics.json',
    ],
  });

  writeAgentQaSummary(
    {
      agentKey: 'storyboardContextAgent',
      agentName: 'Storyboard Context Agent',
      status: metrics.warningCount > 0 ? 'warn' : 'pass',
      headline: `已生成 ${metrics.shotMemoryCount || 0} 个镜头记忆和 ${metrics.transitionMemoryCount || 0} 个转场记忆`,
      summary: '分镜上下文记忆将镜头状态、角色参考、连续性承接和证据来源写入可索引 artifact。',
      passItems: [
        `记忆总数：${metrics.memoryCount || 0}`,
        `HappyHorse refs：${metrics.happyHorseReferenceCount || 0}`,
      ],
      warnItems: (memory.warnings || []).map((warning) => `${warning.code}: ${warning.message}`),
      nextAction:
        metrics.warningCount > 0
          ? '先处理缺失 reference 或 continuity warning，再把上下文包注入后续生成。'
          : '可以把 shot-context-index 和 transition-context-index 注入后续生成与修复。 ',
      evidenceFiles: [
        '1-outputs/storyboard-context-memory.json',
        '1-outputs/shot-context-index.json',
        '1-outputs/transition-context-index.json',
        '2-metrics/storyboard-context-memory-metrics.json',
      ],
      metrics,
    },
    artifactContext
  );

  return memory;
}

export default {
  writeStoryboardContextArtifacts,
};
