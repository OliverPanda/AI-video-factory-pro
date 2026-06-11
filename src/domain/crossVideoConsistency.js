const HAPPY_HORSE_PROJECT_KEY = 'HappyHorse';
const HAPPY_HORSE_PROVIDER_KEY = 'happyhorse';

const DIMENSIONS = [
  'character_drift',
  'scene_drift',
  'pose_mismatch',
  'reference_gap',
  'bridge_coverage_gap',
  'lipsync_risk',
  'insufficient_evidence',
];

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeId(value) {
  return normalizeString(value);
}

function normalizeStatus(status) {
  const normalized = normalizeString(status).toLowerCase();
  if (['block', 'failed', 'fail', 'error'].includes(normalized)) return 'block';
  if (['warn', 'manual_review', 'warning'].includes(normalized)) return 'warn';
  return 'pass';
}

function isHappyHorseProject(projectKey) {
  return normalizeString(projectKey).toLowerCase() === HAPPY_HORSE_PROJECT_KEY.toLowerCase();
}

function normalizeProvider(value) {
  return normalizeString(value).toLowerCase().replace(/[_\s-]+/g, '');
}

function collectProviderSignals(input = {}) {
  const signals = [];
  const push = (value) => {
    const normalized = normalizeProvider(value);
    if (normalized && !['staticimage', 'fallbackdirectcut', 'skip'].includes(normalized)) {
      signals.push(normalized);
    }
  };

  push(input.videoProvider);
  push(input.runtimeVideoProvider);
  push(input.provider);
  for (const [provider, count] of Object.entries(input.providerBreakdown || input.videoProviderBreakdown || {})) {
    if (Number(count) > 0) push(provider);
  }
  for (const clip of normalizeArray(input.videoResults)
    .concat(normalizeArray(input.sequenceClipResults), normalizeArray(input.bridgeClipResults))
    .concat(normalizeArray(input.videoMetadata || input.videos || input.videoManifests))) {
    push(clip?.provider || clip?.preferredProvider);
  }

  return unique(signals);
}

function getHappyHorseProviderScope(input = {}) {
  const providers = collectProviderSignals(input);
  if (providers.length === 0) {
    return { allowed: false, reason: 'missing_happyhorse_provider_evidence', providers };
  }
  const nonHappyHorseProviders = providers.filter((provider) => provider !== HAPPY_HORSE_PROVIDER_KEY);
  return {
    allowed: nonHappyHorseProviders.length === 0,
    reason: nonHappyHorseProviders.length > 0 ? 'non_happyhorse_provider' : 'happyhorse_only',
    providers,
    nonHappyHorseProviders,
  };
}

function resolveProjectKey(input = {}) {
  const projectKey = normalizeString(input.projectKey || input.project?.projectKey);
  if (projectKey) return projectKey;
  return '';
}

function unique(values = []) {
  return Array.from(new Set(normalizeArray(values).map(normalizeString).filter(Boolean)));
}

function clipKey(kind, id) {
  return `${kind}:${id}`;
}

function resolveShotId(result = {}) {
  return normalizeId(result.shotId || result.id || result.clipId);
}

function resolveBridgeId(result = {}) {
  return normalizeId(result.bridgeId || result.id || result.clipId);
}

function resolveSequenceId(result = {}) {
  return normalizeId(result.sequenceId || result.id || result.clipId);
}

function resolveLipsyncShotId(result = {}) {
  return normalizeId(result.shotId || result.targetShotId || result.sourceShotId);
}

function resolveLipsyncSequenceId(result = {}) {
  return normalizeId(result.sequenceId || result.targetSequenceId || result.sourceSequenceId);
}

function resolveLipsyncBridgeId(result = {}) {
  return normalizeId(result.bridgeId || result.targetBridgeId || result.sourceBridgeId);
}

function resolveLipsyncId(result = {}) {
  return normalizeId(
    result.lipsyncId ||
      result.lipSyncId ||
      result.id ||
      result.clipId ||
      resolveLipsyncShotId(result) ||
      resolveLipsyncSequenceId(result) ||
      resolveLipsyncBridgeId(result)
  );
}

function collectReferences(value = {}) {
  const direct = [
    value.referenceId,
    value.referenceImageId,
    value.referenceVideoId,
    value.referenceAssetId,
    value.canonicalReferenceId,
  ];
  const listValues = []
    .concat(normalizeArray(value.referenceIds))
    .concat(normalizeArray(value.references))
    .concat(normalizeArray(value.referenceImages))
    .concat(normalizeArray(value.referenceVideos))
    .map((item) => (typeof item === 'string' ? item : item?.id || item?.referenceId || item?.assetId));

  return unique(direct.concat(listValues));
}

