export class ProjectStore {
  saveProject(_project, _options = {}) {
    throw new Error('ProjectStore.saveProject() not implemented');
  }

  loadProject(_projectId, _options = {}) {
    throw new Error('ProjectStore.loadProject() not implemented');
  }

  saveScript(_projectId, _script, _options = {}) {
    throw new Error('ProjectStore.saveScript() not implemented');
  }

  loadScript(_projectId, _scriptId, _options = {}) {
    throw new Error('ProjectStore.loadScript() not implemented');
  }

  saveEpisode(_projectId, _scriptId, _episode, _options = {}) {
    throw new Error('ProjectStore.saveEpisode() not implemented');
  }

  loadEpisode(_projectId, _scriptId, _episodeId, _options = {}) {
    throw new Error('ProjectStore.loadEpisode() not implemented');
  }
}

export default ProjectStore;
