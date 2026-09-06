import fs from 'node:fs';
import path from 'node:path';
import { createEpisode } from '../../domain/projectModel.js';
import { saveEpisode, saveScript } from '../../utils/projectStore.js';
import { getEpisodeDir, loadJSON } from '../../utils/fileHelper.js';
import { parseScript } from '../../agents/scriptParser.js';
import { validatePathSegment, safeExists } from './pathSecurity.js';
import { sendJson } from './httpResponseHelpers.js';
import { safeParseBody } from './bodyParser.js';
import { normalizeProfessionalScriptText, professionalizeScriptContent } from './scriptHelpers.js';

const DEFAULT_EPISODE_DURATION_SEC = 120;

// ── Script Parse Metadata Helpers ──────────────────────

export function buildScriptParseMetadata({ ok, shotCount = 0, error = null, parsedAt = new Date().toISOString() } = {}) {
  return {
    parseOk: Boolean(ok),
    parseError: error ? String(error) : null,
    shotCount: Number.isFinite(Number(shotCount)) ? Number(shotCount) : 0,
    lastParsedAt: parsedAt,
  };
}

export function applyScriptParseMetadata(entry, metadata = {}) {
  if (!entry || !metadata) return entry;
  entry.parseOk = metadata.parseOk === true;
  entry.parseError = metadata.parseError || null;
  entry.shotCount = Number(metadata.shotCount || 0);
  entry.lastParsedAt = metadata.lastParsedAt || new Date().toISOString();
  return entry;
}

export function getScriptParseMetadataFromScript(script = {}) {
  const parserMetadata = script?.parserMetadata || {};
  if (Object.prototype.hasOwnProperty.call(script, 'parseOk')) {
    return buildScriptParseMetadata({
      ok: script.parseOk === true,
      error: script.parseError || parserMetadata.lastParseError || null,
      shotCount: script.shotCount || 0,
      parsedAt: script.lastParsedAt || parserMetadata.lastParseErrorAt || script.updatedAt,
    });
  }
  if (parserMetadata.lastParseError) {
    return buildScriptParseMetadata({
      ok: false,
      error: parserMetadata.lastParseError,
      shotCount: 0,
      parsedAt: parserMetadata.lastParseErrorAt || script.updatedAt,
    });
  }
  return buildScriptParseMetadata({
    ok: Number(script.shotCount || 0) > 0,
    shotCount: script.shotCount || 0,
    parsedAt: script.updatedAt,
  });
}

function readJsonSafe(filePath) {
  return loadJSON(filePath);
}

export function readProjectScriptJson(projectStoreBaseTempDir, projectId, scriptId) {
  return readJsonSafe(path.join(
    projectStoreBaseTempDir,
    'projects',
    projectId,
    'scripts',
    scriptId,
    'script.json'
  ));
}

function enrichScriptEntryWithParseState(entry, projectStoreBaseTempDir, projectId) {
  if (!entry?.id) return entry;
  const scriptJson = readProjectScriptJson(projectStoreBaseTempDir, projectId, entry.id);
  if (!scriptJson) return entry;
  const metadata = getScriptParseMetadataFromScript(scriptJson);
  if (metadata.parseOk !== true && entry.episodeId) {
    const episode = readJsonSafe(path.join(
      projectStoreBaseTempDir,
      'projects',
      projectId,
      'scripts',
      entry.id,
      'episodes',
      entry.episodeId,
      'episode.json'
    ));
    const shotCount = Array.isArray(episode?.shots) ? episode.shots.length : 0;
    if (shotCount > 0 && !metadata.parseError) {
      return applyScriptParseMetadata(entry, buildScriptParseMetadata({
        ok: true,
        shotCount,
        parsedAt: scriptJson.updatedAt || episode.updatedAt,
      }));
    }
  }
  return applyScriptParseMetadata(entry, metadata);
}

