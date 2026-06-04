import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

import { listRunJobs } from '../dataSources/runJobRepository.js';
import { loadQaOverview } from '../dataSources/qaOverviewRepository.js';
import { getArtifactDirectorySummary } from '../dataSources/runArtifactRepository.js';
import { buildWorkbenchViewModel } from '../transformers/workbenchViewModel.js';

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
  return http.createServer((request, response) => {
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
      return sendJson(
        response,
        200,
        derived.projects.map((project) => ({
          id: project.id,
          title: project.title,
          latestRunId: project.latestRunId,
          runCount: project.runCount,
          scriptCount: project.scripts.length,
          episodeCount: project.scripts.reduce((total, script) => total + script.episodes.length, 0),
        }))
      );
    }

    const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (projectMatch) {
      const project = derived.projects.find((item) => item.id === projectMatch[1]);
      return sendJson(response, project ? 200 : 404, project || { error: 'Project not found' });
    }

    const episodeMatch = pathname.match(/^\/api\/projects\/([^/]+)\/scripts\/([^/]+)\/episodes\/([^/]+)$/);
    if (episodeMatch) {
      const [, projectId, scriptId, episodeId] = episodeMatch;
      const project = derived.projects.find((item) => item.id === projectId);
      const script = project?.scripts.find((item) => item.id === scriptId);
      const episode = script?.episodes.find((item) => item.id === episodeId);
      return sendJson(response, episode ? 200 : 404, episode || { error: 'Episode not found' });
    }

    if (pathname === '/api/runs') {
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