function collectCharacterIds(value = {}) {
  return unique(
    []
      .concat(normalizeArray(value.characterIds))
      .concat(normalizeArray(value.characters).map((item) => (typeof item === 'string' ? item : item?.id || item?.characterId)))
      .concat(value.characterId)
  );
}

function collectSceneIds(value = {}) {
  return unique(
    []
      .concat(normalizeArray(value.sceneIds))
      .concat(normalizeArray(value.scenes).map((item) => (typeof item === 'string' ? item : item?.id || item?.sceneId)))
      .concat(value.sceneId)
  );
}

function hasDialogueHint(value = {}) {
  if (Boolean(value.dialogue || value.hasDialogue || value.requiresLipsync || value.requiresLipSync || value.speechRequired)) return true;
  const text = [
    value.dialogueHint,
    value.audioHint,
    value.requirementHint,
    value.speechHint,
    value.voiceHint,
    value.audioRequirement,
    value.requirements,
    value.notes,
    value.prompt,
  ]
    .map((item) => (typeof item === 'string' ? item : ''))
    .join(' ')
    .toLowerCase();
  return /\b(dialogue|dialog|speech|spoken|voiceover|voice over|lip[-\s]?sync|mouth)\b/.test(text);
}

function buildSequenceCoverage(sequenceClipResults = []) {
  const shotToSequence = new Map();
  const boundaryToSequence = new Map();
  const sequences = [];

  for (const result of normalizeArray(sequenceClipResults)) {
    const sequenceId = resolveSequenceId(result);
    if (!sequenceId) continue;

    const coveredShotIds = unique(result.coveredShotIds || result.coverageShotIds || result.shotIds);
    const boundaryIds = unique(result.coveredBoundaryIds || result.boundaryIds || result.crossVideoBoundaryIds);
    const entry = {
      kind: 'sequence',
      id: sequenceId,
      sequenceId,
      status: result.status || result.finalDecision || null,
      coveredShotIds,
      boundaryIds,
      references: collectReferences(result),
      entryPose: result.entryPose || result.entryPoseSummary || null,
      exitPose: result.exitPose || result.exitPoseSummary || null,
      motionRisk: result.motionRisk || result.riskLevel || null,
      hasDialogue: hasDialogueHint(result),
      source: result,
    };
    sequences.push(entry);

    for (const shotId of coveredShotIds) {
      shotToSequence.set(shotId, entry);
    }
    for (const boundaryId of boundaryIds) {
      boundaryToSequence.set(boundaryId, entry);
    }
  }

  return { shotToSequence, boundaryToSequence, sequences };
}

