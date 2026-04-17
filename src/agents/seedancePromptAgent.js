import path from 'node:path';

import { createShotGenerationPack } from '../domain/seedanceGenerationProtocol.js';
import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function findScenePackForShot(shot, scenePacks = []) {
  return (Array.isArray(scenePacks) ? scenePacks : []).find((scenePack) =>
    Array.isArray(scenePack.action_beats)
    && scenePack.action_beats.some((beat) => Array.isArray(beat.shot_ids) && beat.shot_ids.includes(shot.id))
  ) || null;
}

function findDirectorPackForScene(sceneId, directorPacks = []) {
  return (Array.isArray(directorPacks) ? directorPacks : []).find((pack) => pack.scene_id === sceneId) || null;
}

function buildTimecodedBeats(scenePack, shot, motionEntry) {
  const matchedBeats = Array.isArray(scenePack?.action_beats)
    ? scenePack.action_beats.filter((beat) => Array.isArray(beat.shot_ids) && beat.shot_ids.includes(shot.id))
    : [];

  if (matchedBeats.length > 0) {
    return matchedBeats.map((beat, index) => ({
      at_sec: index === 0 ? 0 : Math.min(index + 1, Math.max(1, Number(motionEntry?.durationTargetSec || 4) - 1)),
      summary: beat.summary,
    }));
  }

  return [
    {
      at_sec: 0,
      summary: normalizeText(shot.action || shot.dialogue || motionEntry?.visualGoal || shot.scene),
    },
  ];
}

function inferCoverageRole(shotPackage, directorPack, coverageEntry) {
  const directCoverage = normalizeText(coverageEntry?.coverage);
  if (directCoverage) {
    return directCoverage;
  }

  const strategyCoverage = normalizeText(directorPack?.coverage_strategy);
  if (strategyCoverage) {
    return strategyCoverage;
  }

  const moveType = normalizeText(shotPackage?.cameraSpec?.moveType || shotPackage?.providerRequestHints?.cameraFlowIntent);
  if (moveType.includes('whip') || moveType.includes('handheld')) {
    return 'action_axis_anchor';
  }
  if (moveType.includes('push') || moveType.includes('dolly')) {
    return 'emotion_anchor_medium';
  }
  return 'anchor_readable_coverage';
}

function inferActorBlocking(scenePack, blockingEntry, shot = {}) {
  const positions = Array.isArray(blockingEntry?.subject_positions)
    ? blockingEntry.subject_positions.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  if (positions.length > 0) {
    return positions;
  }

  const cast = Array.isArray(scenePack?.cast) ? scenePack.cast.map((item) => normalizeText(item)).filter(Boolean) : [];
  if (cast.length === 0) {
    return [];
  }

  if (cast.length === 1) {
    return [`${cast[0]}:readable_single_subject`, `${normalizeText(scenePack?.location_anchor || shot?.scene) || 'space'}:stable_background`];
  }

  return cast.map((name, index) => {
    if (index === 0) return `${name}:foreground_anchor`;
    if (index === 1) return `${name}:midground_counter`;
    return `${name}:background_presence`;
  });
}

function inferEnvironmentLocks(scenePack, directorPack, shot = {}) {
  return [
    normalizeText(scenePack?.location_anchor || shot?.scene),
    ...(Array.isArray(directorPack?.continuity_locks) ? directorPack.continuity_locks : []),
    'preserve geography',
    'preserve facing direction',
  ].map((item) => normalizeText(item)).filter(Boolean);
}

function buildSubjectActionText(generationPack) {
  const parts = [
    normalizeText(generationPack?.shot_goal),
    Array.isArray(generationPack?.timecoded_beats) && generationPack.timecoded_beats.length > 0
      ? `Primary beat: ${normalizeText(generationPack.timecoded_beats[0]?.summary)}`
      : '',
  ].filter(Boolean);

  return parts.join('. ');
}

function buildSceneEnvironmentText(generationPack, scenePack = {}) {
  const parts = [
    normalizeText(generationPack?.space_anchor) ? `Location: ${normalizeText(generationPack.space_anchor)}` : '',
    normalizeText(scenePack?.time_anchor) ? `Time and atmosphere: ${normalizeText(scenePack.time_anchor)}` : '',
    normalizeText(scenePack?.visual_motif) ? `Visual style: ${normalizeText(scenePack.visual_motif)}` : '',
  ].filter(Boolean);

  return parts.join('. ');
}