export async function syncRunnableScriptFiles({
  projectId,
  scriptEntry,
  content,
  projectStoreBaseTempDir,
  inputFormat = 'professional-script',
}) {
  if (!scriptEntry?.id) return null;

  const now = new Date().toISOString();
  let parseMetadata = buildScriptParseMetadata({ ok: false, parsedAt: now });
  const runnableContent = inputFormat === 'professional-script'
    ? (normalizeProfessionalScriptText(content, { title: scriptEntry.title }) || content)
    : content;
  const existingScript = readProjectScriptJson(projectStoreBaseTempDir, projectId, scriptEntry.id) || {};

  const nextScript = {
    ...existingScript,
    id: scriptEntry.id,
    projectId,
    title: scriptEntry.title,
    content: runnableContent,
    sourceText: runnableContent,
    characters: Array.isArray(existingScript.characters) ? existingScript.characters : [],
    mainCharacterTemplates: Array.isArray(existingScript.mainCharacterTemplates) ? existingScript.mainCharacterTemplates : [],
    createdAt: existingScript.createdAt || scriptEntry.createdAt || now,
    updatedAt: now,
  };

  try {
    const parsed = await parseScript(runnableContent, { inputFormat, title: scriptEntry.title });
    nextScript.title = parsed.title || nextScript.title;
    nextScript.characters = Array.isArray(parsed.characters) ? parsed.characters : nextScript.characters;
    parseMetadata = buildScriptParseMetadata({
      ok: true,
      shotCount: Array.isArray(parsed.shots) ? parsed.shots.length : 0,
      parsedAt: now,
    });
    nextScript.parserMetadata = {
      ...(parsed.parserMetadata || nextScript.parserMetadata || {}),
      lastParseError: null,
      lastParseErrorAt: null,
    };
    nextScript.professionalStructure = parsed.professionalStructure || nextScript.professionalStructure;

    const episodeId = scriptEntry.episodeId;
    if (episodeId) {
      const existingEpisode = readJsonSafe(path.join(
        projectStoreBaseTempDir,
        'projects',
        projectId,
        'scripts',
        scriptEntry.id,
        'episodes',
        episodeId,
        'episode.json'
      )) || {};
      const nextEpisode = createEpisode({
        ...existingEpisode,
        id: episodeId,
        projectId,
        scriptId: scriptEntry.id,
        title: parsed.title || scriptEntry.title || existingEpisode.title,
        summary: existingEpisode.summary || null,
        targetDurationSec: existingEpisode.targetDurationSec || DEFAULT_EPISODE_DURATION_SEC,
        shots: Array.isArray(parsed.shots) ? parsed.shots : [],
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        updatedAt: now,
      });
      saveEpisode(projectId, scriptEntry.id, nextEpisode, { baseTempDir: projectStoreBaseTempDir });
    }
  } catch (err) {
    parseMetadata = buildScriptParseMetadata({
      ok: false,
      error: err.message || String(err),
      parsedAt: now,
    });
    nextScript.parserMetadata = {
      ...(nextScript.parserMetadata || {}),
      lastParseError: err.message || String(err),
      lastParseErrorAt: now,
      inputFormat,
    };
    const episodeId = scriptEntry.episodeId;
    if (episodeId) {
      const existingEpisode = readJsonSafe(path.join(
        projectStoreBaseTempDir,
        'projects',
        projectId,
        'scripts',
        scriptEntry.id,
        'episodes',
        episodeId,
        'episode.json'
      )) || {};
      const nextEpisode = createEpisode({
        ...existingEpisode,
        id: episodeId,
        projectId,
        scriptId: scriptEntry.id,
        title: scriptEntry.title || existingEpisode.title,
        summary: existingEpisode.summary || null,
        targetDurationSec: existingEpisode.targetDurationSec || DEFAULT_EPISODE_DURATION_SEC,
        shots: [],
        characters: [],
        updatedAt: now,
      });
      saveEpisode(projectId, scriptEntry.id, nextEpisode, { baseTempDir: projectStoreBaseTempDir });
    }
  }

  nextScript.parseOk = parseMetadata.parseOk;
  nextScript.parseError = parseMetadata.parseError;
  nextScript.shotCount = parseMetadata.shotCount;
  nextScript.lastParsedAt = parseMetadata.lastParsedAt;
  applyScriptParseMetadata(scriptEntry, parseMetadata);
  saveScript(projectId, nextScript, { baseTempDir: projectStoreBaseTempDir });
  return {
    ...parseMetadata,
    content: runnableContent,
    script: nextScript,
  };
}

