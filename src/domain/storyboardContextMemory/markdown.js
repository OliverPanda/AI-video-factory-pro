import { asArray } from '../../utils/normalization.js';

const HAPPY_HORSE_REF_LIMIT = 9;

export function buildStoryboardContextMemoryMarkdown(memory = {}) {
  const metrics = memory.metrics || {};
  const lines = [
    '# Storyboard Context Memory',
    '',
    `- Project: ${memory.projectId || 'unknown-project'}`,
    `- Run: ${memory.runId || 'unknown-run'}`,
    `- Memories: ${metrics.memoryCount || 0}`,
    `- Shot memories: ${metrics.shotMemoryCount || 0}`,
    `- Transition memories: ${metrics.transitionMemoryCount || 0}`,
    `- Character memories: ${metrics.characterMemoryCount || 0}`,
    `- HappyHorse refs: ${metrics.happyHorseReferenceCount || 0}/${HAPPY_HORSE_REF_LIMIT}`,
    `- Warnings: ${metrics.warningCount || 0}`,
    '',
    '## Shot Index',
  ];

  const shotIds = Object.keys(memory.shotContextIndex || {});
  lines.push(
    ...(shotIds.length
      ? shotIds.map((shotId) => `- ${shotId}: ${(memory.shotContextIndex[shotId].memoryIds || []).join(', ')}`)
      : ['- None'])
  );
  lines.push('', '## Transition Index');
  const transitionIds = Object.keys(memory.transitionContextIndex || {});
  lines.push(
    ...(transitionIds.length
      ? transitionIds.map((transitionId) => `- ${transitionId}: ${(memory.transitionContextIndex[transitionId].memoryIds || []).join(', ')}`)
      : ['- None'])
  );
  lines.push('', '## Warnings');
  lines.push(
    ...(asArray(memory.warnings).length
      ? memory.warnings.map((warning) => `- [${warning.code}] ${warning.message}`)
      : ['- None'])
  );
  lines.push('');
  return lines.join('\n');
}
