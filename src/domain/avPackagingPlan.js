import fs from 'node:fs';
import { asArray } from '../utils/normalization.js';

const SCHEMA_VERSION = 'av-packaging-plan.v1';

const DEFAULT_SUBTITLE_STYLE_PROFILE = {
  format: 'ass',
  stylePreset: 'short_drama_default',
  fontFamily: 'Microsoft YaHei',
  fontSize: 52,
  primaryColor: '&H00FFFFFF',
  outlineColor: '&H00000000',
  backColor: '&H80000000',
  outline: 3,
  shadow: 1,
  alignment: 2,
  marginL: 40,
  marginR: 40,
  marginV: 96,
  speakerMode: 'single',
};

const BGM_KEYWORDS = {
  suspense: /(悬疑|紧张|危机|危险|压迫|不安|阴谋|暗处|逼近|suspense|tense|danger|threat)/i,
  urgent: /(急促|追逐|冲刺|逃离|爆发|高潮|决战|urgent|chase|climax|rush)/i,
  warm: /(温柔|释然|拥抱|回忆|治愈|安心|warm|soft|tender|relief)/i,
  tragic: /(悲伤|崩溃|牺牲|诀别|泪|tragic|sad|grief|farewell)/i,
};

const SFX_RULES = [
  {
    type: 'sword',
    assetId: 'sword_whoosh',
    pattern: /(剑|刀|拔刀|出刀|挥刀|挥剑|刀锋|剑锋|格挡|兵刃|sword|blade|slash)/i,
  },
  {
    type: 'impact',
    assetId: 'impact_soft',
    pattern: /(冲击|撞击|击中|重击|摔倒|倒地|爆开|爆炸|砸|impact|hit|crash|boom)/i,
  },
  {
    type: 'transition',
    assetId: 'transition_whoosh',
    pattern: /(转场|切到|闪回|推入|拉开|transition|cut to|flashback|whoosh)/i,
  },
];

function cleanText(value) {
  return String(value || '').trim();
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveDuration(value, fallback = 3) {
  const number = toFiniteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function roundTime(value) {
  return Number(toFiniteNumber(value, 0).toFixed(3));
}

function normalizeAssetList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value === 'object') {
    return Object.entries(value).map(([assetId, entry]) => ({
      assetId,
      ...(typeof entry === 'string' ? { path: entry } : entry),
    }));
  }
  return [];
}

function normalizeAssets(assets = {}) {
  return {
    bgm: normalizeAssetList(assets.bgm || assets.bgms || assets.music),
    sfx: normalizeAssetList(assets.sfx || assets.soundEffects || assets.effects),
  };
}

function pickAsset(assets = [], preferredKinds = []) {
  if (assets.length === 0) {
    return null;
  }
  const normalizedKinds = preferredKinds.map(lowerText).filter(Boolean);
  return (
    assets.find((asset) => {
      const haystack = lowerText([asset.assetId, asset.id, asset.kind, asset.type, asset.mood, asset.path].join(' '));
      return normalizedKinds.some((kind) => haystack.includes(kind));
    }) || assets[0]
  );
}

function assetIdOf(asset, fallback) {
  return asset?.assetId || asset?.id || fallback;
}

function pathOf(asset) {
  return asset?.path || asset?.uri || null;
}

function assetExists(asset) {
  const assetPath = pathOf(asset);
  return Boolean(assetPath && fs.existsSync(assetPath));
}

function buildShotTimeline(shots = []) {
  let cursor = 0;
  return asArray(shots).map((shot, index) => {
    const durationSec = positiveDuration(shot?.durationSec ?? shot?.duration ?? shot?.targetDurationSec, 3);
    const entry = {
      ...shot,
      id: shot?.id || shot?.shotId || `shot_${index + 1}`,
      index,
      startSec: roundTime(cursor),
      endSec: roundTime(cursor + durationSec),
      durationSec: roundTime(durationSec),
    };
    cursor += durationSec;
    return entry;
  });
}

function getShotText(shot = {}) {
  return [
    shot.action,
    shot.dialogue,
    shot.scene,
    shot.audioMood,
    shot.subtitleTone,
    shot.soundDesignNotes,
    shot.rhythmBeats,
    shot.description,
  ].join(' ');
}

function inferMood(text) {
  for (const [mood, pattern] of Object.entries(BGM_KEYWORDS)) {
    if (pattern.test(text)) {
      return mood;
    }
  }
  return null;
}

function getTimelineDuration(timeline = []) {
  return roundTime(timeline.reduce((max, shot) => Math.max(max, shot.endSec || 0), 0));
}