export function buildUnifiedClipIndex(input = {}) {
  const { shotToSequence, boundaryToSequence, sequences } = buildSequenceCoverage(input.sequenceClipResults);
  const clips = [];
  const byKey = new Map();

  for (const result of normalizeArray(input.videoResults)) {
    const shotId = resolveShotId(result);
    if (!shotId) continue;
    const coveringSequence = shotToSequence.get(shotId) || null;
    const clip = {
      kind: 'shot',
      id: shotId,
      shotId,
      videoId: result.videoId || result.episodeId || null,
      status: result.status || null,
      isMainTimeline: true,
      coveredBySequenceId: coveringSequence?.sequenceId || null,
      references: collectReferences(result),
      characterIds: collectCharacterIds(result),
      sceneIds: collectSceneIds(result),
      entryPose: result.entryPose || result.entryPoseSummary || null,
      exitPose: result.exitPose || result.exitPoseSummary || null,
      motionRisk: result.motionRisk || result.riskLevel || null,
      hasDialogue: hasDialogueHint(result),
      source: result,
    };
    clips.push(clip);
    byKey.set(clipKey(clip.kind, clip.id), clip);
  }

  for (const sequence of sequences) {
    const sequenceClip = {
      ...sequence,
      isMainTimeline: true,
      coveredBySequenceId: null,
    };
    clips.push(sequenceClip);
    byKey.set(clipKey('sequence', sequence.sequenceId), sequenceClip);
  }

  for (const result of normalizeArray(input.bridgeClipResults)) {
    const bridgeId = resolveBridgeId(result);
    if (!bridgeId) continue;
    const bridge = {
      kind: 'bridge',
      id: bridgeId,
      bridgeId,
      videoId: result.videoId || null,
      status: result.status || result.finalDecision || null,
      isMainTimeline: false,
      transitionType: result.transitionType || result.bridgeType || result.strategy || null,
      fromShotId: result.fromShotId || result.leftShotId || null,
      toShotId: result.toShotId || result.rightShotId || null,
      boundaryId: result.boundaryId || result.crossVideoBoundaryId || null,
      references: collectReferences(result),
      characterIds: collectCharacterIds(result),
      sceneIds: collectSceneIds(result),
      motionRisk: result.motionRisk || result.riskLevel || null,
      hasDialogue: hasDialogueHint(result),
      source: result,
    };
    clips.push(bridge);
    byKey.set(clipKey('bridge', bridge.bridgeId), bridge);
  }

  for (const result of normalizeArray(input.lipsyncResults)) {
    const lipsyncId = resolveLipsyncId(result);
    if (!lipsyncId) continue;

    const shotId = resolveLipsyncShotId(result);
    const sequenceId = resolveLipsyncSequenceId(result);
    const bridgeId = resolveLipsyncBridgeId(result);
    const shot = shotId ? byKey.get(clipKey('shot', shotId)) : null;
    const sequence = sequenceId ? byKey.get(clipKey('sequence', sequenceId)) : null;
    const bridge = bridgeId ? byKey.get(clipKey('bridge', bridgeId)) : null;
    const coveringSequence = shot?.coveredBySequenceId ? byKey.get(clipKey('sequence', shot.coveredBySequenceId)) : null;

    const lipsync = {
      kind: 'lipsync',
      type: 'lipsync',
      id: lipsyncId,
      lipsyncId,
      shotId: shotId || null,
      sequenceId: sequenceId || coveringSequence?.sequenceId || null,
      bridgeId: bridgeId || null,
      videoId: result.videoId || shot?.videoId || sequence?.videoId || bridge?.videoId || null,
      status: result.status || result.qaStatus || result.finalDecision || null,
      isMainTimeline: false,
      coveredBySequenceId: coveringSequence?.sequenceId || null,
      references: collectReferences(result),
      source: result,
    };

    clips.push(lipsync);
    byKey.set(clipKey('lipsync', lipsync.id), lipsync);

    if (shot) {
      shot.lipsync = result;
    }
    if (sequence || coveringSequence) {
      const targetSequence = sequence || coveringSequence;
      targetSequence.lipsyncResults = normalizeArray(targetSequence.lipsyncResults).concat(result);
    }
    if (bridge) {
      bridge.lipsyncResults = normalizeArray(bridge.lipsyncResults).concat(result);
    }
  }

  return {
    clips,
    byKey,
    shotToSequence,
    boundaryToSequence,
    mainClips: clips.filter((clip) => clip.isMainTimeline),
    bridgeClips: clips.filter((clip) => clip.kind === 'bridge'),
    sequenceClips: clips.filter((clip) => clip.kind === 'sequence'),
    lipsyncClips: clips.filter((clip) => clip.kind === 'lipsync'),
  };
}

function addEntry(entries, entry) {
  entries.push({
    dimension: entry.dimension,
    severity: entry.severity || 'warn',
    status: entry.status || normalizeStatus(entry.severity),
    subjectId: entry.subjectId || null,
    videoId: entry.videoId || null,
    clipId: entry.clipId || null,
    message: entry.message,
    evidence: entry.evidence || {},
    recommendedAction: entry.recommendedAction || 'manual_review',
  });
}

function sameOrEmpty(left, right) {
  const leftValue = normalizeString(left);
  const rightValue = normalizeString(right);
  return !leftValue || !rightValue || leftValue === rightValue;
}

function buildMetadataMaps(input = {}) {
  const videos = normalizeArray(input.videoMetadata || input.videos || input.videoManifests);
  const memory = input.contextMemory || {};
  return {
    videos,
    memoryCharacters: new Map(normalizeArray(memory.characters).map((item) => [item.id || item.characterId, item])),
    memoryScenes: new Map(normalizeArray(memory.scenes).map((item) => [item.id || item.sceneId, item])),
  };
}

function checkCharacterDrift(input, entries) {
  const { videos, memoryCharacters } = buildMetadataMaps(input);
  for (const video of videos) {
    for (const character of normalizeArray(video.characters)) {
      const characterId = normalizeId(character.id || character.characterId);
      if (!characterId) continue;
      const prior = memoryCharacters.get(characterId);
      if (!prior) continue;
      const driftFields = ['name', 'appearanceSummary', 'costume', 'hair', 'faceAnchor'].filter(
        (field) => !sameOrEmpty(prior[field], character[field])
      );
      if (driftFields.length > 0) {
        addEntry(entries, {
          dimension: 'character_drift',
          severity: 'warn',
          subjectId: characterId,
          videoId: video.videoId,
          message: `Character ${characterId} differs from HappyHorse context memory.`,
          evidence: { driftFields, prior, current: character },
          recommendedAction: 'manual_review',
        });
      }
    }
  }
}

