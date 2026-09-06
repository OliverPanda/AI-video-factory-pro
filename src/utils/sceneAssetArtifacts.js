import path from 'node:path';

import { saveJSON } from './fileHelper.js';
import {
  buildSceneStableReferencePacks,
  updateSceneStableReferencePack,
  normalizeSceneReferenceList,
} from './sceneReferenceContracts.js';

function normalizeString(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => normalizeString(value)).filter(Boolean))];
}

function buildSceneShotIds(scenePack = {}) {
  return uniqueStrings(
    (Array.isArray(scenePack.action_beats) ? scenePack.action_beats : []).flatMap((beat) =>
      Array.isArray(beat?.shot_ids) ? beat.shot_ids : []
    )
  );
}

function buildIssueLines(flaggedTransitions = []) {
  return (Array.isArray(flaggedTransitions) ? flaggedTransitions : []).map((item) => {
    const tags = uniqueStrings([...(item?.hardViolationCodes || []), ...(item?.violations || [])]);
    const suffix = tags.length > 0 ? `：${tags.join('、')}` : '';
    return `${item?.previousShotId || 'unknown'} -> ${item?.shotId || 'unknown'}${suffix}`;
  });
}

export function buildSceneAssetRecords({
  scenePacks = [],
  shots = [],
  imageResults = [],
  continuityResult = null,
  sceneStableReferencePacks = [],
} = {}) {
  const shotById = new Map((Array.isArray(shots) ? shots : []).map((shot) => [shot?.id, shot]));
  const imageByShotId = new Map(
    (Array.isArray(imageResults) ? imageResults : [])
      .filter((entry) => entry?.shotId)
      .map((entry) => [entry.shotId, entry])
  );
  const reports = Array.isArray(continuityResult?.reports) ? continuityResult.reports : [];
  const flaggedTransitions = Array.isArray(continuityResult?.flaggedTransitions)
    ? continuityResult.flaggedTransitions
    : [];

  return (Array.isArray(scenePacks) ? scenePacks : []).map((scenePack) => {
    const shotIds = buildSceneShotIds(scenePack);
    const sceneShots = shotIds.map((shotId) => shotById.get(shotId)).filter(Boolean);
    const sceneImages = shotIds
      .map((shotId) => imageByShotId.get(shotId))
      .filter((entry) => entry?.success !== false && entry?.imagePath);
    const sceneReports = reports.filter(
      (report) => shotIds.includes(report?.shotId) || shotIds.includes(report?.previousShotId)
    );
    const sceneFlags = flaggedTransitions.filter(
      (item) => shotIds.includes(item?.shotId) || shotIds.includes(item?.previousShotId)
    );
    const continuityScore = sceneReports.length > 0
      ? sceneReports.reduce((sum, item) => sum + Number(item?.continuityScore || 0), 0) / sceneReports.length
      : null;
    const sceneStablePack = (Array.isArray(sceneStableReferencePacks) ? sceneStableReferencePacks : []).find(
      (item) => String(item?.sceneId || '').trim() === String(scenePack.scene_id || scenePack.id || '').trim()
    ) || null;
    const approvedSceneFrames = Array.isArray(sceneStablePack?.approvedSceneFrames)
      ? sceneStablePack.approvedSceneFrames
      : [];

    return {
      sceneId: normalizeString(scenePack.scene_id || scenePack.id, 'scene'),
      title: normalizeString(scenePack.scene_title || scenePack.title || scenePack.location_anchor, '未命名场景'),
      location: normalizeString(scenePack.location_anchor || scenePack.location, '未记录空间锚点'),
      goal: normalizeString(scenePack.scene_goal || scenePack.goal, '未记录场景目标'),
      visualMotif: normalizeString(scenePack.visual_motif || scenePack.visualMotif, '未记录视觉母题'),
      cast: uniqueStrings(scenePack.cast),
      sceneContractReady: normalizeSceneReferenceList([
        ...(sceneStablePack?.canonicalSceneRefs || []),
        sceneStablePack?.bestStableSceneFramePath,
      ]).length > 0,
      canonicalSceneRefCount: normalizeSceneReferenceList(sceneStablePack?.canonicalSceneRefs || []).length,
      stableSceneFrameReady: Boolean(sceneStablePack?.bestStableSceneFramePath),
      lastSceneSimilarityScore: Number(sceneStablePack?.bestStableSceneScore || continuityScore || 0),
      lastContinuityScore: continuityScore,
      blockedReason:
        sceneFlags.length > 0
          ? 'continuity_or_scene_precheck_failed'
          : null,
      shotIds,
      shotCount: shotIds.length,
      anchorImagePath: normalizeString(sceneImages[0]?.imagePath || '', ''),
      bestFramePath: normalizeString(sceneImages.at(-1)?.imagePath || sceneImages[0]?.imagePath || '', ''),
      continuityLocks: uniqueStrings(scenePack.hard_locks),
      validationIssues: uniqueStrings([
        ...(Array.isArray(scenePack.validation_issues) ? scenePack.validation_issues : []),
        ...buildIssueLines(sceneFlags),
      ]),
      continuityScore,
      continuityStatus:
        sceneFlags.length > 0 || (continuityScore !== null && continuityScore < 7)
          ? 'warn'
          : 'pass',
      continuityIssueCount: sceneFlags.length,
      representativeShotId: normalizeString(sceneShots[0]?.id || '', ''),
      approvedSceneFrames,
      sceneStablePack,
    };
  });
}

export function writeSceneAssetArtifacts(sceneAssets = [], artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = {
    sceneAssetCount: sceneAssets.length,
    withAnchorImageCount: sceneAssets.filter((item) => item.anchorImagePath).length,
    withContinuityWarningCount: sceneAssets.filter((item) => item.continuityStatus !== 'pass').length,
    stableSceneFrameReadyCount: sceneAssets.filter((item) => item.stableSceneFrameReady).length,
  };

  saveJSON(path.join(artifactContext.outputsDir, 'scene-assets.json'), sceneAssets);
  saveJSON(path.join(artifactContext.metricsDir, 'scene-asset-metrics.json'), metrics);
}

export function writeSceneStableReferencePackArtifact(sceneStableReferencePacks = [], artifactContext) {
  if (!artifactContext) {
    return;
  }
  saveJSON(path.join(artifactContext.outputsDir, 'scene-stable-reference-pack.json'), sceneStableReferencePacks);
  saveJSON(path.join(artifactContext.metricsDir, 'scene-stable-reference-pack-metrics.json'), {
    sceneCount: Array.isArray(sceneStableReferencePacks) ? sceneStableReferencePacks.length : 0,
    readyCount: (Array.isArray(sceneStableReferencePacks) ? sceneStableReferencePacks : []).filter((item) => item?.bestStableSceneFramePath).length,
  });
}

export {
  buildSceneStableReferencePacks,
  updateSceneStableReferencePack,
};
