import { getVoiceCastFilePath, loadJSON, saveJSON } from './fileHelper.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeIdentity(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeGender(value) {
  const text = normalizeText(value).toLowerCase();
  if (['male', 'm', 'man', 'boy', '男'].includes(text)) return 'male';
  if (['female', 'f', 'woman', 'girl', '女'].includes(text)) return 'female';
  return 'female';
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function containsAny(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function resolveMinimaxVoice(gender, env = process.env) {
  if (env.MINIMAX_TTS_VOICE) {
    return env.MINIMAX_TTS_VOICE;
  }

  if (gender === 'male') {
    return env.MINIMAX_TTS_VOICE_MALE || 'Reliable_Executive';
  }

  return env.MINIMAX_TTS_VOICE_FEMALE || 'Warm_Girl';
}

function buildIdentityCandidates(entry = {}) {
  return [
    entry.characterId,
    entry.episodeCharacterId,
    entry.mainCharacterTemplateId,
  ]
    .map(normalizeIdentity)
    .filter(Boolean);
}

function buildCharacterCandidates(character = {}) {
  return [
    character.episodeCharacterId,
    character.id,
    character.mainCharacterTemplateId,
  ]
    .map(normalizeIdentity)
    .filter(Boolean);
}

function buildLegacyCharacterCandidates(character = {}) {
  return [
    character.displayName,
    character.name,
  ]
    .map(normalizeIdentity)
    .filter(Boolean);
}

function inferVoiceTuning(character = {}) {
  const profileText = normalizeText(
    [
      character.personalityOverride,
      character.personality,
      character.roleType,
    ]
      .filter(Boolean)
      .join(' ')
  ).toLowerCase();

  let rate = 1;
  let pitch = 0;

  if (
    containsAny(profileText, [
      'calm',
      'calmer',
      'gentle',
      'serious',
      'steady',
      'mature',
      'leader',
      'mentor',
      '冷静',
      '沉稳',
      '理性',
      '克制',
      '稳重',
      '成熟',
      '导师',
      '领导',
    ])
  ) {
    rate -= 0.04;
    pitch -= 1;
  }

  if (
    containsAny(profileText, [
      'energetic',
      'bright',
      'lively',
      'playful',
      'youthful',
      'cheerful',
      '活泼',
      '元气',
      '开朗',
      '俏皮',
      '热血',
      '青春',
    ])
  ) {
    rate += 0.05;
    pitch += 1;
  }

  if (containsAny(profileText, ['cold', 'stern', 'villain', 'mysterious', 'grim', '冷酷', '阴沉', '神秘', '反派'])) {
    rate -= 0.02;
    pitch -= 1;
  }

  return {
    rate: Number(clampNumber(rate, 0.5, 2, 1).toFixed(2)),
    pitch: Number(clampNumber(pitch, -12, 12, 0).toFixed(2)),
    volume: 1,
  };
}

function buildDerivedVoiceProfile(character = {}, options = {}) {
  const env = options.env || process.env;
  const gender = normalizeGender(character.gender);
  const tuning = inferVoiceTuning(character);

  return {
    provider: 'minimax',
    voice: resolveMinimaxVoice(gender, env),
    rate: tuning.rate,
    pitch: tuning.pitch,
    volume: tuning.volume,
  };
}

function normalizeVoiceProfile(voiceProfile = {}) {
  if (!voiceProfile || typeof voiceProfile !== 'object') {
    return null;
  }

  return {
    ...voiceProfile,
    provider: normalizeIdentity(voiceProfile.provider) || null,
    voice: normalizeIdentity(voiceProfile.voice) || null,
  };
}

function isMinimaxProfile(voiceProfile = {}) {
  return normalizeIdentity(voiceProfile?.provider) === 'minimax' && Boolean(normalizeIdentity(voiceProfile?.voice));
}

function mergeVoiceCastEntry(existingEntry, character, options = {}) {
  const derivedProfile = buildDerivedVoiceProfile(character, options);
  const normalizedExistingProfile = normalizeVoiceProfile(
    existingEntry?.voiceProfile || {
      provider: existingEntry?.provider,
      voice: existingEntry?.voice || existingEntry?.voiceId,
      rate: existingEntry?.rate,
      pitch: existingEntry?.pitch,
      volume: existingEntry?.volume,
    }
  );

  const voiceProfile =
    normalizedExistingProfile && isMinimaxProfile(normalizedExistingProfile)
      ? {
          ...derivedProfile,
          ...normalizedExistingProfile,
          provider: 'minimax',
          voice: normalizedExistingProfile.voice,
        }
      : derivedProfile;

  return {
    ...(existingEntry || {}),
    characterId: normalizeIdentity(existingEntry?.characterId) || normalizeIdentity(character?.episodeCharacterId) || normalizeIdentity(character?.id) || null,
    episodeCharacterId: normalizeIdentity(existingEntry?.episodeCharacterId) || normalizeIdentity(character?.episodeCharacterId) || null,
    mainCharacterTemplateId:
      normalizeIdentity(existingEntry?.mainCharacterTemplateId) ||
      normalizeIdentity(character?.mainCharacterTemplateId) ||
      null,
    displayName: normalizeIdentity(existingEntry?.displayName) || normalizeIdentity(character?.name) || '',
    name: normalizeIdentity(existingEntry?.name) || normalizeIdentity(character?.name) || '',
    voiceProfile,
  };
}

function buildVoiceCastIndex(voiceCast = []) {
  const index = new Map();

  for (const entry of Array.isArray(voiceCast) ? voiceCast : []) {
    const stableCandidates = buildIdentityCandidates(entry);
    const candidates = stableCandidates.length > 0 ? stableCandidates : buildLegacyCharacterCandidates(entry);
    for (const candidate of candidates) {
      if (!index.has(candidate)) {
        index.set(candidate, entry);
      }
    }
  }

  return index;
}

function findMatchingEntry(voiceCastIndex, character, usedEntries = new Set()) {
  const stableCandidates = buildCharacterCandidates(character);
  for (const candidate of stableCandidates) {
    const entry = voiceCastIndex.get(candidate);
    if (entry && !usedEntries.has(entry)) {
      return entry;
    }
  }

  if (stableCandidates.length === 0) {
    for (const candidate of buildLegacyCharacterCandidates(character)) {
      const entry = voiceCastIndex.get(candidate);
      if (entry && !usedEntries.has(entry)) {
        return entry;
      }
    }
  }

  return null;
}

export function createVoiceCastEntry(character = {}, options = {}) {
  return mergeVoiceCastEntry(null, character, options);
}

export function saveVoiceCast(projectId, voiceCast, options = {}) {
  const filePath = getVoiceCastFilePath(projectId, options.baseTempDir);
  const normalizedVoiceCast = Array.isArray(voiceCast) ? voiceCast : [];
  saveJSON(filePath, normalizedVoiceCast);
  return normalizedVoiceCast;
}

export function loadVoiceCast(projectId, options = {}) {
  const filePath = getVoiceCastFilePath(projectId, options.baseTempDir);
  const loaded = loadJSON(filePath);
  return Array.isArray(loaded) ? loaded : null;
}

export function ensureProjectVoiceCast(projectId, characterRegistry = [], options = {}) {
  const existingVoiceCast = loadVoiceCast(projectId, options) || [];
  const normalizedRegistry = Array.isArray(characterRegistry) ? characterRegistry : [];

  if (normalizedRegistry.length === 0) {
    return existingVoiceCast;
  }

  const voiceCastIndex = buildVoiceCastIndex(existingVoiceCast);
  const usedEntries = new Set();

  const ensuredVoiceCast = normalizedRegistry.map((character) => {
    const existingEntry = findMatchingEntry(voiceCastIndex, character, usedEntries);
    if (existingEntry) {
      usedEntries.add(existingEntry);
      return mergeVoiceCastEntry(existingEntry, character, options);
    }

    return createVoiceCastEntry(character, options);
  });

  for (const entry of existingVoiceCast) {
    if (!usedEntries.has(entry)) {
      ensuredVoiceCast.push(entry);
    }
  }

  const serializedNext = JSON.stringify(ensuredVoiceCast);
  const serializedCurrent = JSON.stringify(existingVoiceCast);
  if (serializedNext !== serializedCurrent || !Array.isArray(existingVoiceCast) || existingVoiceCast.length === 0) {
    saveVoiceCast(projectId, ensuredVoiceCast, options);
  }

  return ensuredVoiceCast;
}

export const __testables = {
  buildCharacterCandidates,
  buildLegacyCharacterCandidates,
  buildIdentityCandidates,
  buildVoiceCastIndex,
  buildDerivedVoiceProfile,
  findMatchingEntry,
  inferVoiceTuning,
  isMinimaxProfile,
  mergeVoiceCastEntry,
  normalizeGender,
  normalizeIdentity,
  normalizeText,
  normalizeVoiceProfile,
  resolveMinimaxVoice,
};

export default {
  saveVoiceCast,
  loadVoiceCast,
  ensureProjectVoiceCast,
  createVoiceCastEntry,
};