function checkSceneDrift(input, entries) {
  const { videos, memoryScenes } = buildMetadataMaps(input);
  for (const video of videos) {
    for (const scene of normalizeArray(video.scenes)) {
      const sceneId = normalizeId(scene.id || scene.sceneId);
      if (!sceneId) continue;
      const prior = memoryScenes.get(sceneId);
      if (!prior) continue;
      const driftFields = ['location', 'setElements', 'lighting', 'keyProps'].filter(
        (field) => !sameOrEmpty(JSON.stringify(prior[field] ?? ''), JSON.stringify(scene[field] ?? ''))
      );
      if (driftFields.length > 0) {
        addEntry(entries, {
          dimension: 'scene_drift',
          severity: 'warn',
          subjectId: sceneId,
          videoId: video.videoId,
          message: `Scene ${sceneId} differs from HappyHorse context memory.`,
          evidence: { driftFields, prior, current: scene },
          recommendedAction: 'manual_review',
        });
      }
    }
  }
}

function checkReferenceGaps(index, entries) {
  for (const clip of index.mainClips) {
    if (clip.kind === 'shot' && clip.coveredBySequenceId) {
      const sequence = index.byKey.get(clipKey('sequence', clip.coveredBySequenceId));
      if (sequence?.references?.length > 0) continue;
    }

    if (clip.references.length === 0) {
      addEntry(entries, {
        dimension: 'reference_gap',
        severity: 'warn',
        videoId: clip.videoId,
        clipId: clip.id,
        message: `${clip.kind} ${clip.id} has no reference evidence.`,
        evidence: { kind: clip.kind, coveredBySequenceId: clip.coveredBySequenceId },
        recommendedAction: clip.kind === 'sequence' ? 'regenerate_sequence' : 'attach_reference_and_regenerate',
      });
    }
  }
}

function poseText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function checkPoseMismatch(input, entries) {
  const videos = normalizeArray(input.videoMetadata || input.videos || input.videoManifests);
  for (let index = 1; index < videos.length; index += 1) {
    const prev = videos[index - 1];
    const current = videos[index];
    const prevExit = poseText(prev.exitPose || prev.lastPose || prev.boundaryExitPose);
    const currentEntry = poseText(current.entryPose || current.firstPose || current.boundaryEntryPose);
    if (!prevExit || !currentEntry) continue;
    if (prevExit !== currentEntry && current.entryPoseExplained !== true) {
      addEntry(entries, {
        dimension: 'pose_mismatch',
        severity: 'warn',
        subjectId: `${prev.videoId || index - 1}->${current.videoId || index}`,
        videoId: current.videoId,
        message: 'Cross-video entry pose does not inherit the previous exit pose.',
        evidence: { previousVideoId: prev.videoId, currentVideoId: current.videoId, previousExitPose: prevExit, currentEntryPose: currentEntry },
        recommendedAction: 'manual_review',
      });
    }
  }
}

function resolveBoundaries(input = {}) {
  const explicit = normalizeArray(input.crossVideoBoundaries || input.boundaries);
  if (explicit.length > 0) return explicit;

  const videos = normalizeArray(input.videoMetadata || input.videos || input.videoManifests);
  const boundaries = [];
  for (let index = 1; index < videos.length; index += 1) {
    boundaries.push({
      boundaryId: `${videos[index - 1].videoId || index - 1}->${videos[index].videoId || index}`,
      fromVideoId: videos[index - 1].videoId || null,
      toVideoId: videos[index].videoId || null,
      fromShotId: videos[index - 1].lastShotId || null,
      toShotId: videos[index].firstShotId || null,
      requiresBridge: true,
    });
  }
  return boundaries;
}

function bridgeCoversBoundary(bridge, boundary) {
  const boundaryId = normalizeId(boundary.boundaryId || boundary.id);
  if (boundaryId && normalizeId(bridge.boundaryId) === boundaryId) return true;
  return (
    normalizeId(bridge.fromShotId) &&
    normalizeId(bridge.toShotId) &&
    normalizeId(bridge.fromShotId) === normalizeId(boundary.fromShotId) &&
    normalizeId(bridge.toShotId) === normalizeId(boundary.toShotId)
  );
}

