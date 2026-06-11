import { buildDirectorContextPack, buildStoryboardContextMemory } from '../domain/storyboardContextMemory.js';
import { writeStoryboardContextArtifacts } from '../utils/storyboardContextArtifacts.js';

export async function buildStoryboardContext(input = {}, options = {}) {
  const memory = buildStoryboardContextMemory(input);
  if (options.currentShotId || options.tokenBudget) {
    memory.contextPack = buildDirectorContextPack(memory, {
      currentShotId: options.currentShotId,
      tokenBudget: options.tokenBudget,
      windowSize: options.windowSize,
    });
  }
  writeStoryboardContextArtifacts(memory, options.artifactContext);
  return memory;
}

export { buildDirectorContextPack };

export default {
  buildDirectorContextPack,
  buildStoryboardContext,
};
