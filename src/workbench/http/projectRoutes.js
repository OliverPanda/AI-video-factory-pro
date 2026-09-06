import fs from 'node:fs';
import path from 'node:path';
import { sendJson } from './httpResponseHelpers.js';
import { safeParseBody } from './bodyParser.js';
import { validatePathSegment, resolvePathInside, safeExists } from './pathSecurity.js';
import { createProject } from '../../domain/projectModel.js';

const CACHE_TTL_MS = Number(process.env.WORKBENCH_CACHE_TTL_MS || 5000);
let _manualProjectsCache = null;
let _manualProjectsCacheKey = null;
let _manualProjectsCacheTimestamp = 0;

// ── Helper functions ─────────────────────────────

function listManualProjects(tempProjectsDir) {
  const now = Date.now();
  if (_manualProjectsCache && _manualProjectsCacheKey === tempProjectsDir && now - _manualProjectsCacheTimestamp < CACHE_TTL_MS) {
    return _manualProjectsCache;
  }

  const safeReadDir = (dirPath) => {
    try { return fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return []; }
  };
  const readJsonSafe = (filePath) => {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch { return null; }
  };

  const projects = [];
  if (!safeExists(tempProjectsDir)) return projects;
  const entries = safeReadDir(tempProjectsDir);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectJsonPath = path.join(tempProjectsDir, entry.name, 'project.json');
    const data = readJsonSafe(projectJsonPath);
    if (data) {
      projects.push({ ...data, id: data.id || entry.name });
    }
  }

  _manualProjectsCache = projects;
  _manualProjectsCacheKey = tempProjectsDir;
  _manualProjectsCacheTimestamp = now;

  return projects;
}

function loadProjectById(projectId, tempProjectsDir) {
  const filePath = path.join(tempProjectsDir, projectId, 'project.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

function saveProjectById(project, tempProjectsDir) {
  const dirPath = path.join(tempProjectsDir, project.id);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, 'project.json'), JSON.stringify(project, null, 2), 'utf8');
}

// ── Route handler ────────────────────────────────

export async function handleProjectRoutes(request, response, {
  pathname, method, tempProjectsDir, derived,
}) {
  if (pathname === '/api/projects') {
    if (method === 'POST') {
      try {
        const body = await safeParseBody(request, response); if (body === null) return true;
        if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
          sendJson(response, 400, { error: '项目名称不能为空' });
          return true;
        }
        const project = createProject({
          title: body.title.trim(),
          description: (body.description || '').trim() || null,
          genre: body.genre || null,
          style: body.style || null,
          coverUrl: body.coverUrl || null,
          aspectRatio: body.aspectRatio || '9:16',
        });
        saveProjectById(project, tempProjectsDir);
        sendJson(response, 201, project);
        return true;
      } catch (err) {
        sendJson(response, 500, { error: `Failed to create project: ${err.message}` });
        return true;
      }
    }

    // GET
    const manualProjects = listManualProjects(tempProjectsDir);
    const derivedIds = new Set(derived.projects.map(p => p.id));

    const allProjects = [...derived.projects.map((project) => ({
      id: project.id,
      title: project.title,
      latestRunId: project.latestRunId,
      latestRunKey: project.latestRunKey || null,
      runCount: project.runCount,
      scriptCount: project.scripts.length,
      episodeCount: project.scripts.reduce((total, script) => total + script.episodes.length, 0),
    }))];

    for (const mp of manualProjects) {
      if (!derivedIds.has(mp.id)) {
        allProjects.push({
          id: mp.id,
          title: mp.title || mp.id,
          latestRunId: null,
          latestRunKey: null,
          runCount: 0,
          scriptCount: 0,
          episodeCount: 0,
          description: mp.description || '',
          genre: mp.genre || null,
          style: mp.style || null,
          coverUrl: mp.coverUrl || null,
          aspectRatio: mp.aspectRatio || '9:16',
          status: mp.status || 'draft',
        });
      }
    }

    sendJson(response, 200, allProjects);
    return true;
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch) {
    let projectId;
    try {
      projectId = validatePathSegment(projectMatch[1], 'projectId');
    } catch (err) {
      sendJson(response, 400, { error: err.message || 'Invalid projectId' });
      return true;
    }

    if (method === 'PUT') {
      try {
        const body = await safeParseBody(request, response); if (body === null) return true;
        const existing = loadProjectById(projectId, tempProjectsDir);
        if (!existing) {
          sendJson(response, 404, { error: 'Project not found' });
          return true;
        }
        const updated = {
          ...existing,
          ...(body.title != null && { title: body.title }),
          ...(body.description != null && { description: body.description }),
          ...(body.genre != null && { genre: body.genre }),
          ...(body.style != null && { style: body.style }),
          ...(body.coverUrl != null && { coverUrl: body.coverUrl }),
          ...(body.aspectRatio != null && { aspectRatio: body.aspectRatio }),
          updatedAt: new Date().toISOString(),
        };
        saveProjectById(updated, tempProjectsDir);
        sendJson(response, 200, updated);
        return true;
      } catch (err) {
        sendJson(response, 500, { error: `Failed to update project: ${err.message}` });
        return true;
      }
    }

    if (method === 'DELETE') {
      try {
        const projectDir = resolvePathInside(tempProjectsDir, projectId, 'temp-projects');
        if (!safeExists(projectDir)) {
          sendJson(response, 404, { error: 'Project not found' });
          return true;
        }
        fs.rmSync(projectDir, { recursive: true, force: true });
        sendJson(response, 200, { success: true, id: projectId });
        return true;
      } catch (err) {
        sendJson(response, 500, { error: `Failed to delete project: ${err.message}` });
        return true;
      }
    }

    // GET
    const project = derived.projects.find((item) => item.id === projectId);
    if (project) {
      sendJson(response, 200, project);
      return true;
    }

    const manualProject = loadProjectById(projectId, tempProjectsDir);
    if (manualProject) {
      sendJson(response, 200, {
        id: manualProject.id || projectId,
        title: manualProject.title || projectId,
        description: manualProject.description || '',
        genre: manualProject.genre || null,
        style: manualProject.style || null,
        coverUrl: manualProject.coverUrl || null,
        aspectRatio: manualProject.aspectRatio || '9:16',
        latestRunId: null,
        latestRunKey: null,
        runCount: 0,
        scripts: [],
      });
      return true;
    }

    sendJson(response, 404, { error: 'Project not found' });
    return true;
  }

  return false;
}