function checkBridgeCoverage(input, index, entries) {
  const boundaries = resolveBoundaries(input);
  for (const boundary of boundaries) {
    const boundaryId = normalizeId(boundary.boundaryId || boundary.id);
    const sequenceCoverage =
      (boundaryId && index.boundaryToSequence.get(boundaryId)) ||
      index.sequenceClips.find(
        (sequence) =>
          normalizeId(boundary.fromShotId) &&
          normalizeId(boundary.toShotId) &&
          sequence.coveredShotIds.includes(normalizeId(boundary.fromShotId)) &&
          sequence.coveredShotIds.includes(normalizeId(boundary.toShotId))
      );
    const bridgeCoverage = index.bridgeClips.find((bridge) => bridgeCoversBoundary(bridge, boundary));

    if (!sequenceCoverage && !bridgeCoverage && boundary.requiresBridge !== false) {
      addEntry(entries, {
        dimension: 'bridge_coverage_gap',
        severity: 'warn',
        subjectId: boundaryId,
        videoId: boundary.toVideoId || null,
        message: `Cross-video boundary ${boundaryId || 'unknown'} has no sequence or bridge coverage evidence.`,
        evidence: boundary,
        recommendedAction: 'regenerate_sequence',
      });
    }
  }
}

function lipsyncPassed(lipsync) {
  return ['completed', 'pass', 'passed', 'ok'].includes(normalizeString(lipsync?.status || lipsync?.qaStatus || lipsync?.finalDecision).toLowerCase());
}

function hasLipsyncDowngrade(value = {}) {
  if (Boolean(value.lipsyncDowngraded || value.lipSyncDowngraded || value.lipsyncNotRequired || value.lipSyncNotRequired)) return true;
  const reason = normalizeString(
    value.lipsyncFallbackReason ||
      value.lipSyncFallbackReason ||
      value.lipsyncDowngradeReason ||
      value.lipSyncDowngradeReason ||
      value.lipsyncExceptionReason ||
      value.lipSyncExceptionReason ||
      value.noLipsyncReason ||
      value.noLipSyncReason ||
      value.manualReviewReason
  );
  return Boolean(reason);
}

function clipHasPassingLipsync(clip) {
  return lipsyncPassed(clip?.lipsync) || normalizeArray(clip?.lipsyncResults).some(lipsyncPassed);
}

function checkLipsync(input, index, entries) {
  const lipsyncByShot = new Map(normalizeArray(input.lipsyncResults).map((result) => [resolveLipsyncShotId(result), result]));
  const lipsyncBySequence = new Map(normalizeArray(input.lipsyncResults).map((result) => [resolveLipsyncSequenceId(result), result]));
  const lipsyncByBridge = new Map(normalizeArray(input.lipsyncResults).map((result) => [resolveLipsyncBridgeId(result), result]));

  for (const clip of index.mainClips.filter((item) => item.kind === 'shot')) {
    if (!clip.hasDialogue) continue;
    const coveringSequence = clip.coveredBySequenceId ? index.byKey.get(clipKey('sequence', clip.coveredBySequenceId)) : null;
    const lipsync = lipsyncByShot.get(clip.shotId) || clip.lipsync;
    const sequenceLipsync = coveringSequence ? lipsyncBySequence.get(coveringSequence.sequenceId) : null;
    const hasCoverage =
      lipsyncPassed(lipsync) ||
      lipsyncPassed(sequenceLipsync) ||
      clipHasPassingLipsync(coveringSequence) ||
      hasLipsyncDowngrade(clip.source) ||
      hasLipsyncDowngrade(coveringSequence?.source);

    if (!hasCoverage) {
      addEntry(entries, {
        dimension: 'lipsync_risk',
        severity: 'warn',
        videoId: clip.videoId,
        clipId: clip.shotId,
        message: `Dialogue shot ${clip.shotId} has no passing lipsync evidence.`,
        evidence: {
          coveredBySequenceId: clip.coveredBySequenceId,
          lipsyncStatus: lipsync?.status || lipsync?.qaStatus || null,
          sequenceLipsyncStatus: sequenceLipsync?.status || sequenceLipsync?.qaStatus || null,
          hasDowngradeReason: hasLipsyncDowngrade(clip.source) || hasLipsyncDowngrade(coveringSequence?.source),
        },
        recommendedAction: 'manual_review',
      });
    }
  }

  for (const sequence of index.sequenceClips) {
    const coveredDialogueShots = sequence.coveredShotIds
      .map((shotId) => index.byKey.get(clipKey('shot', shotId)))
      .filter((shot) => shot?.hasDialogue);
    if (!sequence.hasDialogue && coveredDialogueShots.length === 0) continue;
    const sequenceLipsync = lipsyncBySequence.get(sequence.sequenceId);
    const hasCoveredShotLipsync = coveredDialogueShots.some((shot) => lipsyncPassed(lipsyncByShot.get(shot.shotId) || shot.lipsync));
    const hasCoverage =
      lipsyncPassed(sequenceLipsync) ||
      clipHasPassingLipsync(sequence) ||
      hasCoveredShotLipsync ||
      hasLipsyncDowngrade(sequence.source);

    if (!hasCoverage) {
      addEntry(entries, {
        dimension: 'lipsync_risk',
        severity: 'warn',
        videoId: sequence.videoId,
        clipId: sequence.sequenceId,
        message: `Dialogue sequence ${sequence.sequenceId} has no passing lipsync evidence or downgrade reason.`,
        evidence: {
          coveredShotIds: sequence.coveredShotIds,
          dialogueShotIds: coveredDialogueShots.map((shot) => shot.shotId),
          lipsyncStatus: sequenceLipsync?.status || sequenceLipsync?.qaStatus || null,
          hasDowngradeReason: hasLipsyncDowngrade(sequence.source),
        },
        recommendedAction: 'manual_review',
      });
    }
  }

  for (const bridge of index.bridgeClips) {
    if (!bridge.hasDialogue) continue;
    const lipsync = lipsyncByBridge.get(bridge.bridgeId);
    const hasCoverage = lipsyncPassed(lipsync) || clipHasPassingLipsync(bridge) || hasLipsyncDowngrade(bridge.source);
    if (!hasCoverage) {
      addEntry(entries, {
        dimension: 'lipsync_risk',
        severity: 'warn',
        videoId: bridge.videoId,
        clipId: bridge.bridgeId,
        message: `Dialogue bridge ${bridge.bridgeId} has no passing lipsync evidence or downgrade reason.`,
        evidence: {
          fromShotId: bridge.fromShotId,
          toShotId: bridge.toShotId,
          boundaryId: bridge.boundaryId,
          lipsyncStatus: lipsync?.status || lipsync?.qaStatus || null,
          hasDowngradeReason: hasLipsyncDowngrade(bridge.source),
        },
        recommendedAction: 'manual_review',
      });
    }
  }
}

