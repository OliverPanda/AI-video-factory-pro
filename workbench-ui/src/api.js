async function requestJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export function fetchWorkbench() {
  return requestJson('/api/workbench');
}

export function fetchProjects() {
  return requestJson('/api/projects');
}

export function fetchProject(projectId) {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}`);
}

export function fetchEpisode(projectId, scriptId, episodeId) {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}/episodes/${encodeURIComponent(episodeId)}`
  );
}

export function fetchRuns() {
  return requestJson('/api/runs');
}

export function fetchRun(runId) {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}`);
}

export function fetchRunQa(runId) {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/qa`);
}

export function fetchRunArtifacts(runId) {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/artifacts`);
}

export function fetchCharacterAssets() {
  return requestJson('/api/assets/characters');
}

export function fetchVideoAssets() {
  return requestJson('/api/assets/videos');
}

export function fetchProviderSettings() {
  return requestJson('/api/settings/providers');
}
