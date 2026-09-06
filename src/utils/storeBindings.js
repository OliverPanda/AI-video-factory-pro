import { fsProjectStore } from './projectStore.js';
import { fsRunJobStore } from './jobStore.js';
import { fsArtifactStore } from './runArtifacts.js';

export function bindStoreMethods(baseStore, methodNames = []) {
  return Object.fromEntries(
    methodNames.map((methodName) => [methodName, baseStore[methodName].bind(baseStore)])
  );
}

export function createBoundProjectStore(overrides = {}) {
  return {
    ...bindStoreMethods(fsProjectStore, [
      'saveProject',
      'loadProject',
      'saveScript',
      'loadScript',
      'saveEpisode',
      'loadEpisode',
    ]),
    ...(overrides.projectStore || {}),
    ...(overrides.saveProject ? { saveProject: overrides.saveProject } : {}),
    ...(overrides.saveScript ? { saveScript: overrides.saveScript } : {}),
    ...(overrides.saveEpisode ? { saveEpisode: overrides.saveEpisode } : {}),
    ...(overrides.loadProject ? { loadProject: overrides.loadProject } : {}),
    ...(overrides.loadScript ? { loadScript: overrides.loadScript } : {}),
    ...(overrides.loadEpisode ? { loadEpisode: overrides.loadEpisode } : {}),
  };
}

export function createBoundRunJobStore(overrides = {}) {
  return {
    ...bindStoreMethods(fsRunJobStore, [
      'createRunJob',
      'appendAgentTaskRun',
      'finishRunJob',
    ]),
    ...(overrides.runJobStore || {}),
    ...(overrides.createRunJob ? { createRunJob: overrides.createRunJob } : {}),
    ...(overrides.finishRunJob ? { finishRunJob: overrides.finishRunJob } : {}),
    ...(overrides.appendAgentTaskRun ? { appendAgentTaskRun: overrides.appendAgentTaskRun } : {}),
  };
}

export function createBoundArtifactStore(overrides = {}) {
  return {
    ...bindStoreMethods(fsArtifactStore, [
      'createRunArtifactContext',
      'initializeRunArtifacts',
      'writeRuntimeJournal',
      'adoptAgentArtifacts',
    ]),
    ...(overrides.artifactStore || {}),
    ...(overrides.createRunArtifactContext
      ? { createRunArtifactContext: overrides.createRunArtifactContext }
      : {}),
    ...(overrides.initializeRunArtifacts
      ? { initializeRunArtifacts: overrides.initializeRunArtifacts }
      : {}),
    ...(overrides.writeRuntimeJournal
      ? { writeRuntimeJournal: overrides.writeRuntimeJournal }
      : {}),
    ...(overrides.adoptAgentArtifacts ? { adoptAgentArtifacts: overrides.adoptAgentArtifacts } : {}),
  };
}

export function createDefaultBoundStores(overrides = {}) {
  return {
    projectStore: createBoundProjectStore(overrides),
    runJobStore: createBoundRunJobStore(overrides),
    artifactStore: createBoundArtifactStore(overrides),
  };
}

export default {
  bindStoreMethods,
  createBoundProjectStore,
  createBoundRunJobStore,
  createBoundArtifactStore,
  createDefaultBoundStores,
};