function checkHappyHorseMotionConstraints(index, entries) {
  for (const clip of index.mainClips) {
    const risk = normalizeString(clip.motionRisk).toLowerCase();
    if (risk !== 'high' && risk !== 'critical') continue;
    addEntry(entries, {
      dimension: 'pose_mismatch',
      severity: 'block',
      clipId: clip.id,
      videoId: clip.videoId,
      message: `${clip.kind} ${clip.id} has high-risk motion; HappyHorse cannot blindly bridge this motion.`,
      evidence: { motionRisk: clip.motionRisk, happyHorseOnly: true },
      recommendedAction: clip.kind === 'sequence' ? 'regenerate_sequence' : 'manual_review',
    });
  }

  for (const bridge of index.bridgeClips) {
    const transitionType = normalizeString(bridge.transitionType);
    if (transitionType && transitionType !== 'image_reference_transition') {
      addEntry(entries, {
        dimension: 'bridge_coverage_gap',
        severity: 'warn',
        clipId: bridge.bridgeId,
        videoId: bridge.videoId,
        message: `HappyHorse bridge ${bridge.bridgeId} must use image_reference_transition only.`,
        evidence: { transitionType },
        recommendedAction: 'manual_review',
      });
    }
  }
}

function reportEntries(report = {}) {
  return normalizeArray(report.entries)
    .concat(normalizeArray(report.flaggedShots))
    .concat(normalizeArray(report.flaggedTransitions))
    .concat(normalizeArray(report.manualReviewShots))
    .concat(normalizeArray(report.manualReviewSequences));
}

function entryIsRisky(entry = {}) {
  const status = normalizeString(entry.status || entry.finalDecision || entry.qaStatus || entry.decision || entry.result).toLowerCase();
  return (
    status &&
    !['pass', 'passed', 'completed', 'ok', 'none'].includes(status)
  );
}

function qaReportSeverity(entry = {}, fallback = 'warn') {
  const status = normalizeString(entry.status || entry.finalDecision || entry.qaStatus || entry.decision).toLowerCase();
  if (['fail', 'failed', 'block', 'blocked', 'fallback_to_direct_cut'].includes(status)) return 'block';
  return fallback;
}