function readScriptIndexEntry(tempProjectsDir, projectId, scriptId) {
  const scriptsIndex = path.join(tempProjectsDir, projectId, 'scripts.json');
  const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];
  const entryIndex = index.findIndex((item) => item?.id === scriptId);
  return {
    scriptsIndex,
    index,
    entryIndex,
    entry: entryIndex >= 0 ? index[entryIndex] : null,
  };
}

export async function ensureRunnableScriptForRun({
  projectId,
  scriptId,
  episodeId,
  tempProjectsDir,
  projectStoreBaseTempDir,
  inputFormat = 'professional-script',
}) {
  const { scriptsIndex, index, entryIndex, entry } = readScriptIndexEntry(tempProjectsDir, projectId, scriptId);
  const scriptJson = readProjectScriptJson(projectStoreBaseTempDir, projectId, scriptId) || {};
  const contentFile = path.join(tempProjectsDir, projectId, 'uploaded-scripts', `${scriptId}.txt`);
  const fileContent = safeExists(contentFile) ? fs.readFileSync(contentFile, 'utf8') : '';
  const currentContent = fileContent || scriptJson.sourceText || scriptJson.content || '';
  const scriptEntry = {
    ...(entry || {}),
    id: scriptId,
    title: entry?.title || scriptJson.title || scriptId,
    createdAt: entry?.createdAt || scriptJson.createdAt || new Date().toISOString(),
    updatedAt: entry?.updatedAt || scriptJson.updatedAt || new Date().toISOString(),
    charCount: currentContent.length,
    episodeId: entry?.episodeId || episodeId,
  };
  const existingEpisode = readJsonSafe(path.join(
    projectStoreBaseTempDir,
    'projects',
    projectId,
    'scripts',
    scriptId,
    'episodes',
    episodeId,
    'episode.json'
  ));
  const scriptParseState = getScriptParseMetadataFromScript(scriptJson);
  const scriptContent = String(scriptJson.sourceText || scriptJson.content || '');
  const needsSync =
    !existingEpisode ||
    !Array.isArray(existingEpisode.shots) ||
    existingEpisode.shots.length === 0 ||
    scriptParseState.parseOk !== true ||
    (fileContent && fileContent !== scriptContent);

  let syncResult = {
    ...scriptParseState,
    content: currentContent,
    script: scriptJson,
  };
  if (needsSync) {
    syncResult = await syncRunnableScriptFiles({
      projectId,
      scriptEntry,
      content: currentContent,
      projectStoreBaseTempDir,
      inputFormat,
    });
    if (entryIndex >= 0) {
      index[entryIndex] = scriptEntry;
      fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
    }
  }

  const episode = readJsonSafe(path.join(
    projectStoreBaseTempDir,
    'projects',
    projectId,
    'scripts',
    scriptId,
    'episodes',
    episodeId,
    'episode.json'
  ));
  const shotCount = Array.isArray(episode?.shots) ? episode.shots.length : 0;
  return {
    episode,
    script: readProjectScriptJson(projectStoreBaseTempDir, projectId, scriptId) || syncResult.script || scriptJson,
    entry: scriptEntry,
    parseOk: syncResult.parseOk === true && shotCount > 0,
    parseError: syncResult.parseError || (shotCount > 0 ? null : '剧本解析后没有得到任何分镜'),
    shotCount,
  };
}

// ── Script Route Handlers ──────────────────────────────