function buildSubtitleStyleProfile(options = {}, shots = []) {
  const requested = options.subtitleStyleProfile || options.subtitleStyle || {};
  const tone = lowerText(options.subtitleTone || requested.subtitleTone || shots.find((shot) => shot?.subtitleTone)?.subtitleTone);
  const profile = {
    ...DEFAULT_SUBTITLE_STYLE_PROFILE,
    ...requested,
  };

  if (tone.includes('dramatic')) {
    profile.stylePreset = requested.stylePreset || 'short_drama_dramatic';
    profile.fontSize = requested.fontSize || 56;
    profile.outline = requested.outline || 4;
    profile.marginV = requested.marginV || 104;
  } else if (tone.includes('social')) {
    profile.stylePreset = requested.stylePreset || 'social_short_bold';
    profile.fontSize = requested.fontSize || 58;
    profile.marginV = requested.marginV || 112;
  } else if (tone.includes('clean')) {
    profile.stylePreset = requested.stylePreset || 'clean_dialogue';
    profile.fontSize = requested.fontSize || 50;
  }

  if (asArray(shots).some((shot) => shot?.speaker || shot?.speakerId)) {
    profile.speakerMode = requested.speakerMode || 'multi';
  }

  return profile;
}

function buildBgmCues(timeline = [], assets = {}, options = {}) {
  const cues = [];
  let previousMood = null;
  const defaultAsset = pickAsset(assets.bgm, [options.audioMood, 'default', 'opening']);

  for (const shot of timeline) {
    const text = getShotText(shot);
    const mood = inferMood(text) || lowerText(shot.audioMood || options.audioMood);
    if (!mood || mood === previousMood) {
      continue;
    }

    const asset = pickAsset(assets.bgm, [mood]) || defaultAsset;
    cues.push({
      id: `bgm_${mood || 'mood'}_${String(cues.length + 1).padStart(3, '0')}`,
      assetId: assetIdOf(asset, `local_bgm_${mood || 'default'}`),
      ...(pathOf(asset) ? { path: pathOf(asset) } : {}),
      assetExists: assetExists(asset),
      mood,
      startSec: shot.startSec,
      endSec: Math.max(shot.endSec, Math.min(getTimelineDuration(timeline), shot.startSec + 12)),
      fadeInSec: 1.2,
      fadeOutSec: 1.5,
      gainDb: -20,
      duckingHint: 'dialogue_priority',
      source: 'emotion_change',
    });
    previousMood = mood;
  }

  return cues;
}

function buildSfxCues(timeline = [], assets = {}, sequenceClips = [], bridgeClips = []) {
  const cues = [];
  const addCue = (type, assetId, atSec, source, sourceId) => {
    const asset = pickAsset(assets.sfx, [type, assetId]);
    cues.push({
      id: `sfx_${type}_${String(cues.length + 1).padStart(3, '0')}`,
      assetId: assetIdOf(asset, assetId),
      ...(pathOf(asset) ? { path: pathOf(asset) } : {}),
      assetExists: assetExists(asset),
      sfxType: type,
      atSec: roundTime(atSec),
      gainDb: type === 'impact' ? -10 : -12,
      priority: 'skip_if_dialogue_conflict',
      source,
      sourceId,
    });
  };

  for (const shot of timeline) {
    const text = getShotText(shot);
    for (const rule of SFX_RULES) {
      if (rule.pattern.test(text)) {
        addCue(rule.type, rule.assetId, shot.startSec + Math.min(shot.durationSec * 0.45, 1.2), 'shot_semantics', shot.id);
      }
    }
  }

  for (const clip of asArray(sequenceClips)) {
    const coveredShotIds = asArray(clip?.coveredShotIds);
    const firstShot = timeline.find((shot) => shot.id === coveredShotIds[0] || shot.id === clip?.shotId);
    const text = [clip?.sequenceType, clip?.sequenceGoal, clip?.soundDesignNotes].join(' ');
    if (firstShot && /(fight|impact|冲击|打斗|交锋|刀|剑)/i.test(text)) {
      addCue(/impact|冲击/i.test(text) ? 'impact' : 'sword', /impact|冲击/i.test(text) ? 'impact_soft' : 'sword_whoosh', firstShot.startSec + 0.4, 'sequence_clip', clip.sequenceId);
    }
  }

  for (const clip of asArray(bridgeClips)) {
    const anchor = timeline.find((shot) => shot.id === clip?.fromShotId) || timeline.find((shot) => shot.id === clip?.shotId);
    if (anchor) {
      addCue('transition', 'transition_whoosh', anchor.endSec, 'bridge_clip', clip.bridgeId);
    }
  }

  return cues;
}

function buildRhythmCues(timeline = [], sfxCues = [], bgmCues = [], bridgeClips = []) {
  const cues = [];
  for (const cue of sfxCues) {
    cues.push({
      id: `rhythm_${cue.id}`,
      timeSec: cue.atSec,
      type: cue.sfxType === 'transition' ? 'transition' : 'impact',
      strength: cue.sfxType === 'impact' ? 0.9 : 0.75,
      source: cue.source,
    });
  }
  for (const cue of bgmCues) {
    cues.push({
      id: `rhythm_${cue.id}`,
      timeSec: cue.startSec,
      type: cue.startSec === 0 ? 'beat' : 'reveal',
      strength: 0.65,
      source: 'emotion_change',
    });
  }
  for (const clip of asArray(bridgeClips)) {
    const anchor = timeline.find((shot) => shot.id === clip?.fromShotId);
    if (anchor) {
      cues.push({
        id: `rhythm_bridge_${clip.bridgeId || cues.length + 1}`,
        timeSec: anchor.endSec,
        type: 'transition',
        strength: 0.7,
        source: 'bridge_clip',
      });
    }
  }
  return cues.sort((left, right) => left.timeSec - right.timeSec);
}

