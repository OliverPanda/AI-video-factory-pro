import path from 'node:path';

import { createDirectorPack } from '../domain/seedanceDirectorProtocol.js';
import { saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function buildShotIndex(shots = []) {
  return new Map((Array.isArray(shots) ? shots : []).map((shot) => [shot.id, shot]));
}

function inferCoverageStrategy(scenePack) {
  if (scenePack.action_beats.length >= 3) {
    return 'master_anchor_then_selective_escalation';
  }
  return 'selective_clarity_coverage';
}

function inferAxisMap(scenePack) {
  const actionText = scenePack.action_beats.map((beat) => beat.summary).join('，');
  return {
    dominant_axis: /逼近|追/.test(actionText) ? 'forward_pressure_axis' : 'front_back',
    protected_screen_direction: /逃离|冲出|撞开/.test(actionText) ? 'outward_escape' : 'forward',
    crossing_policy: 'avoid_unmotivated_crossing',
  };
}

function buildBlockingMap(scenePack, shotIndex) {
  return scenePack.action_beats.map((beat, index) => {
    const relatedShot = (beat.shot_ids || []).map((shotId) => shotIndex.get(shotId)).find(Boolean) || null;
    const characters = Array.isArray(relatedShot?.characters)
      ? relatedShot.characters.map((item) => normalizeText(item?.name || item)).filter(Boolean)
      : scenePack.cast;

    return {
      beat_id: beat.beat_id,
      subject_positions: characters.map((name, characterIndex) =>
        `${name}:${characterIndex === 0 ? 'foreground' : 'midground'}`
      ),
      movement_note: index === scenePack.action_beats.length - 1 ? 'prepare_handoff' : 'pressure_forward',
    };
  });
}

function buildPerformanceRules(scenePack) {
  return [
    'favor grounded reaction time over exaggerated speed',
    scenePack.power_shift === 'pressure_to_escape'
      ? 'show the cost of escape in breath, posture, and hesitation'
      : 'show the power balance through stance and eyeline control',
  ];
}

function buildCameraRules(scenePack) {
  return [
    'preserve a readable master relationship before cutting tighter',
    scenePack.camera_grammar?.movement === 'controlled_follow'
      ? 'camera may follow with restraint but must not outrun the actors'
      : 'camera movement stays restrained and motivated',
  ];
}

function buildReferenceStrategy(scenePack) {
  return {
    keyframe_priority: 'entry_then_turning_point',
    continuity_reference_mode: scenePack.action_beats.length > 2 ? 'adjacent_ranked_plus_master' : 'adjacent_ranked',
    hero_reference_target: scenePack.cast[0] || null,
  };
}

function buildCandidateStrategy(scenePack) {
  return {
    variant_count: scenePack.delivery_priority === 'narrative_coherence' ? 3 : 2,
    ranking_focus: ['narrative_clarity', 'spatial_readability', 'handoff_quality'],
    rejection_floor: 'reject_if_space_or_identity_breaks',
  };
}

function buildFailureRewritePolicy(scenePack) {
  return {
    first_retry: 'tighten_blocking_and_entry_exit',
    second_retry: scenePack.power_shift === 'pressure_to_escape'
      ? 'reduce camera activity and simplify escape path'
      : 'reduce coverage ambition and reinforce axis discipline',
  };
}

export function buildDirectorPack(scenePack, options = {}) {
  const shotIndex = buildShotIndex(options.shots);
  return createDirectorPack({
    scene_id: scenePack.scene_id,
    cinematic_intent: `${scenePack.scene_goal} 镜头语气保持写实、克制、可读。`,
    coverage_strategy: inferCoverageStrategy(scenePack),
    shot_order_plan: scenePack.action_beats.map((beat, index) => ({
      beat_id: beat.beat_id,
      coverage: index === 0 ? 'anchor_master' : (index === scenePack.action_beats.length - 1 ? 'handoff_close' : 'selective_progression'),
      emphasis: index === 0 ? 'space_and_power' : 'turning_point',
    })),
    entry_master_state: scenePack.start_state,
    exit_master_state: scenePack.end_state,
    axis_map: inferAxisMap(scenePack),
    blocking_map: buildBlockingMap(scenePack, shotIndex),
    screen_direction_rules: [
      'maintain the protected direction unless a motivated crossing is shown on screen',
      'entry and exit vectors must remain legible to the audience',
    ],
    pace_design: {
      opening: 'measured',
      middle: scenePack.emotional_curve === 'slow_burn_to_spike' ? 'pressure_build' : 'sustain',
      ending: 'clean_handoff',
    },
    performance_rules: buildPerformanceRules(scenePack),
    camera_rules: buildCameraRules(scenePack),
    reference_strategy: buildReferenceStrategy(scenePack),
    continuity_locks: [
      `preserve ${scenePack.location_anchor} geography`,
      'keep wardrobe, props, and subject facing stable across candidates',
      ...scenePack.hard_locks,
    ],
    candidate_strategy: buildCandidateStrategy(scenePack),
    failure_rewrite_policy: buildFailureRewritePolicy(scenePack),
  });
}

function buildMetrics(directorPacks = []) {
  return {
    directorPackCount: directorPacks.length,
    coverageStrategies: directorPacks.reduce((acc, pack) => {
      acc[pack.coverage_strategy] = (acc[pack.coverage_strategy] || 0) + 1;
      return acc;
    }, {}),
  };
}

function writeArtifacts(directorPacks, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const metrics = buildMetrics(directorPacks);
  saveJSON(path.join(artifactContext.outputsDir, 'director-packs.json'), directorPacks);
  saveJSON(path.join(artifactContext.metricsDir, 'director-pack-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    directorPackCount: directorPacks.length,
    outputFiles: ['director-packs.json', 'director-pack-metrics.json'],
  });
  writeAgentQaSummary(
    {
      agentKey: 'directorPackAgent',
      agentName: 'Director Pack Agent',
      status: 'pass',
      headline: `已生成 ${directorPacks.length} 个导演包`,
      summary: '导演层将场景目标翻译为 coverage、轴线、调度和候选策略，供后续生成层消费。',
      passItems: [`导演包数量：${directorPacks.length}`],
      nextAction: '可以继续产出 generation pack 并接入 Seedance。 ',
      evidenceFiles: ['1-outputs/director-packs.json', '2-metrics/director-pack-metrics.json'],
      metrics,
    },
    artifactContext
  );
}

export async function planDirectorPacks(scenePacks = [], options = {}) {
  const directorPacks = (Array.isArray(scenePacks) ? scenePacks : []).map((scenePack) =>
    buildDirectorPack(scenePack, options)
  );
  writeArtifacts(directorPacks, options.artifactContext);
  return directorPacks;
}

export const __testables = {
  buildBlockingMap,
  buildCandidateStrategy,
  buildDirectorPack,
  buildFailureRewritePolicy,
  inferAxisMap,
  inferCoverageStrategy,
};