function inheritQaReportEntries(input, entries) {
  const reports = [
    {
      report: input.consistencyReport || input.qaReports?.consistencyReport,
      dimension: 'character_drift',
      label: 'consistency',
    },
    {
      report: input.continuityReport || input.qaReports?.continuityReport,
      dimension: 'scene_drift',
      label: 'continuity',
    },
    {
      report: input.bridgeQaReport || input.qaReports?.bridgeQaReport,
      dimension: 'bridge_coverage_gap',
      label: 'bridge_qa',
    },
    {
      report: input.sequenceQaReport || input.qaReports?.sequenceQaReport,
      dimension: 'pose_mismatch',
      label: 'sequence_qa',
    },
    {
      report: input.lipsyncReport || input.qaReports?.lipsyncReport,
      dimension: 'lipsync_risk',
      label: 'lipsync',
    },
  ];

  for (const { report, dimension, label } of reports) {
    if (!report) continue;
    const riskyEntries = reportEntries(report).filter(entryIsRisky);
    if (normalizeStatus(report.status) !== 'pass' && riskyEntries.length === 0) {
      addEntry(entries, {
        dimension,
        severity: normalizeStatus(report.status),
        message: `${label} report status is ${report.status}; no detailed entries were provided.`,
        evidence: { reportStatus: report.status },
        recommendedAction: 'manual_review',
      });
      continue;
    }

    for (const entry of riskyEntries) {
      const shotId = resolveShotId(entry);
      addEntry(entries, {
        dimension,
        severity: qaReportSeverity(entry),
        subjectId: entry.characterId || entry.sceneId || entry.sequenceId || entry.bridgeId || null,
        videoId: entry.videoId || null,
        clipId: shotId || entry.sequenceId || entry.bridgeId || null,
        message: `${label} report raised ${dimension}.`,
        evidence: {
          sourceReport: label,
          status: entry.status || entry.finalDecision || entry.qaStatus || null,
          reason: entry.reason || entry.decisionReason || entry.failureReason || entry.qaFailureCategory || null,
        },
        recommendedAction:
          dimension === 'pose_mismatch' && entry.finalDecision === 'fail'
            ? 'regenerate_sequence'
            : 'manual_review',
      });
    }
  }
}

function checkInsufficientEvidence(input, index, entries) {
  if (index.mainClips.length === 0) {
    addEntry(entries, {
      dimension: 'insufficient_evidence',
      severity: 'warn',
      message: 'No main timeline clips were available for cross-video consistency checks.',
      evidence: { videoResults: normalizeArray(input.videoResults).length, sequenceClipResults: normalizeArray(input.sequenceClipResults).length },
      recommendedAction: 'manual_review',
    });
  }

  if (normalizeArray(input.videoMetadata || input.videos || input.videoManifests).length < 2) {
    addEntry(entries, {
      dimension: 'insufficient_evidence',
      severity: 'warn',
      message: 'Fewer than two video metadata entries were available for cross-video comparison.',
      evidence: { videoMetadataCount: normalizeArray(input.videoMetadata || input.videos || input.videoManifests).length },
      recommendedAction: 'manual_review',
    });
  }
}

function buildContextMemoryPatch(input, entries) {
  if (!isHappyHorseProject(input.projectKey)) {
    return {
      projectKey: input.projectKey || null,
      writeAllowed: false,
      reason: 'non_happyhorse_project',
    };
  }
  const providerScope = getHappyHorseProviderScope(input);
  if (!providerScope.allowed) {
    return {
      projectKey: HAPPY_HORSE_PROJECT_KEY,
      writeAllowed: false,
      reason: providerScope.reason,
      providers: providerScope.providers,
      nonHappyHorseProviders: providerScope.nonHappyHorseProviders || [],
    };
  }

  const videos = normalizeArray(input.videoMetadata || input.videos || input.videoManifests);
  const latest = videos[videos.length - 1] || {};
  return {
    projectKey: HAPPY_HORSE_PROJECT_KEY,
    writeAllowed: true,
    latestVideoId: latest.videoId || null,
    characters: normalizeArray(latest.characters),
    scenes: normalizeArray(latest.scenes),
    lastExitPose: latest.exitPose || latest.lastPose || null,
    requiredReferences: unique(
      normalizeArray(latest.requiredReferenceIds)
        .concat(normalizeArray(input.requiredReferenceIds))
        .concat(normalizeArray(input.videoResults).flatMap((item) => collectReferences(item)))
    ),
    unresolvedCrossVideoIssues: entries
      .filter((entry) => entry.status !== 'pass')
      .map((entry) => ({
        dimension: entry.dimension,
        subjectId: entry.subjectId,
        clipId: entry.clipId,
        recommendedAction: entry.recommendedAction,
      })),
  };
}

function buildSummary(entries, index) {
  const byDimension = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 0]));
  const bySeverity = { pass: 0, warn: 0, block: 0 };
  for (const entry of entries) {
    byDimension[entry.dimension] = (byDimension[entry.dimension] || 0) + 1;
    bySeverity[entry.status] = (bySeverity[entry.status] || 0) + 1;
  }
  return {
    totalEntries: entries.length,
    byDimension,
    bySeverity,
    mainClipCount: index.mainClips.length,
    shotCount: index.clips.filter((clip) => clip.kind === 'shot').length,
    sequenceCount: index.sequenceClips.length,
    bridgeCount: index.bridgeClips.length,
    lipsyncCount: index.lipsyncClips.length,
    sequenceCoveredShotCount: index.clips.filter((clip) => clip.kind === 'shot' && clip.coveredBySequenceId).length,
  };
}

