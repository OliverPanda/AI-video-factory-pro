import {
  buildDirectorContextPack,
  buildStoryboardContextMemory,
  compactMemory,
  isMemoryFresh,
  readContext,
  recordInvalidation,
} from '../domain/storyboardContextMemory.js';
import { writeStoryboardContextArtifacts } from '../utils/storyboardContextArtifacts.js';

export async function buildStoryboardContext(input = {}, options = {}) {
  const cachedMemory = options.existingMemory || null;
  let memory = cachedMemory;

  if (!memory || !isMemoryFresh(memory, input)) {
    if (memory) {
      memory = recordInvalidation(memory, {
        runId: input.runId || input.runJobId || memory.runId,
        reason: 'upstream_artifact_changed',
        changedArtifacts: input.sourceArtifacts || [],
      });
    }
    memory = buildStoryboardContextMemory(input);
  }

  if (options.compactStrategy) {
    memory = compactMemory({ memory, strategy: options.compactStrategy });
  }

  if (options.currentShotId || options.tokenBudget) {
    const context = readContext({
      memory,
      input,
      currentShotId: options.currentShotId,
      tokenBudget: options.tokenBudget,
      windowSize: options.windowSize,
    });
    memory.contextPack = context.contextPack;
    memory.fresh = context.fresh;
  } else if (options.contextPackOptions) {
    memory.contextPack = buildDirectorContextPack(memory, options.contextPackOptions);
  }
  writeStoryboardContextArtifacts(memory, options.artifactContext);
  return memory;
}

export { buildDirectorContextPack };

export default {
  buildDirectorContextPack,
  buildStoryboardContext,
};
