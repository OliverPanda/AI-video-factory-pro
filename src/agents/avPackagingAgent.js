import path from 'node:path';

import { buildAvPackagingPlan } from '../domain/avPackagingPlan.js';
import { writeTextFile, ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function buildMetrics(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    durationSec: plan.timeline?.durationSec || 0,
    bgmCueCount: plan.bgmCues.length,
    sfxCueCount: plan.sfxCues.length,
    rhythmCueCount: plan.rhythmCues.length,
    priorityHintCount: plan.priorityHints.length,
    warningCount: plan.warnings.length,
    blockingWarningCount: plan.warnings.filter((warning) => warning.blocking).length,
    optionalAudioAvailable: plan.warnings.every((warning) => warning.code !== 'audio_assets_missing'),
  };
}

function renderMarkdown(plan, metrics) {
  const lines = [
    '# AV Packaging Plan',
    '',
    `- Schema: ${plan.schemaVersion}`,
    `- Run: ${plan.runId || 'unknown'}`,
    `- Duration: ${plan.timeline.durationSec}s`,
    `- Subtitle preset: ${plan.subtitleStyleProfile.stylePreset}`,
    `- BGM cues: ${metrics.bgmCueCount}`,
    `- SFX cues: ${metrics.sfxCueCount}`,
    `- Rhythm cues: ${metrics.rhythmCueCount}`,
    `- Priority hints: ${metrics.priorityHintCount}`,
    '',
    '## Warnings',
    ...(plan.warnings.length > 0
      ? plan.warnings.map((warning) => `- ${warning.code}: ${warning.message} (blocking: ${warning.blocking})`)
      : ['- None']),
    '',
    '## BGM Cues',
    ...(plan.bgmCues.length > 0
      ? plan.bgmCues.map((cue) => `- ${cue.id}: ${cue.mood} ${cue.startSec}s-${cue.endSec}s`)
      : ['- None']),
    '',
    '## SFX Cues',
    ...(plan.sfxCues.length > 0
      ? plan.sfxCues.map((cue) => `- ${cue.id}: ${cue.sfxType} at ${cue.atSec}s`)
      : ['- None']),
    '',
  ];

  return lines.join('\n');
}

function writeArtifacts(plan, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = buildMetrics(plan);
  saveJSON(path.join(artifactContext.outputsDir, 'av-packaging-plan.json'), plan);
  writeTextFile(path.join(artifactContext.outputsDir, 'av-packaging-plan.md'), renderMarkdown(plan, metrics));
  saveJSON(path.join(artifactContext.metricsDir, 'av-packaging-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: metrics.blockingWarningCount > 0 ? 'completed_with_warnings' : 'completed',
    schemaVersion: plan.schemaVersion,
    bgmCueCount: metrics.bgmCueCount,
    sfxCueCount: metrics.sfxCueCount,
    warningCount: metrics.warningCount,
    outputFiles: ['av-packaging-plan.json', 'av-packaging-plan.md', 'av-packaging-metrics.json'],
  });

  writeAgentQaSummary(
    {
      agentKey: 'avPackagingAgent',
      agentName: 'AV Packaging Agent',
      status: metrics.blockingWarningCount > 0 ? 'warn' : 'pass',
      headline: `已生成音画包装计划：${metrics.bgmCueCount} 个 BGM cue，${metrics.sfxCueCount} 个 SFX cue`,
      summary: '包装计划包含字幕样式、音乐音效、节奏点和 lipsync/sequence/bridge 优先级提示。',
      passItems: [
        `字幕样式：${plan.subtitleStyleProfile.stylePreset}`,
        `节奏点：${metrics.rhythmCueCount}`,
        `优先级提示：${metrics.priorityHintCount}`,
      ],
      warnItems: plan.warnings.map((warning) => `${warning.code}: ${warning.message}`),
      nextAction: '可以将 packagingPlan 传入 videoComposer 执行字幕样式与后续混音扩展。',
      evidenceFiles: [
        '1-outputs/av-packaging-plan.json',
        '1-outputs/av-packaging-plan.md',
        '2-metrics/av-packaging-metrics.json',
      ],
      metrics,
    },
    artifactContext
  );
}

export async function runAvPackaging(input = {}, options = {}) {
  const plan = buildAvPackagingPlan({
    ...input,
    options: {
      ...(input.options || {}),
      ...options,
    },
  });
  writeArtifacts(plan, options.artifactContext || input.artifactContext);
  return plan;
}

export const __testables = {
  buildMetrics,
  renderMarkdown,
  writeArtifacts,
};

export default {
  runAvPackaging,
};