export async function handleScriptRoutes(request, response, {
  pathname, method, tempProjectsDir, workspaceRoot, projectStoreBaseTempDir,
  scriptProfessionalizeChat,
}) {
  // POST /api/scripts/professionalize
  if (pathname === '/api/scripts/professionalize' && method === 'POST') {
    try {
      const body = await safeParseBody(request, response); if (body === null) return true;
      const optimized = await professionalizeScriptContent({
        title: body.title,
        content: body.content,
        workspaceRoot,
        chatText: scriptProfessionalizeChat,
      });
      sendJson(response, 200, {
        content: optimized.content,
        charCount: optimized.content.length,
        source: optimized.source,
        cached: optimized.cached === true,
        parseOk: true,
      });
      return true;
    } catch (err) {
      sendJson(response, 400, { error: err.message || '剧本优化失败' });
      return true;
    }
  }

  // Script CRUD routes
  const scriptsListMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts$/);
  if (scriptsListMatch && !pathname.includes('/episodes/')) {
    let targetProjectId;
    try {
      targetProjectId = validatePathSegment(scriptsListMatch[1], 'projectId');
    } catch (err) {
      sendJson(response, 400, { error: err.message || 'Invalid projectId' });
      return true;
    }

    const projectDir = path.join(tempProjectsDir, targetProjectId);
    const scriptsIndex = path.join(projectDir, 'scripts.json');
    const scriptsDir = path.join(projectDir, 'uploaded-scripts');

    if (method === 'POST') {
      try {
        const body = await safeParseBody(request, response); if (body === null) return true;
        if (!body.title || typeof body.title !== 'string') {
          sendJson(response, 400, { error: '剧本标题不能为空' });
          return true;
        }
        if (!body.content || typeof body.content !== 'string') {
          sendJson(response, 400, { error: '剧本内容不能为空' });
          return true;
        }

        const scriptId = `script_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const episodeId = `episode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const now = new Date().toISOString();
        const entry = {
          id: scriptId,
          title: body.title.trim(),
          createdAt: now,
          updatedAt: now,
          charCount: body.content.length,
          episodeId,
        };

        if (!safeExists(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
        const index = safeExists(scriptsIndex) ? (JSON.parse(fs.readFileSync(scriptsIndex, 'utf8')) || []) : [];
        index.push(entry);
        fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
        fs.writeFileSync(path.join(scriptsDir, `${scriptId}.txt`), body.content, 'utf8');

        const episode = createEpisode({
          id: episodeId,
          projectId: targetProjectId,
          scriptId: scriptId,
          title: body.title.trim(),
          summary: null,
          targetDurationSec: DEFAULT_EPISODE_DURATION_SEC,
          shots: [],
        });
        const baseTempDir = projectStoreBaseTempDir || path.join(workspaceRoot, 'temp');
        saveEpisode(targetProjectId, scriptId, episode, { baseTempDir });

        const scriptData = {
          id: scriptId,
          projectId: targetProjectId,
          title: body.title.trim(),
          content: body.content,
          sourceText: body.content,
          characters: [],
          mainCharacterTemplates: [],
          createdAt: now,
          updatedAt: now,
        };
        saveScript(targetProjectId, scriptData, { baseTempDir });
        await syncRunnableScriptFiles({
          projectId: targetProjectId,
          scriptEntry: entry,
          content: body.content,
          projectStoreBaseTempDir: baseTempDir,
        });
        index[index.length - 1] = entry;
        fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');

        sendJson(response, 201, entry);
        return true;
      } catch (err) {
        sendJson(response, 500, { error: `Failed to upload script: ${err.message}` });
        return true;
      }
    }

    // GET — list scripts
    if (method === 'GET') {
      try {
        const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];
        const baseTempDir = projectStoreBaseTempDir || path.join(workspaceRoot, 'temp');
        let migrationNeeded = false;

        for (const script of index) {
          const scriptDir = path.join(tempProjectsDir, targetProjectId, 'scripts', script.id);
          const scriptJsonPath = path.join(scriptDir, 'script.json');

          if (!script.episodeId) {
            script.episodeId = `episode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            migrationNeeded = true;
          }

          const episodePath = path.join(getEpisodeDir(targetProjectId, script.id, script.episodeId, baseTempDir), 'episode.json');
          if (!safeExists(episodePath)) {
            const episode = createEpisode({
              id: script.episodeId,
              projectId: targetProjectId,
              scriptId: script.id,
              title: script.title,
              summary: null,
              targetDurationSec: DEFAULT_EPISODE_DURATION_SEC,
              shots: [],
            });
            saveEpisode(targetProjectId, script.id, episode, { baseTempDir });
            migrationNeeded = true;
          }

          const contentFile = path.join(tempProjectsDir, targetProjectId, 'uploaded-scripts', `${script.id}.txt`);
          const uploadedContent = safeExists(contentFile) ? fs.readFileSync(contentFile, 'utf8') : '';
          const scriptJson = readJsonSafe(scriptJsonPath) || {};
          const runnableContent = String(scriptJson.sourceText || scriptJson.content || '');
          if (!safeExists(scriptJsonPath) || (uploadedContent && uploadedContent !== runnableContent)) {
            await syncRunnableScriptFiles({
              projectId: targetProjectId,
              scriptEntry: script,
              content: uploadedContent,
              projectStoreBaseTempDir: baseTempDir,
            });
            migrationNeeded = true;
          }
        }

        if (migrationNeeded) {
          fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
        }

        const enrichedIndex = index.map((script) =>
          enrichScriptEntryWithParseState({ ...script }, baseTempDir, targetProjectId)
        );

        sendJson(response, 200, enrichedIndex);
        return true;
      } catch (err) {
        sendJson(response, 500, { error: `Failed to list scripts: ${err.message}` });
        return true;
      }
    }
  }

  // GET /api/projects/:pid/scripts/:sid
  const scriptDetailMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)$/);
  if (scriptDetailMatch && !pathname.includes('/episodes/')) {
    let targetProjectId;
    let scriptId;
    try {
      targetProjectId = validatePathSegment(scriptDetailMatch[1], 'projectId');
      scriptId = validatePathSegment(scriptDetailMatch[2], 'scriptId');
    } catch (err) {
      sendJson(response, 400, { error: err.message || 'Invalid script locator' });
      return true;
    }

    const projectDir = path.join(tempProjectsDir, targetProjectId);
    const scriptsIndex = path.join(projectDir, 'scripts.json');
    const scriptsDir = path.join(projectDir, 'uploaded-scripts');
    const contentFile = path.join(scriptsDir, `${scriptId}.txt`);

    const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];
    const entryIndex = index.findIndex((s) => s.id === scriptId);

    if (entryIndex < 0) {
      sendJson(response, 404, { error: 'Script not found' });
      return true;
    }

    if (method === 'PUT') {
      try {
        const body = await safeParseBody(request, response); if (body === null) return true;
        const entry = index[entryIndex];

        if (body.title != null) entry.title = body.title;
        entry.updatedAt = new Date().toISOString();

        if (body.content != null && typeof body.content === 'string') {
          if (!safeExists(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
          fs.writeFileSync(contentFile, body.content, 'utf8');
          entry.charCount = body.content.length;
        }

        index[entryIndex] = entry;
        fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');

        const nextContent = body.content != null && typeof body.content === 'string'
          ? body.content
          : (safeExists(contentFile) ? fs.readFileSync(contentFile, 'utf8') : '');
        await syncRunnableScriptFiles({
          projectId: targetProjectId,
          scriptEntry: entry,
          content: nextContent,
          projectStoreBaseTempDir,
        });
        index[entryIndex] = entry;
        fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');

        sendJson(response, 200, entry);
        return true;
      } catch (err) {
        sendJson(response, 500, { error: `Failed to update script: ${err.message}` });
        return true;
      }
    }

    if (method === 'DELETE') {
      try {
        index.splice(entryIndex, 1);
        fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
        if (safeExists(contentFile)) fs.unlinkSync(contentFile);
        sendJson(response, 200, { success: true, id: scriptId });
        return true;
      } catch (err) {
        sendJson(response, 500, { error: `Failed to delete script: ${err.message}` });
        return true;
      }
    }

    // GET — return entry + content
    const content = safeExists(contentFile) ? fs.readFileSync(contentFile, 'utf8') : '';
    const enrichedEntry = enrichScriptEntryWithParseState({ ...index[entryIndex] }, projectStoreBaseTempDir, targetProjectId);
    sendJson(response, 200, { ...enrichedEntry, content });
    return true;
  }

  return false;
}