function buildCinematographyText(generationPack, scenePack = {}, directorPack = {}) {
  const cameraPlan = generationPack?.camera_plan || {};
  const cameraGrammar = scenePack?.camera_grammar || {};
  const parts = [
    normalizeText(cameraPlan.coverage_role) ? `Coverage: ${normalizeText(cameraPlan.coverage_role)}` : '',
    normalizeText(cameraPlan.framing) ? `Framing: ${normalizeText(cameraPlan.framing)}` : '',
    normalizeText(cameraPlan.move_type) ? `Camera motion: ${normalizeText(cameraPlan.move_type)}` : '',
    normalizeText(cameraGrammar.coverage) ? `Coverage bias: ${normalizeText(cameraGrammar.coverage)}` : '',
    normalizeText(cameraGrammar.movement) ? `Movement style: ${normalizeText(cameraGrammar.movement)}` : '',
    normalizeText(cameraGrammar.lens_bias) ? `Lens bias: ${normalizeText(cameraGrammar.lens_bias)}` : '',
    normalizeText(directorPack?.cinematic_intent) ? `Cinematic intent: ${normalizeText(directorPack.cinematic_intent)}` : '',
  ].filter(Boolean);

  return parts.join('. ');
}

function buildReferenceBindingText(generationPack) {
  const referenceStack = Array.isArray(generationPack?.reference_stack) ? generationPack.reference_stack : [];
  return referenceStack
    .map((entry, index) => {
      const refName = entry.type === 'reference_video' ? `video${index + 1}` : `image${index + 1}`;
      const role = normalizeText(entry.role).replace(/_/g, ' ') || 'reference';
      return `${refName} is the ${role} reference`;
    })
    .join('. ');
}

function buildPromptBlocks(generationPack, scenePack, directorPack, shotPackage) {
  const blocks = [
    {
      key: 'cinematic_intent',
      text: directorPack?.cinematic_intent || scenePack?.scene_goal || generationPack.shot_goal,
    },
    {
      key: 'shot_goal',
      text: generationPack.shot_goal,
    },
    {
      key: 'subject_action',
      text: buildSubjectActionText(generationPack),
    },
    {
      key: 'scene_environment',
      text: buildSceneEnvironmentText(generationPack, scenePack),
    },
    {
      key: 'cinematography',
      text: buildCinematographyText(generationPack, scenePack, directorPack),
    },
    {
      key: 'reference_binding',
      text: buildReferenceBindingText(generationPack),
    },
    {
      key: 'entry_exit',
      text: `entry: ${generationPack.entry_state}; exit: ${generationPack.exit_state}`,
    },
    {
      key: 'timecoded_beats',
      text: generationPack.timecoded_beats.map((beat) => `${beat.at_sec}s ${beat.summary}`).join(' | '),
    },
    {
      key: 'camera_plan',
      text: [
        generationPack.camera_plan.coverage_role ? `coverage: ${generationPack.camera_plan.coverage_role}` : '',
        generationPack.camera_plan.framing ? `framing: ${generationPack.camera_plan.framing}` : '',
        generationPack.camera_plan.move_type ? `move: ${generationPack.camera_plan.move_type}` : '',
      ].filter(Boolean).join(', '),
    },
    {
      key: 'blocking',
      text: generationPack.actor_blocking.join(', '),
    },
    {
      key: 'continuity_locks',
      text: [...generationPack.character_locks, ...generationPack.environment_locks].join(', '),
    },
    {
      key: 'negative_rules',
      text: generationPack.negative_rules.join(', '),
    },
    {
      key: 'quality_target',
      text: generationPack.quality_target,
    },
  ].filter((block) => block.text);

  return {
    promptBlocks: blocks,
    providerHints: {
      ...shotPackage.providerRequestHints,
      sceneGoal: scenePack?.scene_goal || null,
      dramaticQuestion: scenePack?.dramatic_question || null,
      cinematicIntent: directorPack?.cinematic_intent || null,
      entryState: generationPack.entry_state,
      exitState: generationPack.exit_state,
      qualityTarget: generationPack.quality_target,
    },
  };
}