function buildPriorityHints(shots = [], lipsyncReport = {}, sequenceClips = [], bridgeClips = []) {
  const hints = [];
  const addHint = (shotId, kind, priority, rule) => {
    if (!shotId || hints.some((hint) => hint.shotId === shotId && hint.kind === kind)) {
      return;
    }
    hints.push({ shotId, kind, priority, rule });
  };

  const lipsyncShotIds = new Set([
    ...asArray(lipsyncReport?.results).map((entry) => entry?.shotId),
    ...asArray(lipsyncReport?.clips).map((entry) => entry?.shotId),
    ...asArray(lipsyncReport?.completedShotIds),
  ].filter(Boolean));

  for (const shot of asArray(shots)) {
    const shotId = shot?.id || shot?.shotId;
    if (lipsyncShotIds.has(shotId) || shot?.visualSpeechRequired || shot?.dialogue) {
      addHint(shotId, 'lipsync', 100, 'preserve_dialogue_mouth_sync');
    }
  }
  for (const clip of asArray(sequenceClips)) {
    for (const shotId of asArray(clip?.coveredShotIds)) {
      addHint(shotId, 'sequence', 70, 'preserve_action_continuity');
    }
  }
  for (const clip of asArray(bridgeClips)) {
    addHint(clip?.fromShotId || clip?.shotId || clip?.bridgeId, 'bridge', 30, 'bridge_can_compress_or_degrade');
  }

  return hints.sort((left, right) => right.priority - left.priority);
}

function cueAssetMissing(cue) {
  return !cue.path || cue.assetExists === false;
}

function buildWarnings(assets, bgmCues, sfxCues) {
  const warnings = [];
  if (assets.bgm.length === 0 && assets.sfx.length === 0) {
    warnings.push({
      code: 'audio_assets_missing',
      message: 'No local BGM/SFX assets were available; continuing without optional audio packaging.',
      blocking: false,
    });
  } else {
    if (bgmCues.some(cueAssetMissing)) {
      warnings.push({
        code: 'bgm_asset_missing',
        message: 'BGM cues were planned without matching local BGM files; continuing without blocking.',
        blocking: false,
      });
    }
    if (sfxCues.some(cueAssetMissing)) {
      warnings.push({
        code: 'sfx_asset_missing',
        message: 'SFX cues were planned without matching local SFX files; continuing without blocking.',
        blocking: false,
      });
    }
  }
  return warnings;
}

function buildSummary(timeline, bgmCues, sfxCues, rhythmCues, priorityHints, warnings) {
  return {
    shotCount: timeline.length,
    durationSec: getTimelineDuration(timeline),
    bgmCueCount: bgmCues.length,
    sfxCueCount: sfxCues.length,
    rhythmCueCount: rhythmCues.length,
    priorityHintCount: priorityHints.length,
    warningCount: warnings.length,
    blockingWarningCount: warnings.filter((warning) => warning.blocking).length,
  };
}

export function buildAvPackagingPlan(input = {}) {
  const timelineShots = buildShotTimeline(input.shots);
  const assets = normalizeAssets(input.options?.assets || input.assets || {});
  const subtitleStyleProfile = buildSubtitleStyleProfile(input.options || {}, timelineShots);
  const bgmCues = buildBgmCues(timelineShots, assets, input.options || {});
  const sfxCues = buildSfxCues(timelineShots, assets, input.sequenceClips, input.bridgeClips);
  const rhythmCues = buildRhythmCues(timelineShots, sfxCues, bgmCues, input.bridgeClips);
  const priorityHints = buildPriorityHints(timelineShots, input.lipsyncReport, input.sequenceClips, input.bridgeClips);
  const warnings = buildWarnings(assets, bgmCues, sfxCues);
  const summary = buildSummary(timelineShots, bgmCues, sfxCues, rhythmCues, priorityHints, warnings);

  return {
    schemaVersion: SCHEMA_VERSION,
    runId: input.runId || input.options?.runId || null,
    timeline: {
      durationSec: summary.durationSec,
      fps: toFiniteNumber(input.options?.fps, 24),
      resolution: input.options?.resolution || '1080x1920',
    },
    subtitleStyleProfile,
    subtitleStyle: subtitleStyleProfile,
    bgmCues,
    sfxCues,
    rhythmCues,
    rhythmPoints: rhythmCues,
    priorityHints,
    shotPriorityHints: priorityHints,
    warnings,
    summary,
  };
}

export const __testables = {
  buildBgmCues,
  buildPriorityHints,
  buildRhythmCues,
  buildSfxCues,
  buildShotTimeline,
  buildSubtitleStyleProfile,
  normalizeAssets,
};
