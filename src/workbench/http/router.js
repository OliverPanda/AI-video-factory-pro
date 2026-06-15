import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

import { listRunJobs } from '../dataSources/runJobRepository.js';
import { loadQaOverview } from '../dataSources/qaOverviewRepository.js';
import { getArtifactDirectorySummary } from '../dataSources/runArtifactRepository.js';
import { buildWorkbenchViewModel } from '../transformers/workbenchViewModel.js';
import { createProject, createEpisode } from '../../domain/projectModel.js';
import { saveEpisode } from '../../utils/projectStore.js';

const DEFAULT_EPISODE_DURATION_SEC = 120;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.md': 'text/plain; charset=utf-8',
};

function safeExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendFile(response, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
  });
  fs.createReadStream(filePath).pipe(response);
}

function parseBody(request) {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}

function listManualProjects(tempProjectsDir) {
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
  return projects;
}

function loadProjectById(projectId, tempProjectsDir) {
  const filePath = path.join(tempProjectsDir, projectId, 'project.json');
  return readJsonSafe(filePath);
}

function saveProjectById(project, tempProjectsDir) {
  const projectDir = path.join(tempProjectsDir, project.id);
  if (!safeExists(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }
  const filePath = path.join(projectDir, 'project.json');
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
}

function normalizeRunStatus(runJob, qaOverview) {
  const status = String(runJob?.status || '').toLowerCase();
  if (qaOverview?.blockCount > 0) return 'block';
  if (qaOverview?.warnCount > 0) return 'warn';
  if (status === 'completed') return 'pass';
  if (status === 'failed' || status === 'error' || status === 'blocked') return 'block';
  return 'running';
}

function buildDerivedData(runJobs, workspaceRoot) {
  const qaOverviewsByRunId = {};
  const artifactSummariesByRunId = {};

  for (const runJob of runJobs) {
    qaOverviewsByRunId[runJob.id] = loadQaOverview(runJob, { workspaceRoot });
    artifactSummariesByRunId[runJob.id] = getArtifactDirectorySummary(runJob, { workspaceRoot });
  }

  const projectsMap = new Map();
  for (const runJob of runJobs) {
    const qa = qaOverviewsByRunId[runJob.id];
    if (!projectsMap.has(runJob.projectId)) {
      projectsMap.set(runJob.projectId, {
        id: runJob.projectId,
        title: runJob.scriptTitle || runJob.projectId,
        latestRunId: runJob.id,
        scripts: new Map(),
        runCount: 0,
      });
    }

    const project = projectsMap.get(runJob.projectId);
    project.runCount += 1;

    if (!project.scripts.has(runJob.scriptId)) {
      project.scripts.set(runJob.scriptId, {
        id: runJob.scriptId,
        title: runJob.scriptTitle || runJob.scriptId,
        episodes: new Map(),
      });
    }

    const script = project.scripts.get(runJob.scriptId);
    if (!script.episodes.has(runJob.episodeId)) {
      script.episodes.set(runJob.episodeId, {
        id: runJob.episodeId,
        title: runJob.episodeTitle || runJob.episodeId,
        runs: [],
      });
    }

    script.episodes.get(runJob.episodeId).runs.push({
      id: runJob.id,
      status: normalizeRunStatus(runJob, qa),
      headline: qa.headline || '',
      startedAt: runJob.startedAt,
      finishedAt: runJob.finishedAt,
    });
  }

  const projects = [...projectsMap.values()].map((project) => ({
    id: project.id,
    title: project.title,
    latestRunId: project.latestRunId,
    runCount: project.runCount,
    scripts: [...project.scripts.values()].map((script) => ({
      id: script.id,
      title: script.title,
      episodes: [...script.episodes.values()].map((episode) => ({
        id: episode.id,
        title: episode.title,
        runs: episode.runs,
      })),
    })),
  }));

  return {
    qaOverviewsByRunId,
    artifactSummariesByRunId,
    projects,
  };
}

function safeStaticPath(requestPath, workspaceRoot) {
  const pathname = decodeURIComponent(requestPath.split('?')[0]);
  const normalized = pathname;
  const absolute = path.normalize(path.join(workspaceRoot, normalized));
  if (!absolute.startsWith(workspaceRoot)) {
    return null;
  }
  return absolute;
}

export function createWorkbenchServer({
  workspaceRoot,
  tempProjectsDir = path.join(workspaceRoot, 'temp', 'projects'),
} = {}) {
  return http.createServer(async (request, response) => {
    const requestPath = request.url || '/';
    const pathname = decodeURIComponent(requestPath.split('?')[0]);
    const runJobs = listRunJobs({ tempProjectsDir });
    const derived = buildDerivedData(runJobs, workspaceRoot);
    const workbenchModel = buildWorkbenchViewModel({
      runJobs,
      qaOverviewsByRunId: derived.qaOverviewsByRunId,
      artifactSummariesByRunId: derived.artifactSummariesByRunId,
    });

    if (pathname === '/api/workbench') {
      return sendJson(response, 200, workbenchModel);
    }

    if (pathname === '/api/projects') {
      const method = request.method || 'GET';

      if (method === 'POST') {
        try {
          const body = await parseBody(request);
          if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
            return sendJson(response, 400, { error: '项目名称不能为空' });
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
          return sendJson(response, 201, project);
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to create project: ${err.message}` });
        }
      }

      // GET
      const manualProjects = listManualProjects(tempProjectsDir);
      const derivedIds = new Set(derived.projects.map(p => p.id));

      const allProjects = [...derived.projects.map((project) => ({
        id: project.id,
        title: project.title,
        latestRunId: project.latestRunId,
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

      return sendJson(response, 200, allProjects);
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      const projectId = projectMatch[1];
      const method = request.method || 'GET';

      if (method === 'PUT') {
        try {
          const body = await parseBody(request);
          const existing = loadProjectById(projectId, tempProjectsDir);
          if (!existing) {
            return sendJson(response, 404, { error: 'Project not found' });
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
          return sendJson(response, 200, updated);
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to update project: ${err.message}` });
        }
      }

      if (method === 'DELETE') {
        try {
          const projectDir = path.join(tempProjectsDir, projectId);
          if (!safeExists(projectDir)) {
            return sendJson(response, 404, { error: 'Project not found' });
          }
          fs.rmSync(projectDir, { recursive: true, force: true });
          return sendJson(response, 200, { success: true, id: projectId });
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to delete project: ${err.message}` });
        }
      }

      // GET
      const project = derived.projects.find((item) => item.id === projectId);
      if (project) {
        return sendJson(response, 200, project);
      }

      const manualProject = loadProjectById(projectId, tempProjectsDir);
      if (manualProject) {
        return sendJson(response, 200, {
          id: manualProject.id || projectId,
          title: manualProject.title || projectId,
          description: manualProject.description || '',
          genre: manualProject.genre || null,
          style: manualProject.style || null,
          coverUrl: manualProject.coverUrl || null,
          aspectRatio: manualProject.aspectRatio || '9:16',
          latestRunId: null,
          runCount: 0,
          scripts: [],
        });
      }

      return sendJson(response, 404, { error: 'Project not found' });
    }

    const episodeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/episodes\/([^/]+)$/);
    if (episodeMatch) {
      const [, projectId, scriptId, episodeId] = episodeMatch;
      const project = derived.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      const episode = script?.episodes.find((item) => item.id === episodeId);
      return sendJson(response, episode ? 200 : 404, episode || { error: 'Episode not found' });
    }

    // ── Script CRUD ──────────────────────────────────────────
    const scriptsListMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts$/);
    if (scriptsListMatch && !pathname.includes('/episodes/')) {
      const targetProjectId = scriptsListMatch[1];
      const method = request.method || 'GET';

      const projectDir = path.join(tempProjectsDir, targetProjectId);
      const scriptsIndex = path.join(projectDir, 'scripts.json');
      const scriptsDir = path.join(projectDir, 'uploaded-scripts');

      if (method === 'POST') {
        try {
          const body = await parseBody(request);
          if (!body.title || typeof body.title !== 'string') {
            return sendJson(response, 400, { error: '剧本标题不能为空' });
          }
          if (!body.content || typeof body.content !== 'string') {
            return sendJson(response, 400, { error: '剧本内容不能为空' });
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
            episodeId
          };

          // Ensure directories & index
          if (!safeExists(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
          const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];
          index.push(entry);
          fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');

          // Write content file
          fs.writeFileSync(path.join(scriptsDir, `${scriptId}.txt`), body.content, 'utf8');

          // Create minimal episode structure for pipeline
          const episode = createEpisode({
            id: episodeId,
            projectId: targetProjectId,
            scriptId: scriptId,
            title: body.title.trim(),
            summary: null,
            targetDurationSec: DEFAULT_EPISODE_DURATION_SEC,
            shots: [],
          });
          
          // Save episode using projectStore
          const baseTempDir = path.join(workspaceRoot, 'temp');
          saveEpisode(targetProjectId, scriptId, episode, { baseTempDir });

          return sendJson(response, 201, entry);
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to upload script: ${err.message}` });
        }
      }

      // GET — list scripts
      const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];

      // Migration: Create episodes for scripts that don't have episodeId
      const baseTempDir = path.join(workspaceRoot, 'temp');
      let migrationNeeded = false;
      for (const script of index) {
        if (!script.episodeId) {
          const episodeId = `episode_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          script.episodeId = episodeId;

          // Create episode
          const episode = createEpisode({
            id: episodeId,
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
      }

      if (migrationNeeded) {
        fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
      }

      return sendJson(response, 200, index);
    }

    const scriptDetailMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)$/);
    if (scriptDetailMatch && !pathname.includes('/episodes/')) {
      const [, targetProjectId, scriptId] = scriptDetailMatch;
      const method = request.method || 'GET';

      const projectDir = path.join(tempProjectsDir, targetProjectId);
      const scriptsIndex = path.join(projectDir, 'scripts.json');
      const scriptsDir = path.join(projectDir, 'uploaded-scripts');
      const contentFile = path.join(scriptsDir, `${scriptId}.txt`);

      const index = safeExists(scriptsIndex) ? (readJsonSafe(scriptsIndex) || []) : [];
      const entryIndex = index.findIndex((s) => s.id === scriptId);

      if (entryIndex < 0) {
        return sendJson(response, 404, { error: 'Script not found' });
      }

      if (method === 'PUT') {
        try {
          const body = await parseBody(request);
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

          return sendJson(response, 200, entry);
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to update script: ${err.message}` });
        }
      }

      if (method === 'DELETE') {
        try {
          index.splice(entryIndex, 1);
          fs.writeFileSync(scriptsIndex, JSON.stringify(index, null, 2), 'utf8');
          if (safeExists(contentFile)) fs.unlinkSync(contentFile);
          return sendJson(response, 200, { success: true, id: scriptId });
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to delete script: ${err.message}` });
        }
      }

      // GET — return entry + content
      const content = safeExists(contentFile) ? fs.readFileSync(contentFile, 'utf8') : '';
      return sendJson(response, 200, { ...index[entryIndex], content });
    }

    if (pathname === '/api/runs') {
      const method = request.method || 'GET';

      if (method === 'POST') {
        try {
          const body = await parseBody(request);
          const { projectId, scriptId, episodeId, style } = body;

          if (!projectId || !scriptId || !episodeId) {
            return sendJson(response, 400, { error: 'projectId, scriptId, episodeId are required' });
          }

          const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const args = [
            'scripts/run.js',
            `--project=${projectId}`,
            `--script=${scriptId}`,
            `--episode=${episodeId}`,
          ];
          if (style) args.push(`--style=${style}`);

          const child = spawn('node', args, {
            detached: true,
            stdio: 'ignore',
            cwd: process.cwd(),
          });
          child.unref();

          return sendJson(response, 200, {
            success: true,
            runId,
            message: 'Pipeline triggered',
          });
        } catch (err) {
          return sendJson(response, 500, { error: `Failed to trigger run: ${err.message}` });
        }
      }

      return sendJson(
        response,
        200,
        runJobs.map((runJob) => ({
          id: runJob.id,
          projectId: runJob.projectId,
          scriptId: runJob.scriptId,
          episodeId: runJob.episodeId,
          scriptTitle: runJob.scriptTitle,
          episodeTitle: runJob.episodeTitle,
          status: normalizeRunStatus(runJob, derived.qaOverviewsByRunId[runJob.id]),
          startedAt: runJob.startedAt,
          finishedAt: runJob.finishedAt,
          headline: derived.qaOverviewsByRunId[runJob.id]?.headline || '',
        }))
      );
    }

    const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch) {
      const run = runJobs.find((item) => item.id === runMatch[1]);
      if (!run) {
        return sendJson(response, 404, { error: 'Run not found' });
      }
      return sendJson(response, 200, {
        ...run,
        qaOverview: derived.qaOverviewsByRunId[run.id] || null,
        artifacts: derived.artifactSummariesByRunId[run.id] || null,
      });
    }

    const runJianyingExportMatch = pathname.match(/^\/api\/runs\/([^/]+)\/export-jianying$/);
    if (runJianyingExportMatch) {
      const run = runJobs.find((item) => item.id === runJianyingExportMatch[1]);
      if (!run) {
        return sendJson(response, 404, { error: 'Run not found' });
      }

      try {
        const snapshotPath = path.join(run.artifactRunDir, 'state.snapshot.json');
        if (!safeExists(snapshotPath)) {
          return sendJson(response, 400, { error: 'Snapshot file not found in run directory' });
        }

        const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
        const scriptShots = snapshot?.scriptData?.shots || [];
        const imageByShotId = new Map((snapshot?.imageResults || []).map((entry) => [entry.shotId, entry]));
        const videoByShotId = new Map((snapshot?.videoResults || []).map((entry) => [entry.shotId, entry]));
        const audioByShotId = new Map((snapshot?.audioResults || []).map((entry) => [entry.shotId, entry]));

        // 1. 定义 UUID 生成辅助函数
        const generateUuid = () => {
          const chars = 'abcdef0123456789';
          let res = '';
          for (let i = 0; i < 32; i++) {
            if (i === 8 || i === 12 || i === 16 || i === 20) res += '-';
            res += chars[Math.floor(Math.random() * chars.length)];
          }
          return res.toUpperCase();
        };

        const projectId = generateUuid();
        const videoTrackId = generateUuid();
        const audioTrackId = generateUuid();
        const textTrackId = generateUuid();

        const videoSegments = [];
        const audioSegments = [];
        const textSegments = [];

        const materialVideos = [];
        const materialAudios = [];
        const materialTexts = [];

        let currentTimelineUs = 0;

        // 2. 遍历各分镜，构建时间线与关联素材
        scriptShots.forEach((shot, index) => {
          const image = imageByShotId.get(shot.id);
          const video = videoByShotId.get(shot.id);
          const audio = audioByShotId.get(shot.id);

          const rawVideoPath = video?.videoPath || image?.imagePath || '';
          const rawAudioPath = audio?.audioPath || '';

          const absVideoPath = rawVideoPath ? path.resolve(workspaceRoot, rawVideoPath).replace(/\//g, '\\') : '';
          const absAudioPath = rawAudioPath ? path.resolve(workspaceRoot, rawAudioPath).replace(/\//g, '\\') : '';

          const durationUs = Math.max(1000000, Math.round((Number(shot.duration) || 3.0) * 1000000));

          // A. 视频/原画轨道段
          if (absVideoPath) {
            const materialId = generateUuid();
            const segmentId = generateUuid();

            materialVideos.push({
              "id": materialId,
              "path": absVideoPath,
              "type": video?.videoPath ? "video" : "photo",
              "duration": durationUs,
              "width": 1080,
              "height": 1920
            });

            videoSegments.push({
              "id": segmentId,
              "material_id": materialId,
              "source_timerange": { "duration": durationUs, "start": 0 },
              "target_timerange": { "duration": durationUs, "start": currentTimelineUs },
              "render_index": 10000 + index,
              "volume": 1.0,
              "speed": 1.0
            });
          }

          // B. 配音音频轨道段
          if (absAudioPath) {
            const materialId = generateUuid();
            const segmentId = generateUuid();

            materialAudios.push({
              "id": materialId,
              "path": absAudioPath,
              "type": "music",
              "duration": durationUs
            });

            audioSegments.push({
              "id": segmentId,
              "material_id": materialId,
              "source_timerange": { "duration": durationUs, "start": 0 },
              "target_timerange": { "duration": durationUs, "start": currentTimelineUs },
              "render_index": 20000 + index,
              "volume": 1.0,
              "speed": 1.0
            });
          }

          // C. 台词字幕轨道段
          if (shot.dialogue) {
            const materialId = generateUuid();
            const segmentId = generateUuid();
            
            const subtitleText = `[${shot.speaker || '未知'}] “${shot.dialogue}”`;

            materialTexts.push({
              "id": materialId,
              "content": JSON.stringify({
                "styles": [],
                "text": subtitleText
              }),
              "type": "text"
            });

            textSegments.push({
              "id": segmentId,
              "material_id": materialId,
              "source_timerange": { "duration": durationUs, "start": 0 },
              "target_timerange": { "duration": durationUs, "start": currentTimelineUs },
              "render_index": 30000 + index,
              "speed": 1.0
            });
          }

          currentTimelineUs += durationUs;
        });

        // 3. 构建完整的 draft_content.json 结构
        const draftContent = {
          "canvas_config": {
            "height": 1920,
            "width": 1080,
            "ratio": "9:16"
          },
          "duration": currentTimelineUs,
          "id": projectId,
          "materials": {
            "videos": materialVideos,
            "audios": materialAudios,
            "texts": materialTexts
          },
          "tracks": [
            {
              "id": videoTrackId,
              "type": "video",
              "segments": videoSegments
            },
            {
              "id": audioTrackId,
              "type": "audio",
              "segments": audioSegments
            },
            {
              "id": textTrackId,
              "type": "text",
              "segments": textSegments
            }
          ]
        };

        // 4. 定位并创建本地剪映草稿目录
        const projectTitle = run.scriptTitle || 'AI漫剧';
        const episodeTitle = run.episodeTitle || run.episodeId || '默认分集';
        const folderName = `[AI漫剧]_${projectTitle}_${episodeTitle}_${run.id.slice(0, 8)}`;

        const userProfile = process.env.USERPROFILE || 'C:\\Users\\default';
        const capcutProjectsBase = path.join(userProfile, 'AppData', 'Local', 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
        
        let targetFolder = '';
        let isDirectToCapcut = false;

        if (safeExists(capcutProjectsBase)) {
          targetFolder = path.join(capcutProjectsBase, folderName);
          isDirectToCapcut = true;
        } else {
          // 降级生成到项目根目录 output/CapCut_Draft/ 下
          const fallbackBase = path.join(workspaceRoot, 'output', 'CapCut_Draft');
          if (!safeExists(fallbackBase)) {
            fs.mkdirSync(fallbackBase, { recursive: true });
          }
          targetFolder = path.join(fallbackBase, folderName);
        }

        if (!safeExists(targetFolder)) {
          fs.mkdirSync(targetFolder, { recursive: true });
        }

        // 5. 写入草稿主体和元数据
        const draftMeta = {
          "draft_id": projectId,
          "draft_name": folderName,
          "draft_fold_path": targetFolder,
          "tm_draft_create": Date.now(),
          "tm_draft_modified": Date.now(),
          "draft_type": "draft_type_jianying",
          "draft_version": "13.0.0"
        };

        fs.writeFileSync(path.join(targetFolder, 'draft_content.json'), JSON.stringify(draftContent, null, 2), 'utf8');
        fs.writeFileSync(path.join(targetFolder, 'draft_meta_info.json'), JSON.stringify(draftMeta, null, 2), 'utf8');

        return sendJson(response, 200, {
          success: true,
          directToCapcut: isDirectToCapcut,
          projectName: folderName,
          exportPath: targetFolder,
          durationSec: currentTimelineUs / 1000000
        });
      } catch (err) {
        return sendJson(response, 500, { error: `Failed to export Jianying draft: ${err.message}` });
      }
    }

    const runQaMatch = pathname.match(/^\/api\/runs\/([^/]+)\/qa$/);
    if (runQaMatch) {
      const qa = derived.qaOverviewsByRunId[runQaMatch[1]];
      return sendJson(response, qa ? 200 : 404, qa || { error: 'Run QA not found' });
    }

    const runArtifactsMatch = pathname.match(/^\/api\/runs\/([^/]+)\/artifacts$/);
    if (runArtifactsMatch) {
      const artifacts = derived.artifactSummariesByRunId[runArtifactsMatch[1]];
      return sendJson(response, artifacts ? 200 : 404, artifacts || { error: 'Run artifacts not found' });
    }

    if (pathname === '/api/assets/characters') {
      return sendJson(response, 200, {
        source: 'filesystem-artifacts',
        items: [
          {
            title: workbenchModel.currentRun.displayTitle,
            summary: '角色资产页当前从运行上下文聚合入口，后续接入真实角色档案文件。',
          },
        ],
      });
    }

    if (pathname === '/api/assets/videos') {
      return sendJson(response, 200, {
        source: 'filesystem-artifacts',
        items: runJobs.slice(0, 12).map((runJob) => ({
          id: runJob.id,
          title: `${runJob.scriptTitle || '未命名脚本'} / ${runJob.episodeTitle || runJob.episodeId || '未命名分集'}`,
          status: normalizeRunStatus(runJob, derived.qaOverviewsByRunId[runJob.id]),
          artifactRunDir: runJob.artifactRunDir,
        })),
      });
    }

    if (pathname === '/api/settings/providers') {
      return sendJson(response, 200, {
        workbenchApiBase: `http://127.0.0.1:${process.env.WORKBENCH_PORT || 4180}/api`,
        frontendDevServer: null,
        mode: 'api-only-workbench',
        note: '当前仅保留只读 API 与本地产物访问能力，不再提供内置前端 UI。',
      });
    }

    if (pathname === '/') {
      return sendJson(response, 200, {
        name: 'AI Video Factory Workbench API',
        mode: 'api-only-workbench',
        endpoints: ['/api/workbench', '/api/projects', '/api/runs', '/api/settings/providers'],
      });
    }

    const staticPath = safeStaticPath(requestPath, workspaceRoot);
    if (!staticPath || !safeExists(staticPath) || fs.statSync(staticPath).isDirectory()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }

    sendFile(response, staticPath);
  });
}

export default {
  createWorkbenchServer,
};