function buildQualityIssues(generationPack, scenePack, directorPack, promptBlocks = []) {
  const issues = [];

  if (!scenePack) {
    issues.push('missing_scene_pack');
  }
  if (!directorPack) {
    issues.push('missing_director_pack');
  }
  if (!Array.isArray(generationPack?.reference_stack) || generationPack.reference_stack.length === 0) {
    issues.push('missing_reference_stack');
  }
  if (!generationPack?.entry_state || generationPack.entry_state === 'unknown_entry') {
    issues.push('entry_state_missing');
  }
  if (!generationPack?.exit_state || generationPack.exit_state === 'unknown_exit') {
    issues.push('exit_state_missing');
  }
  if (!generationPack?.camera_plan?.coverage_role) {
    issues.push('coverage_role_missing');
  }
  if (!Array.isArray(generationPack?.actor_blocking) || generationPack.actor_blocking.length === 0) {
    issues.push('blocking_missing');
  }
  if (
    !Array.isArray(promptBlocks)
    || !promptBlocks.some((block) => block.key === 'continuity_locks')
    || !Array.isArray(generationPack?.environment_locks)
    || generationPack.environment_locks.length === 0
  ) {
    issues.push('continuity_locks_missing');
  }

  return issues;
}

function inferQualityStatus(issues = []) {
  if (issues.some((issue) => ['missing_scene_pack', 'missing_reference_stack', 'entry_state_missing', 'exit_state_missing'].includes(issue))) {
    return 'degraded';
  }
  if (issues.length > 0) {
    return 'warn';
  }
  return 'pass';
}

function buildDirectorInferenceAudit(shotPackage, scenePack, directorPack, coverageEntry, blockingEntry, generationPack) {
  const originalCoverageRole = normalizeText(coverageEntry?.coverage || directorPack?.coverage_strategy);
  const originalBlocking = Array.isArray(blockingEntry?.subject_positions)
    ? blockingEntry.subject_positions.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  const originalContinuityLocks = Array.isArray(directorPack?.continuity_locks)
    ? directorPack.continuity_locks.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  const sourceDirectorPackPresent = Boolean(directorPack);

  return {
    shotId: shotPackage?.shotId || generationPack?.shot_id || 'unknown_shot',
    sceneId: scenePack?.scene_id || generationPack?.scene_id || null,
    sourceDirectorPackPresent,
    inferredFields: {
      coverageRole: {
        original: originalCoverageRole || null,
        final: generationPack?.camera_plan?.coverage_role || null,
        inferred: Boolean(sourceDirectorPackPresent && !originalCoverageRole && generationPack?.camera_plan?.coverage_role),
      },
      actorBlocking: {
        original: originalBlocking,
        final: Array.isArray(generationPack?.actor_blocking) ? generationPack.actor_blocking : [],
        inferred:
          sourceDirectorPackPresent
          && originalBlocking.length === 0
          && Array.isArray(generationPack?.actor_blocking)
          && generationPack.actor_blocking.length > 0,
      },
      continuityLocks: {
        original: originalContinuityLocks,
        final: Array.isArray(generationPack?.environment_locks) ? generationPack.environment_locks : [],
        inferred:
          sourceDirectorPackPresent
          && originalContinuityLocks.length === 0
          && Array.isArray(generationPack?.environment_locks)
          && generationPack.environment_locks.length > 0,
      },
    },
  };
}