export function checkCrossVideoConsistency(input = {}) {
  const projectKey = resolveProjectKey(input);
  const normalizedInput = { ...input, projectKey };
  const entries = [];
  const index = buildUnifiedClipIndex(normalizedInput);
  const providerScope = getHappyHorseProviderScope(normalizedInput);

  if (!projectKey) {
    addEntry(entries, {
      dimension: 'insufficient_evidence',
      severity: 'warn',
      message: 'Cross-video context memory requires an explicit HappyHorse projectKey before writing project memory.',
      evidence: { projectKey: null },
      recommendedAction: 'manual_review',
    });
  } else if (!isHappyHorseProject(projectKey)) {
    addEntry(entries, {
      dimension: 'insufficient_evidence',
      severity: 'block',
      message: `Cross-video context memory is HappyHorse-only; received projectKey=${projectKey}.`,
      evidence: { projectKey },
      recommendedAction: 'manual_review',
    });
  } else if (!providerScope.allowed) {
    addEntry(entries, {
      dimension: 'insufficient_evidence',
      severity: providerScope.reason === 'non_happyhorse_provider' ? 'block' : 'warn',
      message:
        providerScope.reason === 'non_happyhorse_provider'
          ? `Cross-video context memory is HappyHorse-provider-only; received providers=${providerScope.providers.join(',')}.`
          : 'Cross-video context memory requires explicit HappyHorse provider evidence before writing project memory.',
      evidence: {
        projectKey,
        providers: providerScope.providers,
        nonHappyHorseProviders: providerScope.nonHappyHorseProviders || [],
      },
      recommendedAction: 'manual_review',
    });
  }

  checkCharacterDrift(normalizedInput, entries);
  checkSceneDrift(normalizedInput, entries);
  checkPoseMismatch(normalizedInput, entries);
  checkReferenceGaps(index, entries);
  checkBridgeCoverage(normalizedInput, index, entries);
  checkLipsync(normalizedInput, index, entries);
  inheritQaReportEntries(normalizedInput, entries);
  checkHappyHorseMotionConstraints(index, entries);
  checkInsufficientEvidence(normalizedInput, index, entries);

  const summary = buildSummary(entries, index);
  const status = summary.bySeverity.block > 0 ? 'block' : summary.bySeverity.warn > 0 ? 'warn' : 'pass';
  const reviewItems = entries
    .filter((entry) => entry.status !== 'pass')
    .map((entry) => ({
      dimension: entry.dimension,
      severity: entry.status,
      subjectId: entry.subjectId,
      clipId: entry.clipId,
      recommendedAction: entry.recommendedAction,
      message: entry.message,
    }));

  return {
    schemaVersion: 1,
    projectKey: projectKey || null,
    scope: {
      projectOnly: true,
      videoIds: unique(normalizeArray(normalizedInput.videoMetadata || normalizedInput.videos || []).map((video) => video.videoId)),
    },
    status,
    entries,
    summary,
    reviewItems,
    checks: {
      characters: entries.filter((entry) => entry.dimension === 'character_drift'),
      scenes: entries.filter((entry) => entry.dimension === 'scene_drift'),
      poses: entries.filter((entry) => entry.dimension === 'pose_mismatch'),
      references: entries.filter((entry) => entry.dimension === 'reference_gap'),
      sequenceBridges: entries.filter((entry) => entry.dimension === 'bridge_coverage_gap'),
      lipsync: entries.filter((entry) => entry.dimension === 'lipsync_risk'),
      evidence: entries.filter((entry) => entry.dimension === 'insufficient_evidence'),
    },
    clipIndex: {
      clips: index.clips.map(({ source, ...clip }) => clip),
    },
    flaggedLinks: reviewItems,
    contextMemoryPatch: buildContextMemoryPatch(normalizedInput, entries),
    evidence: {
      sourceReports: normalizeArray(normalizedInput.sourceReports),
      sourceArtifacts: normalizeArray(normalizedInput.sourceArtifacts),
    },
  };
}

export const __testables = {
  DIMENSIONS,
  buildContextMemoryPatch,
  buildUnifiedClipIndex,
  collectReferences,
  getHappyHorseProviderScope,
  isHappyHorseProject,
  resolveProjectKey,
};

export default {
  buildUnifiedClipIndex,
  checkCrossVideoConsistency,
};
