import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { sendJson } from './httpResponseHelpers.js';
import { safeExists } from './pathSecurity.js';

export async function handleExportRoutes(
  request,
  response,
  {
    pathname,
    workspaceRoot,
    runJobs,
  }
) {
  const runJianyingExportMatch = pathname.match(/^\/api\/runs\/([^/]+)\/export-jianying$/);
  if (!runJianyingExportMatch) {
    return false;
  }

  const run = runJobs.find((item) => item.id === runJianyingExportMatch[1]);
  if (!run) {
    sendJson(response, 404, { error: 'Run not found' });
    return true;
  }

  try {
    const snapshotPath = path.join(run.artifactRunDir, 'state.snapshot.json');
    if (!safeExists(snapshotPath)) {
      sendJson(response, 400, { error: 'Snapshot file not found in run directory' });
      return true;
    }

    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const scriptShots = snapshot?.scriptData?.shots || [];
    const imageByShotId = new Map((snapshot?.imageResults || []).map((entry) => [entry.shotId, entry]));
    const videoByShotId = new Map((snapshot?.videoResults || []).map((entry) => [entry.shotId, entry]));
    const audioByShotId = new Map((snapshot?.audioResults || []).map((entry) => [entry.shotId, entry]));

    const projectId = crypto.randomUUID();
    const videoTrackId = crypto.randomUUID();
    const audioTrackId = crypto.randomUUID();
    const textTrackId = crypto.randomUUID();

    const videoSegments = [];
    const audioSegments = [];
    const textSegments = [];

    const materialVideos = [];
    const materialAudios = [];
    const materialTexts = [];

    let currentTimelineUs = 0;

    scriptShots.forEach((shot, index) => {
      const image = imageByShotId.get(shot.id);
      const video = videoByShotId.get(shot.id);
      const audio = audioByShotId.get(shot.id);

      const rawVideoPath = video?.videoPath || image?.imagePath || '';
      const rawAudioPath = audio?.audioPath || '';

      const absVideoPath = rawVideoPath ? path.resolve(workspaceRoot, rawVideoPath).replace(/\//g, '\\') : '';
      const absAudioPath = rawAudioPath ? path.resolve(workspaceRoot, rawAudioPath).replace(/\//g, '\\') : '';

      const durationUs = Math.max(1000000, Math.round((Number(shot.duration) || 3.0) * 1000000));

      if (absVideoPath) {
        const materialId = crypto.randomUUID();
        const segmentId = crypto.randomUUID();

        materialVideos.push({
          id: materialId,
          path: absVideoPath,
          type: video?.videoPath ? 'video' : 'photo',
          duration: durationUs,
          width: 1080,
          height: 1920,
        });

        videoSegments.push({
          id: segmentId,
          material_id: materialId,
          source_timerange: { duration: durationUs, start: 0 },
          target_timerange: { duration: durationUs, start: currentTimelineUs },
          render_index: 10000 + index,
          volume: 1.0,
          speed: 1.0,
        });
      }

      if (absAudioPath) {
        const materialId = crypto.randomUUID();
        const segmentId = crypto.randomUUID();

        materialAudios.push({
          id: materialId,
          path: absAudioPath,
          type: 'music',
          duration: durationUs,
        });

        audioSegments.push({
          id: segmentId,
          material_id: materialId,
          source_timerange: { duration: durationUs, start: 0 },
          target_timerange: { duration: durationUs, start: currentTimelineUs },
          render_index: 20000 + index,
          volume: 1.0,
          speed: 1.0,
        });
      }

      if (shot.dialogue) {
        const materialId = crypto.randomUUID();
        const segmentId = crypto.randomUUID();
        const subtitleText = `[${shot.speaker || '未知'}] “${shot.dialogue}”`;

        materialTexts.push({
          id: materialId,
          content: JSON.stringify({
            styles: [],
            text: subtitleText,
          }),
          type: 'text',
        });

        textSegments.push({
          id: segmentId,
          material_id: materialId,
          source_timerange: { duration: durationUs, start: 0 },
          target_timerange: { duration: durationUs, start: currentTimelineUs },
          render_index: 30000 + index,
          speed: 1.0,
        });
      }

      currentTimelineUs += durationUs;
    });

    const draftContent = {
      canvas_config: {
        height: 1920,
        width: 1080,
        ratio: '9:16',
      },
      duration: currentTimelineUs,
      id: projectId,
      materials: {
        videos: materialVideos,
        audios: materialAudios,
        texts: materialTexts,
      },
      tracks: [
        {
          id: videoTrackId,
          type: 'video',
          segments: videoSegments,
        },
        {
          id: audioTrackId,
          type: 'audio',
          segments: audioSegments,
        },
        {
          id: textTrackId,
          type: 'text',
          segments: textSegments,
        },
      ],
    };

    const projectTitle = run.scriptTitle || 'AI漫剧';
    const episodeTitle = run.episodeTitle || run.episodeId || '默认分集';
    const folderName = `[AI漫剧]_${projectTitle}_${episodeTitle}_${run.id.slice(0, 8)}`;

    const userProfile = process.env.USERPROFILE || 'C:\\Users\\default';
    const capcutProjectsBase = path.join(
      userProfile,
      'AppData',
      'Local',
      'JianyingPro',
      'User Data',
      'Projects',
      'com.lveditor.draft'
    );

    let targetFolder = '';
    let isDirectToCapcut = false;

    if (safeExists(capcutProjectsBase)) {
      targetFolder = path.join(capcutProjectsBase, folderName);
      isDirectToCapcut = true;
    } else {
      const fallbackBase = path.join(workspaceRoot, 'output', 'CapCut_Draft');
      if (!safeExists(fallbackBase)) {
        fs.mkdirSync(fallbackBase, { recursive: true });
      }
      targetFolder = path.join(fallbackBase, folderName);
    }

    if (!safeExists(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    const draftMeta = {
      draft_id: projectId,
      draft_name: folderName,
      draft_fold_path: targetFolder,
      tm_draft_create: Date.now(),
      tm_draft_modified: Date.now(),
      draft_type: 'draft_type_jianying',
      draft_version: '13.0.0',
    };

    fs.writeFileSync(path.join(targetFolder, 'draft_content.json'), JSON.stringify(draftContent, null, 2), 'utf8');
    fs.writeFileSync(path.join(targetFolder, 'draft_meta_info.json'), JSON.stringify(draftMeta, null, 2), 'utf8');

    sendJson(response, 200, {
      success: true,
      directToCapcut: isDirectToCapcut,
      projectName: folderName,
      exportPath: targetFolder,
      durationSec: currentTimelineUs / 1000000,
    });
    return true;
  } catch (err) {
    sendJson(response, 500, { error: `Failed to export Jianying draft: ${err.message}` });
    return true;
  }
}