export function buildShotGenerationPack(shotPackage, options = {}) {
  const shot = options.shot || {};
  const motionEntry = options.motionEntry || {};
  const scenePack = options.scenePack || null;
  const directorPack = options.directorPack || null;
  const coverageEntry = Array.isArray(directorPack?.shot_order_plan)
    ? directorPack.shot_order_plan.find((entry) =>
      Array.isArray(scenePack?.action_beats)
      && scenePack.action_beats.some((beat) => beat.beat_id === entry.beat_id && Array.isArray(beat.shot_ids) && beat.shot_ids.includes(shot.id)))
    : null;
  const blockingEntry = Array.isArray(directorPack?.blocking_map)
    ? directorPack.blocking_map.find((entry) =>
      Array.isArray(scenePack?.action_beats)
      && scenePack.action_beats.some((beat) => beat.beat_id === entry.beat_id && Array.isArray(beat.shot_ids) && beat.shot_ids.includes(shot.id)))
    : null;
  const coverageRole = inferCoverageRole(shotPackage, directorPack, coverageEntry);
  const actorBlocking = inferActorBlocking(scenePack, blockingEntry, shot);
  const environmentLocks = inferEnvironmentLocks(scenePack, directorPack, shot);

  const generationPack = createShotGenerationPack({
    scene_id: scenePack?.scene_id || 'scene_unassigned',
    shot_id: shotPackage.shotId || shot.id,
    shot_goal: scenePack?.scene_goal || shotPackage.visualGoal || 'Deliver a readable cinematic beat.',
    entry_state: scenePack?.start_state || shotPackage.providerRequestHints?.storyBeat || 'unknown_entry',
    exit_state: scenePack?.end_state || shotPackage.providerRequestHints?.storyBeat || 'unknown_exit',
    timecoded_beats: buildTimecodedBeats(scenePack, shot, motionEntry),
    camera_plan: {
      framing: shotPackage.cameraSpec?.framing || null,
      move_type: shotPackage.cameraSpec?.moveType || shotPackage.providerRequestHints?.cameraFlowIntent || null,
      coverage_role: coverageRole,
    },
    actor_blocking: actorBlocking,
    space_anchor: scenePack?.location_anchor || shotPackage.providerRequestHints?.spaceAnchor || 'unanchored_location',
    character_locks: scenePack?.cast || [],
    environment_locks: environmentLocks,
    reference_stack: (Array.isArray(shotPackage.referenceImages) ? shotPackage.referenceImages : []).map((item, index) => ({
      type: item.type || 'reference_image',
      path: item.path,
      role: index === 0 ? 'first_frame' : 'reference',
    })),
    negative_rules: [
      ...(Array.isArray(scenePack?.forbidden_choices) ? scenePack.forbidden_choices : []),
      'identity drift',
      'axis break',
      'overactive camera',
    ],
    quality_target: scenePack?.delivery_priority || 'narrative_clarity',
  });

  const promptPayload = buildPromptBlocks(generationPack, scenePack, directorPack, shotPackage);
  const qualityIssues = buildQualityIssues(generationPack, scenePack, directorPack, promptPayload.promptBlocks);
  const qualityStatus = inferQualityStatus(qualityIssues);
  const directorInferenceAudit = buildDirectorInferenceAudit(
    shotPackage,
    scenePack,
    directorPack,
    coverageEntry,
    blockingEntry,
    generationPack
  );

  return {
    ...shotPackage,
    generationPack,
    seedancePromptBlocks: promptPayload.promptBlocks,
    providerRequestHints: promptPayload.providerHints,
    directorInferenceAudit,
    qualityIssues,
    qualityStatus,
  };
}

export function buildSeedancePromptPackages(shotPackages = [], options = {}) {
  const shots = Array.isArray(options.shots) ? options.shots : [];
  const motionPlan = Array.isArray(options.motionPlan) ? options.motionPlan : [];
  const scenePacks = Array.isArray(options.scenePacks) ? options.scenePacks : [];
  const directorPacks = Array.isArray(options.directorPacks) ? options.directorPacks : [];

  const enrichedShotPackages = (Array.isArray(shotPackages) ? shotPackages : []).map((shotPackage) => {
    const shot = shots.find((item) => item.id === shotPackage.shotId) || {};
    const motionEntry = motionPlan.find((item) => item.shotId === shotPackage.shotId) || {};
    const scenePack = findScenePackForShot(shot, scenePacks);
    const directorPack = findDirectorPackForScene(scenePack?.scene_id, directorPacks);
    return buildShotGenerationPack(shotPackage, { shot, motionEntry, scenePack, directorPack });
  });

  writeArtifacts(enrichedShotPackages, options.artifactContext);
  return enrichedShotPackages;
}

