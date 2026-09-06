import { validatePathSegment } from './pathSecurity.js';
import { sendJson } from './httpResponseHelpers.js';
import {
  findEpisodeEntity,
  sanitizeEntityUpdate,
  syncEpisodeCharacterCopies,
  resolveEpisodePayload,
  persistResolvedEpisode,
  loadRunLiveState,
} from './episodeHelpers.js';
import { safeParseBody } from './bodyParser.js';

export async function handleEpisodeRoutes(request, response, {
  pathname, method, searchParams, projectStoreBaseTempDir, runJobs, workspaceRoot,
  withRunLock,
}) {
  // GET /storyboard
  const storyboardMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/episodes\/([^/]+)\/storyboard$/);
  if (storyboardMatch) {
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    let projectId, scriptId, episodeId;
    try {
      projectId = validatePathSegment(storyboardMatch[1], 'projectId');
      scriptId = validatePathSegment(storyboardMatch[2], 'scriptId');
      episodeId = validatePathSegment(storyboardMatch[3], 'episodeId');
    } catch (err) {
      sendJson(response, 400, { error: err.message || 'Invalid storyboard locator' });
      return true;
    }

    const requestedRunId = searchParams.get('runId') || searchParams.get('run') || null;
    const { episode, snapshot } = resolveEpisodePayload(projectId, scriptId, episodeId, {
      projectStoreBaseTempDir, runJobs, workspaceRoot, runId: requestedRunId,
    });
    if (!episode) {
      sendJson(response, 404, { error: 'Episode not found' });
      return true;
    }

    const requestedRun = runJobs.find((r) => r.id === requestedRunId);
    const liveSnapshot = requestedRun
      && requestedRun.projectId === projectId
      && requestedRun.scriptId === scriptId
      && requestedRun.episodeId === episodeId
      ? loadRunLiveState(requestedRun, { projectStoreBaseTempDir })
      : null;

    sendJson(response, 200, {
      ...episode,
      shots: Array.isArray(episode.shots) ? episode.shots : (snapshot?.scriptData?.shots || liveSnapshot?.scriptData?.shots || []),
      characters: Array.isArray(episode.episodeCharacters)
        ? episode.episodeCharacters
        : (Array.isArray(episode.characters) ? episode.characters : []),
      scenes: Array.isArray(episode.scenes) ? episode.scenes : [],
      voices: Array.isArray(episode.voices) ? episode.voices : [],
      snapshot: snapshot || liveSnapshot || null,
    });
    return true;
  }

  // PUT /episodes/:eid/:entityType/:entityId
  const storyboardEntityMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/episodes\/([^/]+)\/(shots|characters|scenes|voices)\/([^/]+)$/
  );
  if (storyboardEntityMatch) {
    if (method !== 'PUT') {
      sendJson(response, 405, { error: 'Method not allowed' });
      return true;
    }

    let projectId, scriptId, episodeId, entityId;
    const [, , , , entityType, rawEntityId] = storyboardEntityMatch;
    try {
      projectId = validatePathSegment(storyboardEntityMatch[1], 'projectId');
      scriptId = validatePathSegment(storyboardEntityMatch[2], 'scriptId');
      episodeId = validatePathSegment(storyboardEntityMatch[3], 'episodeId');
      entityId = validatePathSegment(rawEntityId, `${entityType.slice(0, -1)}Id`);
    } catch (err) {
      sendJson(response, 400, { error: err.message || 'Invalid storyboard entity locator' });
      return true;
    }

    const episodeLockKey = `${projectId}/${scriptId}/${episodeId}`;
    await withRunLock(episodeLockKey, async () => {
      const requestedRunId = searchParams.get('runId') || searchParams.get('run') || null;
      const resolvedEpisodePayload = resolveEpisodePayload(projectId, scriptId, episodeId, {
        projectStoreBaseTempDir, runJobs, workspaceRoot, runId: requestedRunId,
      });
      const { episode } = resolvedEpisodePayload;
      if (!episode) {
        sendJson(response, 404, { error: 'Episode not found' });
        return;
      }

      const body = await safeParseBody(request, response); if (body === null) return;
      const updates = sanitizeEntityUpdate(body);
      const target = findEpisodeEntity(episode, entityType, entityId);
      let nextEntity = null;
      if (!target) {
        if (entityType !== 'voices') {
          sendJson(response, 404, { error: `${entityType.slice(0, -1)} not found` });
          return;
        }
        nextEntity = { id: entityId, name: updates.name || entityId, ...updates };
        const voices = Array.isArray(episode.voices) ? episode.voices : [];
        voices.push(nextEntity);
        episode.voices = voices;
      } else {
        nextEntity = { ...target.entity, ...updates };
        target.list[target.index] = nextEntity;
        episode[target.key] = target.list;
      }
      if (entityType === 'shots' && Object.prototype.hasOwnProperty.call(updates, 'durationSec')) {
        nextEntity.duration = updates.durationSec;
      }
      if (entityType === 'characters') {
        syncEpisodeCharacterCopies(episode, nextEntity);
      }
      episode.updatedAt = new Date().toISOString();
      persistResolvedEpisode(projectId, scriptId, resolvedEpisodePayload, episode, { projectStoreBaseTempDir });

      sendJson(response, 200, { success: true, entityType, entity: nextEntity });
    });
    return true;
  }

  // GET /episodes/:eid
  const episodeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/episodes\/([^/]+)$/);
  if (episodeMatch) {
    let projectId, scriptId, episodeId;
    try {
      projectId = validatePathSegment(episodeMatch[1], 'projectId');
      scriptId = validatePathSegment(episodeMatch[2], 'scriptId');
      episodeId = validatePathSegment(episodeMatch[3], 'episodeId');
    } catch (err) {
      sendJson(response, 400, { error: err.message || 'Invalid episode locator' });
      return true;
    }
    const requestedRunId = searchParams.get('runId') || searchParams.get('run') || null;
    const { episode } = resolveEpisodePayload(projectId, scriptId, episodeId, {
      projectStoreBaseTempDir, runJobs, workspaceRoot, runId: requestedRunId,
    });
    sendJson(response, episode ? 200 : 404, episode || { error: 'Episode not found' });
    return true;
  }

  return false;
}
