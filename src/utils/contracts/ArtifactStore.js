export class ArtifactStore {
  createRunArtifactContext(_input) {
    throw new Error('ArtifactStore.createRunArtifactContext() not implemented');
  }

  initializeRunArtifacts(_artifactContext, _payload, _options = {}) {
    throw new Error('ArtifactStore.initializeRunArtifacts() not implemented');
  }

  writeRuntimeJournal(_artifactContext, _payload, _options = {}) {
    throw new Error('ArtifactStore.writeRuntimeJournal() not implemented');
  }
}

export default ArtifactStore;