function buildMetrics(promptPackages = []) {
  const degradedPackages = promptPackages.filter(
    (item) =>
      item?.qualityStatus === 'degraded'
      || item?.generationPack?.validation_status !== 'valid'
      || item?.generationPack?.scene_id === 'scene_unassigned'
      || !Array.isArray(item?.seedancePromptBlocks)
      || item.seedancePromptBlocks.length === 0
  );
  const inferenceAudits = promptPackages.map((item) => item?.directorInferenceAudit || null).filter(Boolean);
  const inferredCoverageCount = inferenceAudits.filter((item) => item?.inferredFields?.coverageRole?.inferred).length;
  const inferredBlockingCount = inferenceAudits.filter((item) => item?.inferredFields?.actorBlocking?.inferred).length;
  const inferredContinuityCount = inferenceAudits.filter((item) => item?.inferredFields?.continuityLocks?.inferred).length;

  return {
    promptPackageCount: promptPackages.length,
    degradedCount: degradedPackages.length,
    warnCount: promptPackages.filter((item) => item?.qualityStatus === 'warn').length,
    missingDirectorCount: promptPackages.filter((item) => !item?.providerRequestHints?.cinematicIntent).length,
    missingReferenceCount: promptPackages.filter(
      (item) => !Array.isArray(item?.generationPack?.reference_stack) || item.generationPack.reference_stack.length === 0
    ).length,
    missingEntryExitCount: promptPackages.filter(
      (item) =>
        !item?.providerRequestHints?.entryState
        || item.providerRequestHints.entryState === 'unknown_entry'
        || !item?.providerRequestHints?.exitState
        || item.providerRequestHints.exitState === 'unknown_exit'
    ).length,
    inferredCoverageCount,
    inferredBlockingCount,
    inferredContinuityCount,
  };
}

function writeArtifacts(promptPackages, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = buildMetrics(promptPackages);
  saveJSON(path.join(artifactContext.outputsDir, 'seedance-prompt-packages.json'), promptPackages);
  saveJSON(
    path.join(artifactContext.outputsDir, 'seedance-prompt-blocks.json'),
    promptPackages.map((item) => ({
      shotId: item.shotId,
      sceneId: item.generationPack?.scene_id || null,
      validationStatus: item.generationPack?.validation_status || null,
      qualityStatus: item.qualityStatus || null,
      qualityIssues: item.qualityIssues || [],
      promptBlocks: item.seedancePromptBlocks || [],
    }))
  );
  saveJSON(
    path.join(artifactContext.outputsDir, 'seedance-director-inference-audit.json'),
    promptPackages.map((item) => item.directorInferenceAudit || null).filter(Boolean)
  );
  saveJSON(path.join(artifactContext.metricsDir, 'seedance-prompt-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: metrics.degradedCount > 0 ? 'completed_with_warnings' : 'completed',
    promptPackageCount: promptPackages.length,
    degradedCount: metrics.degradedCount,
    outputFiles: [
      'seedance-prompt-packages.json',
      'seedance-prompt-blocks.json',
      'seedance-director-inference-audit.json',
      'seedance-prompt-metrics.json',
    ],
  });
  writeAgentQaSummary(
    {
      agentKey: 'seedancePromptAgent',
      agentName: 'Seedance Prompt Agent',
      status: metrics.degradedCount > 0 ? 'warn' : 'pass',
      headline:
        metrics.degradedCount > 0
          ? `已生成 ${promptPackages.length} 个 Seedance Prompt 包，其中 ${metrics.degradedCount} 个存在降级输入`
          : `已生成 ${promptPackages.length} 个 Seedance Prompt 包`,
      summary: '将 scene/director 约束翻译为可审计的 generation pack 与结构化 prompt block。',
      passItems: [`Prompt 包数量：${promptPackages.length}`],
      warnItems: [
        metrics.degradedCount > 0 ? `降级输入数：${metrics.degradedCount}` : '',
        metrics.warnCount > 0 ? `告警输入数：${metrics.warnCount}` : '',
      ].filter(Boolean),
      nextAction: '继续进入视频路由和 Seedance 请求阶段。',
      evidenceFiles: [
        '1-outputs/seedance-prompt-packages.json',
        '1-outputs/seedance-prompt-blocks.json',
        '1-outputs/seedance-director-inference-audit.json',
        '2-metrics/seedance-prompt-metrics.json',
      ],
      metrics,
    },
    artifactContext
  );
}

export const __testables = {
  buildDirectorInferenceAudit,
  inferActorBlocking,
  inferCoverageRole,
  inferEnvironmentLocks,
  buildPromptBlocks,
  buildQualityIssues,
  buildShotGenerationPack,
  buildTimecodedBeats,
  findDirectorPackForScene,
  findScenePackForShot,
  inferQualityStatus,
};
