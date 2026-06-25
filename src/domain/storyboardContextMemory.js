import { buildStoryboardContextMemoryMarkdown } from './storyboardContextMemory/markdown.js';
import { asArray, normalizeText } from '../utils/normalization.js';

const SCHEMA_VERSION = '1.0.0';
const HAPPY_HORSE_REF_LIMIT = 9;
const TRUST_LEVELS = new Set(['synthetic', 'inferred', 'verified', 'human_approved']);
const STABILITY_CLASSES = new Set(['ephemeral', 'working', 'operational', 'canonical', 'evidence']);
const MEMORY_LAYERS = new Set(['working', 'project_operational', 'project_long_term', 'evidence']);

function normalizeId(value) {
  return normalizeText(value) || null;
}

function unique(values = []) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function getShotId(shot = {}) {
  return normalizeId(shot.shotId || shot.id || shot.shot_id);
}

function getSceneId(shot = {}) {
  return normalizeId(shot.sceneId || shot.scene_id || shot.scene);
}

function getCharacterId(character = {}) {
  return normalizeId(
    character.characterId ||
      character.id ||
      character.episodeCharacterId ||
      character.assetId ||
      character.characterBibleId ||
      character.name
  );
}

function getCharacterName(character = {}) {
  return normalizeText(character.name || character.characterName || character.displayName || getCharacterId(character));
}

function characterTokens(character = {}) {
  return unique([
    character.characterId,
    character.id,
    character.episodeCharacterId,
    character.assetId,
    character.characterBibleId,
    character.name,
    character.characterName,
  ]);
}

function getShotCharacterIds(shot = {}, characterRegistry = []) {
  const rawCharacters = asArray(shot.characters || shot.characterIds || shot.cast || shot.subjects);
  const registry = asArray(characterRegistry);
  const ids = [];

  for (const item of rawCharacters) {
    if (typeof item === 'string') {
      const matched = registry.find((character) => characterTokens(character).includes(item));
      ids.push(getCharacterId(matched || { id: item }));
    } else if (item) {
      ids.push(getCharacterId(item));
    }
  }

  const shotText = `${normalizeText(shot.action)} ${normalizeText(shot.dialogue)} ${normalizeText(shot.scene)}`;
  for (const character of registry) {
    const name = getCharacterName(character);
    if (name && shotText.includes(name)) {
      ids.push(getCharacterId(character));
    }
  }

  return unique(ids);
}

function buildSourceArtifact(path, artifactType, agent, extra = {}) {
  return {
    path,
    artifactType,
    agent,
    hash: extra.hash || 'sha256-unavailable',
    version: extra.version || SCHEMA_VERSION,
    synthetic: Boolean(extra.synthetic),
  };
}

function defaultSourceArtifacts(input = {}) {
  const sourceArtifacts = asArray(input.sourceArtifacts);
  if (sourceArtifacts.length > 0) {
    return sourceArtifacts;
  }
  return [
    buildSourceArtifact('in-memory/storyboard-context-input.json', 'storyboard-context-input', 'storyboardContextAgent', {
      synthetic: true,
    }),
  ];
}

function sourceArtifactHasHardEvidence(artifact = {}) {
  return Boolean(
    artifact?.synthetic !== true &&
      normalizeText(artifact.path) &&
      normalizeText(artifact.artifactType) &&
      normalizeText(artifact.agent) &&
      (normalizeText(artifact.hash) || normalizeText(artifact.version) || normalizeText(artifact.generatedAt))
  );
}

function hasUsableSourceArtifact(sourceArtifacts = []) {
  return asArray(sourceArtifacts).some(sourceArtifactHasHardEvidence);
}

function sourceIntegrityFor(sourceArtifacts = []) {
  const hasHardEvidence = hasUsableSourceArtifact(sourceArtifacts);
  return {
    status: hasHardEvidence ? 'verified' : 'review_required',
    constraintStrength: hasHardEvidence ? 'hard' : 'soft',
    syntheticSource: !hasHardEvidence,
    sourceCount: asArray(sourceArtifacts).length,
  };
}

function normalizeTrustLevel(value, fallback = 'inferred') {
  const normalized = normalizeText(value).toLowerCase();
  return TRUST_LEVELS.has(normalized) ? normalized : fallback;
}

function normalizeStabilityClass(value, fallback = 'operational') {
  const normalized = normalizeText(value).toLowerCase();
  return STABILITY_CLASSES.has(normalized) ? normalized : fallback;
}

function normalizeMemoryLayer(value, fallback = 'project_operational') {
  const normalized = normalizeText(value).toLowerCase();
  return MEMORY_LAYERS.has(normalized) ? normalized : fallback;
}

function deriveTrustLevel({
  memoryType,
  sourceIntegrity = {},
  humanVerified = false,
  pinned = false,
  sourceArtifacts = [],
}) {
  const hasHardEvidence = sourceIntegrity?.status === 'verified' && sourceIntegrity?.constraintStrength === 'hard';
  const hasSource = hasUsableSourceArtifact(sourceArtifacts);

  if (memoryType === 'working') return hasHardEvidence ? 'verified' : 'inferred';
  if (memoryType === 'evidence') return hasSource ? 'verified' : 'synthetic';
  if (memoryType === 'experience') return humanVerified ? 'human_approved' : 'inferred';
  if (memoryType === 'character') {
    if (humanVerified) return 'human_approved';
    if (hasHardEvidence) return 'verified';
    return 'inferred';
  }
  if (humanVerified) return 'human_approved';
  if (hasHardEvidence) return 'verified';
  return 'inferred';
}

function deriveStabilityClass({
  memoryType,
  trustLevel,
  layer,
}) {
  if (layer === 'evidence' || memoryType === 'evidence') return 'evidence';
  if (layer === 'working' || memoryType === 'working') return 'ephemeral';
  if (trustLevel === 'human_approved') return 'canonical';
  if (trustLevel === 'verified') return 'operational';
  if (trustLevel === 'synthetic') return 'ephemeral';
  return 'operational';
}

function deriveMemoryLayer({
  memoryType,
  trustLevel,
  explicitLayer = null,
}) {
  const normalizedExplicit = normalizeMemoryLayer(explicitLayer, null);
  if (normalizedExplicit) return normalizedExplicit;
  if (memoryType === 'working') return 'working';
  if (memoryType === 'evidence') return 'evidence';
  if (['shot', 'transition'].includes(memoryType)) return 'project_operational';
  if (['character', 'location', 'experience', 'summary'].includes(memoryType)) return 'project_long_term';
  if (trustLevel === 'human_approved') return 'project_long_term';
  return 'project_operational';
}

function buildMemorySignature(input = {}) {
  const normalizeList = (items = []) =>
    asArray(items)
      .map((item) => {
        if (!item || typeof item !== 'object') return normalizeText(item);
        return {
          id: normalizeId(item.id || item.shotId || item.transitionId || item.characterId || item.locationId || item.path || item.artifactType),
          path: normalizeText(item.path || item.imagePath || item.videoPath || item.outputPath),
          hash: normalizeText(item.hash),
          version: normalizeText(item.version),
          generatedAt: normalizeText(item.generatedAt),
          status: normalizeText(item.status || item.severity || item.finalDecision),
        };
      })
      .filter(Boolean);

  return JSON.stringify({
    projectId: normalizeText(input.projectId || 'unknown-project'),
    runId: normalizeText(input.runId || input.runJobId || 'unknown-run'),
    currentShotId: normalizeId(input.currentShotId || input.shotId),
    shotIds: normalizeList(input.shots).map((item) => item.id || item.shotId || item.transitionId || item.characterId || item.locationId || item.path || item.artifactType),
    sourceArtifacts: normalizeList(input.sourceArtifacts),
    imageResults: normalizeList(input.imageResults),
    continuityReport: normalizeList(input.continuityReport),
    continuityFlaggedTransitions: normalizeList(input.continuityFlaggedTransitions),
    motionPlan: normalizeList(input.motionPlan),
    performancePlan: normalizeList(input.performancePlan),
    characterAssetGovernanceReport: normalizeList(input.characterAssetGovernanceReport?.records || input.characterAssetGovernanceReport?.characters),
    videoProviderCapabilities: normalizeList(input.videoProviderCapabilities),
  });
}

function buildArtifactSignature(sourceArtifacts = []) {
  return unique(
    asArray(sourceArtifacts).map((artifact) =>
      JSON.stringify({
        path: normalizeText(artifact?.path),
        artifactType: normalizeText(artifact?.artifactType),
        agent: normalizeText(artifact?.agent),
        hash: normalizeText(artifact?.hash),
        version: normalizeText(artifact?.version),
        generatedAt: normalizeText(artifact?.generatedAt),
        synthetic: Boolean(artifact?.synthetic),
      })
    )
  ).join('|');
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && normalizeText(value)) return value;
  }
  return null;
}

function extractCharacterAppearance(character = {}) {
  const appearance = character.appearance || character.visualIdentity || character.look || {};
  return {
    appearanceSummary: firstPresent(character.appearanceSummary, appearance.summary, appearance.description, character.description),
    outfit: firstPresent(character.outfit, character.clothing, character.costume, character.wardrobe, appearance.outfit, appearance.clothing),
    hairStyle: firstPresent(character.hairStyle, character.hair, appearance.hairStyle, appearance.hair),
    scars: firstPresent(character.scars, character.scar, character.distinguishingMarks, appearance.scars, appearance.distinguishingMarks),
    age: firstPresent(character.age, character.ageRange, appearance.age, appearance.ageRange),
    identity: firstPresent(character.identity, character.role, character.archetype, character.characterRole),
    personalitySummary: firstPresent(character.personalitySummary, character.personality, character.temperament),
  };
}

function extractShotCharacterContinuity(shot = {}, registry = []) {
  const registryByToken = new Map();
  for (const character of asArray(registry)) {
    for (const token of characterTokens(character)) registryByToken.set(token, character);
  }
  const rawItems = [
    ...asArray(shot.characters),
    ...asArray(shot.characterStates),
    ...asArray(shot.characterContinuity),
    ...asArray(shot.cast),
    ...asArray(shot.subjects),
  ];
  const observations = [];
  for (const item of rawItems) {
    if (!item || typeof item === 'string') continue;
    const characterId = getCharacterId(item);
    if (!characterId) continue;
    const registryCharacter = registryByToken.get(characterId) || {};
    observations.push({
      characterId,
      name: getCharacterName(item) || getCharacterName(registryCharacter),
      ...extractCharacterAppearance(registryCharacter),
      ...extractCharacterAppearance(item),
    });
  }
  return observations;
}

function getPropId(prop = {}) {
  return normalizeId(prop.propId || prop.id || prop.assetId || prop.name || prop.label);
}

function extractPropContinuity(shot = {}) {
  return [
    ...asArray(shot.props),
    ...asArray(shot.keyProps),
    ...asArray(shot.objects),
    ...asArray(shot.items),
    ...asArray(shot.propContinuity),
  ]
    .filter((prop) => prop && typeof prop === 'object')
    .map((prop) => ({
      propId: getPropId(prop),
      name: normalizeText(prop.name || prop.label || getPropId(prop)),
      holder: firstPresent(prop.holder, prop.heldBy, prop.owner, prop.carriedBy),
      status: firstPresent(prop.damageStatus, prop.damagedState, prop.status, prop.condition, prop.integrity),
      location: firstPresent(prop.location, prop.position, prop.placement, prop.spaceAnchor),
    }))
    .filter((prop) => prop.propId);
}

function scoreMemory({
  pinned = false,
  referenceCount = 0,
  reuseCount = 0,
  crossRunConsistency = 0.5,
  conflictRate = 0.2,
  sourceCredibility = 0.5,
  risk = 0.2,
  importance = 0.5,
  relevance = 0.5,
  humanVerified = false,
} = {}) {
  const frequency = Math.min(1, referenceCount / 5);
  const reuse = Math.min(1, reuseCount / 5);
  const confidence = humanVerified ? 0.95 : 0.82;
  const retentionScore = Number(
    Math.min(
      1,
      0.25 * Math.min(1, referenceCount / 3) +
        0.2 * importance +
        0.2 * relevance +
        0.15 * confidence +
        0.1 * (pinned ? 1 : 0) +
        0.1 * (1 - Math.min(1, risk))
    ).toFixed(3)
  );
  const promotionScore = Number(
    Math.min(
      1,
      0.25 * importance +
        0.2 * relevance +
        0.2 * confidence +
        0.1 * frequency +
        0.1 * reuse +
        0.1 * Math.min(1, crossRunConsistency) +
        0.1 * Math.min(1, sourceCredibility) +
        0.05 * (1 - Math.min(1, conflictRate)) +
        0.1 * (pinned ? 1 : 0) +
        0.1 * (1 - Math.min(1, risk))
    ).toFixed(3)
  );
  const retentionClass = pinned || retentionScore >= 0.8 ? 'hot' : retentionScore >= 0.55 ? 'warm' : 'cold';

  return {
    importance,
    risk,
    relevance,
    frequency,
    reuseCount,
    crossRunConsistency,
    conflictRate,
    sourceCredibility,
    humanVerified,
    referenceCount,
    refCount: referenceCount,
    retentionScore,
    promotionScore,
    retentionClass,
    confidence,
  };
}

function createMemory({
  memoryId,
  memoryType,
  layer,
  scope,
  kind = 'fact',
  content,
  sourceArtifacts,
  producer = 'storyboardContextAgent',
  producedAt = new Date().toISOString(),
  pinned = false,
  reverseDependencies = [],
  supersedes = [],
  supersededBy = [],
  status = 'active',
  scoring = {},
  trustLevel = null,
  stabilityClass = null,
  invalidatedAt = null,
}) {
  const scores = scoreMemory({ pinned, ...scoring });
  const normalizedSources = asArray(sourceArtifacts);
  const finalSources =
    normalizedSources.length > 0
      ? normalizedSources
      : [buildSourceArtifact('in-memory/synthetic-source.json', 'synthetic-source', 'storyboardContextAgent', { synthetic: true })];
  const sourceIntegrity = sourceIntegrityFor(finalSources);
  const resolvedTrustLevel = normalizeTrustLevel(
    trustLevel ||
      deriveTrustLevel({
        memoryType,
        sourceIntegrity,
        humanVerified: Boolean(scoring.humanVerified),
        pinned,
        sourceArtifacts: finalSources,
      }),
    sourceIntegrity.status === 'verified' ? 'verified' : 'inferred'
  );
  const resolvedStabilityClass = normalizeStabilityClass(
    stabilityClass ||
      deriveStabilityClass({
        memoryType,
        trustLevel: resolvedTrustLevel,
        layer,
      }),
    memoryType === 'working' ? 'ephemeral' : 'operational'
  );
  const resolvedLayer = normalizeMemoryLayer(
    deriveMemoryLayer({
      memoryType,
      trustLevel: resolvedTrustLevel,
      explicitLayer: layer,
    }),
    'project_operational'
  );
  return {
    memoryId,
    memoryType,
    type: memoryType,
    layer: sourceIntegrity.status === 'review_required' ? 'review_required' : resolvedLayer,
    scope,
    kind,
    content,
    sourceArtifact: finalSources[0],
    sourceArtifacts: finalSources,
    sourceIntegrity,
    constraintStrength: sourceIntegrity.constraintStrength,
    producer,
    producedAt,
    invalidatedAt,
    pinned,
    refCount: scores.refCount,
    referenceCount: scores.referenceCount,
    reverseDependencies: unique(reverseDependencies),
    retentionScore: scores.retentionScore,
    promotionScore: scores.promotionScore,
    retentionClass: sourceIntegrity.status === 'review_required' ? 'review_required' : scores.retentionClass,
    importance: scores.importance,
    risk: scores.risk,
    relevance: scores.relevance,
    frequency: scores.frequency,
    humanVerified: scores.humanVerified,
    confidence: scores.confidence,
    trustLevel: resolvedTrustLevel,
    stabilityClass: resolvedStabilityClass,
    supersedes: unique(supersedes),
    supersededBy: unique(supersededBy),
    conflictGroupId: null,
    status,
  };
}

function memoryWriteModeFor(memory = {}) {
  if (!memory || typeof memory !== 'object') return 'candidate_only';
  if (memory.stabilityClass === 'canonical' || memory.trustLevel === 'human_approved') return 'canonical';
  if (memory.memoryType === 'evidence' || memory.layer === 'evidence') return 'evidence';
  if (memory.memoryType === 'working' || memory.layer === 'working') return 'ephemeral';
  return 'candidate_only';
}

function byShot(items = []) {
  const map = new Map();
  for (const item of asArray(items)) {
    const shotId = normalizeId(item?.shotId || item?.id || item?.shot_id);
    if (shotId && !map.has(shotId)) {
      map.set(shotId, item);
    }
  }
  return map;
}

function getLocationId(value = {}) {
  return normalizeId(value.locationId || value.id || value.location_id || value.name || value.scene || value.setting);
}

function getMotionDirection(value = {}) {
  if (!value) return '';
  return normalizeText(value.screenDirection || value.direction || value.motionDirection || value.continuityContext?.screenDirection).toLowerCase();
}

function getMotionAxis(value = {}) {
  if (!value) return '';
  return normalizeText(value.motionAxis || value.axis || value.spaceAxis || value.continuityContext?.motionAxis).toLowerCase();
}

function governanceRecords(report = {}) {
  return asArray(report.records || report.characters || report.characterRecords);
}

function registryWithGovernance(characterRegistry = [], governanceReport = {}) {
  const records = governanceRecords(governanceReport);
  const byToken = new Map();
  for (const character of asArray(characterRegistry)) {
    for (const token of characterTokens(character)) byToken.set(token, { ...character });
  }
  for (const record of records) {
    const tokens = characterTokens(record);
    const existing = tokens.map((token) => byToken.get(token)).find(Boolean) || {};
    const merged = {
      ...existing,
      ...record,
      canonicalReferences: unique([...canonicalRefs(existing), ...canonicalRefs(record)]),
    };
    for (const token of characterTokens(merged)) byToken.set(token, merged);
  }
  const seen = new Set();
  return [...byToken.values()].filter((character) => {
    const id = getCharacterId(character);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function canonicalRefs(character = {}) {
  return unique([
    ...asArray(character.canonicalReferences),
    ...asArray(character.referenceImages).map((item) => (typeof item === 'string' ? item : item?.path || item?.url || item?.imagePath)),
    character.referenceImagePath,
    character.bestFramePath,
    character.imagePath,
    character.refSheetPath,
  ]);
}

function isHappyHorse(character = {}) {
  const text = `${getCharacterId(character)} ${getCharacterName(character)} ${normalizeText(character.characterBibleId)}`.toLowerCase();
  return text.includes('happyhorse') || text.includes('happy horse') || text.includes('开心马') || text.includes('快乐马');
}

function buildHappyHorseReferencePlan(characters = []) {
  const happyHorse = asArray(characters).find(isHappyHorse) || null;
  const refs = happyHorse ? canonicalRefs(happyHorse).slice(0, HAPPY_HORSE_REF_LIMIT) : [];
  const warnings = [];

  if (!happyHorse) {
    warnings.push({
      code: 'HAPPY_HORSE_CHARACTER_MISSING',
      severity: 'warn',
      message: 'HappyHorse character not found in character registry or governance report.',
    });
  } else if (refs.length === 0) {
    warnings.push({
      code: 'HAPPY_HORSE_REFERENCE_MISSING',
      severity: 'warn',
      characterId: getCharacterId(happyHorse),
      message: 'HappyHorse has no canonical reference images.',
    });
  }
  if (happyHorse && canonicalRefs(happyHorse).length > HAPPY_HORSE_REF_LIMIT) {
    warnings.push({
      code: 'HAPPY_HORSE_REFERENCE_TRIMMED',
      severity: 'info',
      characterId: getCharacterId(happyHorse),
      message: `HappyHorse references were trimmed to ${HAPPY_HORSE_REF_LIMIT}.`,
    });
  }

  return {
    characterId: happyHorse ? getCharacterId(happyHorse) : null,
    characterName: happyHorse ? getCharacterName(happyHorse) : 'HappyHorse',
    maxReferenceCount: HAPPY_HORSE_REF_LIMIT,
    references: refs.map((ref, index) => ({
      refId: `happyhorse-ref-${String(index + 1).padStart(2, '0')}`,
      path: ref,
      role: index === 0 ? 'primary_identity' : 'continuity_support',
    })),
    warnings,
  };
}

function buildShotMemory({ shot, index, input, sourceArtifacts, characters, warnings }) {
  const shotId = getShotId(shot);
  const sceneId = getSceneId(shot);
  const characterIds = getShotCharacterIds(shot, characters);
  const motion = byShot(input.motionPlan).get(shotId) || null;
  const performance = byShot(input.performancePlan).get(shotId) || null;
  const image = byShot(input.imageResults).get(shotId) || null;
  const continuity = byShot(input.continuityReport).get(shotId) || null;
  const providerCapabilities = input.videoProviderCapabilities || {};
  const referencesByCharacter = {};

  for (const characterId of characterIds) {
    const character = characters.find((item) => getCharacterId(item) === characterId);
    const refs = canonicalRefs(character);
    referencesByCharacter[characterId] = refs;
    if (refs.length === 0) {
      warnings.push({
        code: 'CHARACTER_REFERENCE_MISSING',
        severity: 'warn',
        shotId,
        characterId,
        message: `Character ${characterId} has no canonical references for shot ${shotId}.`,
      });
    }
  }

  return createMemory({
    memoryId: `mem-${shotId}-context`,
    memoryType: 'shot',
    scope: {
      sceneId,
      shotId,
      transitionId: null,
      characterIds,
      locationId: normalizeId(shot.locationId || shot.location || shot.setting || shot.scene),
    },
    content: {
      order: Number.isFinite(Number(shot.order)) ? Number(shot.order) : index,
      scene: shot.scene || null,
      action: shot.action || null,
      dialogue: shot.dialogue || null,
      entryState: shot.entryState || shot.entry_state || continuity?.entryState || motion?.continuityContext?.entryState || null,
      exitState: shot.exitState || shot.exit_state || continuity?.exitState || motion?.continuityContext?.exitState || null,
      visualGoal: motion?.visualGoal || shot.visualGoal || null,
      motion,
      performance,
      continuity,
      imageResult: image,
      providerCapabilities,
      referencesByCharacter,
      characterContinuity: extractShotCharacterContinuity(shot, characters),
      propContinuity: extractPropContinuity(shot),
      continuityLocks: unique([
        ...asArray(shot.continuityLocks),
        ...asArray(continuity?.continuityLocks),
        motion?.screenDirection ? `screenDirection:${motion.screenDirection}` : null,
        motion?.spaceAnchor ? `spaceAnchor:${motion.spaceAnchor}` : null,
      ]),
    },
    sourceArtifacts,
    pinned: characterIds.length > 0,
    reverseDependencies: [],
    scoring: {
      importance: characterIds.length > 0 ? 0.78 : 0.55,
      risk: continuity?.status === 'fail' || continuity?.severity === 'high' ? 0.8 : 0.25,
      relevance: 0.9,
      referenceCount: characterIds.length + (image ? 1 : 0) + (motion ? 1 : 0) + (performance ? 1 : 0),
      humanVerified: Boolean(shot.humanVerified || continuity?.humanVerified),
    },
  });
}

function transitionIdFor(prevShotId, nextShotId) {
  return `transition-${prevShotId}-${nextShotId}`;
}

function flaggedTransitionId(item = {}) {
  return normalizeId(item.transitionId || item.id || item.transition_id);
}

function findFlaggedTransition(flaggedTransitions = [], prevShotId, nextShotId) {
  const expected = transitionIdFor(prevShotId, nextShotId);
  return asArray(flaggedTransitions).find((item) => {
    const id = flaggedTransitionId(item);
    return (
      id === expected ||
      (normalizeId(item.fromShotId || item.previousShotId || item.prevShotId) === prevShotId &&
        normalizeId(item.toShotId || item.nextShotId) === nextShotId)
    );
  }) || null;
}

function buildTransitionMemory({ previousShot, nextShot, index, input, sourceArtifacts }) {
  const previousShotId = getShotId(previousShot);
  const nextShotId = getShotId(nextShot);
  const transitionId = transitionIdFor(previousShotId, nextShotId);
  const previousMotion = byShot(input.motionPlan).get(previousShotId) || null;
  const nextMotion = byShot(input.motionPlan).get(nextShotId) || null;
  const flagged = findFlaggedTransition(input.continuityFlaggedTransitions, previousShotId, nextShotId);
  const sharedScene = getSceneId(previousShot) && getSceneId(previousShot) === getSceneId(nextShot);
  const actionHandoff = Boolean(
    normalizeText(previousShot.action) ||
      normalizeText(nextShot.action) ||
      previousMotion?.continuityContext ||
      nextMotion?.continuityContext ||
      flagged
  );

  if (!actionHandoff) {
    return null;
  }

  return createMemory({
    memoryId: `mem-${transitionId}-handoff`,
    memoryType: 'transition',
    scope: {
      sceneId: sharedScene ? getSceneId(previousShot) : null,
      shotId: null,
      transitionId,
      characterIds: unique([
        ...getShotCharacterIds(previousShot, input.characterRegistry),
        ...getShotCharacterIds(nextShot, input.characterRegistry),
      ]),
      locationId: normalizeId(nextShot.locationId || nextShot.location || nextShot.setting || nextShot.scene),
    },
    content: {
      previousShotId,
      nextShotId,
      previousExitState: previousShot.exitState || previousShot.exit_state || previousMotion?.continuityContext?.storyBeat || previousShot.action || null,
      nextEntryState: nextShot.entryState || nextShot.entry_state || nextMotion?.continuityContext?.storyBeat || nextShot.action || null,
      screenDirection: {
        previous: previousMotion?.screenDirection || previousMotion?.continuityContext?.screenDirection || 'unspecified',
        next: nextMotion?.screenDirection || nextMotion?.continuityContext?.screenDirection || 'unspecified',
      },
      spaceAnchor: {
        previous: previousMotion?.spaceAnchor || previousMotion?.continuityContext?.spaceAnchor || previousShot.scene || null,
        next: nextMotion?.spaceAnchor || nextMotion?.continuityContext?.spaceAnchor || nextShot.scene || null,
      },
      flaggedContinuity: flagged,
      locks: unique([
        `previousExit:${previousShotId}`,
        `nextEntry:${nextShotId}`,
        flagged ? 'requires-continuity-review' : null,
      ]),
    },
    sourceArtifacts,
    pinned: Boolean(flagged),
    reverseDependencies: [nextShotId],
    scoring: {
      importance: flagged ? 0.9 : 0.72,
      risk: flagged ? 0.85 : 0.35,
      relevance: 0.86,
      referenceCount: 2 + (flagged ? 1 : 0),
      humanVerified: Boolean(flagged?.humanVerified),
    },
  });
}

function buildCharacterMemories({ characters, sourceArtifacts }) {
  return asArray(characters).map((character) => {
    const characterId = getCharacterId(character);
    const refs = canonicalRefs(character);
    const isLead = ['lead', 'main', 'hero', 'anchor'].includes(normalizeText(character.priority).toLowerCase()) || character.isPrimary === true;
    return createMemory({
      memoryId: `mem-character-${characterId}`,
      memoryType: 'character',
      scope: {
        sceneId: null,
        shotId: null,
        transitionId: null,
        characterIds: [characterId],
        locationId: null,
      },
      content: {
        characterId,
        name: getCharacterName(character),
        characterBibleId: character.characterBibleId || null,
        assetVersion: character.assetVersion || null,
        canonicalReferences: refs,
        governanceStatus: character.governanceStatus || null,
        reusePolicy: character.reusePolicy || null,
        appearance: extractCharacterAppearance(character),
      },
      sourceArtifacts,
      pinned: isLead || refs.length > 0,
      reverseDependencies: [],
      scoring: {
        importance: isLead ? 0.95 : 0.65,
        risk: refs.length === 0 && !character.isTemporary ? 0.75 : 0.2,
        relevance: 0.82,
        referenceCount: refs.length,
        reuseCount: refs.length > 0 ? 1 : 0,
        crossRunConsistency: character.crossRunConsistency ?? (character.humanVerified ? 1 : 0.6),
        conflictRate: character.conflictRate ?? 0.1,
        sourceCredibility: character.humanVerified || character.characterBibleId ? 1 : 0.65,
        humanVerified: Boolean(character.humanVerified || character.characterBibleId),
      },
    });
  });
}

function buildWorkingMemory({ shots, sourceArtifacts }) {
  return createMemory({
    memoryId: 'mem-working-summary',
    memoryType: 'working',
    layer: 'working',
    scope: {
      sceneId: null,
      shotId: null,
      transitionId: null,
      characterIds: [],
      locationId: null,
    },
    kind: 'summary',
    content: {
      shotCount: shots.length,
      shotIds: shots.map(getShotId).filter(Boolean),
      sceneIds: unique(shots.map(getSceneId).filter(Boolean)),
    },
      sourceArtifacts,
      pinned: true,
      scoring: {
        importance: 0.8,
        relevance: 0.9,
        referenceCount: shots.length,
        reuseCount: shots.length > 1 ? 1 : 0,
        crossRunConsistency: 0.8,
        conflictRate: 0.05,
        sourceCredibility: 0.9,
      },
    });
}

function buildLocationMemories({ shots, sourceArtifacts }) {
  const byLocation = new Map();
  for (const shot of asArray(shots)) {
    const locationId = normalizeId(shot.locationId || shot.location || shot.setting || shot.scene);
    if (!locationId) continue;
    if (!byLocation.has(locationId)) {
      byLocation.set(locationId, {
        locationId,
        sceneIds: [],
        shotIds: [],
        labels: [],
        spatialLayouts: [],
        lightSources: [],
        timeOfDay: [],
        keyProps: [],
      });
    }
    const record = byLocation.get(locationId);
    record.sceneIds.push(getSceneId(shot));
    record.shotIds.push(getShotId(shot));
    record.labels.push(shot.location || shot.setting || shot.scene);
    record.spatialLayouts.push(shot.spatialLayout || shot.layout || shot.blockingMap);
    record.lightSources.push(shot.lightSource || shot.lighting || shot.lightSources);
    record.timeOfDay.push(shot.timeOfDay || shot.dayPart || shot.period);
    record.keyProps.push(...extractPropContinuity(shot).map((prop) => prop.name || prop.propId));
  }

  return [...byLocation.values()].map((location) =>
    createMemory({
      memoryId: `mem-location-${location.locationId}`,
      memoryType: 'location',
      layer: 'long_term',
      scope: {
        sceneId: unique(location.sceneIds)[0] || null,
        shotId: null,
        transitionId: null,
        characterIds: [],
        locationId: location.locationId,
      },
      content: {
        locationId: location.locationId,
        labels: unique(location.labels),
        sceneIds: unique(location.sceneIds),
        shotIds: unique(location.shotIds),
        spatialLayout: unique(location.spatialLayouts),
        lightSources: unique(location.lightSources.flatMap((item) => asArray(item).length ? item : [item])),
        timeOfDay: unique(location.timeOfDay),
        keyProps: unique(location.keyProps),
      },
      sourceArtifacts,
      pinned: false,
      scoring: {
        importance: 0.62,
        relevance: 0.78,
        referenceCount: unique(location.shotIds).length,
        reuseCount: unique(location.shotIds).length > 1 ? 1 : 0,
        crossRunConsistency: 0.75,
        conflictRate: 0.1,
        sourceCredibility: 0.85,
      },
    })
  );
}

function buildExperienceMemory({ input, sourceArtifacts }) {
  const flaggedTransitions = asArray(input.continuityFlaggedTransitions);
  const failedContinuity = asArray(input.continuityReport).filter((item) => item?.status === 'fail' || item?.severity === 'high');
  return createMemory({
    memoryId: 'mem-experience-continuity-lessons',
    memoryType: 'experience',
    layer: 'experience',
    scope: {
      sceneId: null,
      shotId: null,
      transitionId: null,
      characterIds: [],
      locationId: null,
    },
    kind: 'summary',
    content: {
      lesson: 'Prioritize continuity review for flagged transitions, failed continuity checks, and missing references.',
      flaggedTransitionCount: flaggedTransitions.length,
      failedContinuityShotIds: failedContinuity.map((item) => normalizeId(item.shotId)).filter(Boolean),
    },
      sourceArtifacts,
      pinned: false,
      scoring: {
        importance: flaggedTransitions.length || failedContinuity.length ? 0.74 : 0.52,
        risk: flaggedTransitions.length || failedContinuity.length ? 0.65 : 0.25,
        relevance: 0.7,
        referenceCount: flaggedTransitions.length + failedContinuity.length,
        reuseCount: flaggedTransitions.length,
        crossRunConsistency: failedContinuity.length === 0 ? 0.72 : 0.45,
        conflictRate: failedContinuity.length > 0 ? 0.3 : 0.1,
        sourceCredibility: 0.7,
      },
    });
}

function buildEvidenceMemories({ sourceArtifacts }) {
  return asArray(sourceArtifacts).map((artifact, index) =>
    createMemory({
      memoryId: `mem-evidence-${String(index + 1).padStart(2, '0')}`,
      memoryType: 'evidence',
      layer: 'evidence',
      scope: {
        sceneId: null,
        shotId: null,
        transitionId: null,
        characterIds: [],
        locationId: null,
      },
      kind: 'evidence',
      content: {
        artifact,
        synthetic: artifact?.synthetic === true,
      },
      sourceArtifacts: [artifact],
      pinned: artifact?.synthetic !== true,
      scoring: {
        importance: artifact?.synthetic === true ? 0.35 : 0.85,
        relevance: 0.8,
        referenceCount: 1,
        reuseCount: artifact?.synthetic === true ? 0 : 1,
        crossRunConsistency: artifact?.synthetic === true ? 0.2 : 0.95,
        conflictRate: 0,
        sourceCredibility: artifact?.synthetic === true ? 0.2 : 1,
        humanVerified: artifact?.synthetic !== true,
      },
    })
  );
}

function addIndex(index, key, memoryId) {
  if (!key || !memoryId) return;
  if (!index[key]) index[key] = [];
  if (!index[key].includes(memoryId)) index[key].push(memoryId);
}

function buildIndexes(memories = []) {
  const indexes = {
    byShotId: {},
    byTransitionId: {},
    byCharacterId: {},
    bySceneId: {},
    byLocationId: {},
    byMemoryType: {},
    byLayer: {},
  };

  for (const memory of memories) {
    addIndex(indexes.byShotId, memory.scope?.shotId, memory.memoryId);
    addIndex(indexes.byTransitionId, memory.scope?.transitionId, memory.memoryId);
    for (const characterId of asArray(memory.scope?.characterIds)) {
      addIndex(indexes.byCharacterId, characterId, memory.memoryId);
    }
    addIndex(indexes.bySceneId, memory.scope?.sceneId, memory.memoryId);
    addIndex(indexes.byLocationId, memory.scope?.locationId, memory.memoryId);
    addIndex(indexes.byMemoryType, memory.memoryType, memory.memoryId);
    addIndex(indexes.byLayer, memory.layer, memory.memoryId);
  }

  return indexes;
}

function buildContextIndex(memories = [], type) {
  const entries = {};
  for (const memory of memories) {
    const key = type === 'shot' ? memory.scope?.shotId : memory.scope?.transitionId;
    if (!key) continue;
    if (!entries[key]) {
      entries[key] = {
        [type === 'shot' ? 'shotId' : 'transitionId']: key,
        memoryIds: [],
        pinnedMemoryIds: [],
        sourceArtifacts: [],
        warnings: [],
      };
    }
    entries[key].memoryIds.push(memory.memoryId);
    if (memory.pinned) entries[key].pinnedMemoryIds.push(memory.memoryId);
    entries[key].sourceArtifacts.push(...asArray(memory.sourceArtifacts));
  }
  for (const entry of Object.values(entries)) {
    entry.memoryIds = unique(entry.memoryIds);
    entry.pinnedMemoryIds = unique(entry.pinnedMemoryIds);
    entry.sourceArtifacts = asArray(entry.sourceArtifacts).filter(
      (artifact, index, all) => index === all.findIndex((item) => item?.path === artifact?.path && item?.artifactType === artifact?.artifactType)
    );
  }
  return entries;
}

function attachReverseDependencies(memories = []) {
  const byId = new Map(memories.map((memory) => [memory.memoryId, memory]));
  const characterMemories = memories.filter((memory) => memory.memoryType === 'character');
  const shotMemories = memories.filter((memory) => memory.memoryType === 'shot');
  const transitionMemories = memories.filter((memory) => memory.memoryType === 'transition');

  for (const characterMemory of characterMemories) {
    const characterId = characterMemory.scope?.characterIds?.[0];
    const deps = [
      ...shotMemories.filter((memory) => asArray(memory.scope?.characterIds).includes(characterId)).map((memory) => memory.scope.shotId),
      ...transitionMemories
        .filter((memory) => asArray(memory.scope?.characterIds).includes(characterId))
        .map((memory) => memory.scope.transitionId),
    ];
    byId.get(characterMemory.memoryId).reverseDependencies = unique(deps);
  }

  for (const shotMemory of shotMemories) {
    const shotId = shotMemory.scope?.shotId;
    const deps = transitionMemories
      .filter((memory) => memory.content?.previousShotId === shotId || memory.content?.nextShotId === shotId)
      .map((memory) => memory.scope.transitionId);
    shotMemory.reverseDependencies = unique([...shotMemory.reverseDependencies, ...deps]);
  }

  return memories;
}

function recordInvalidation(memory = {}, { runId, reason, changedArtifacts = [], invalidatedAt = new Date().toISOString() } = {}) {
  const changedArtifactSignatures = unique(
    asArray(changedArtifacts).map((artifact) =>
      JSON.stringify({
        path: normalizeText(artifact?.path),
        artifactType: normalizeText(artifact?.artifactType),
        agent: normalizeText(artifact?.agent),
        hash: normalizeText(artifact?.hash),
        version: normalizeText(artifact?.version),
      })
    )
  );
  const updatedRecords = asArray(memory.records).map((record) => {
    const recordArtifactSignature = JSON.stringify({
      path: normalizeText(record.sourceArtifact?.path),
      artifactType: normalizeText(record.sourceArtifact?.artifactType),
      agent: normalizeText(record.sourceArtifact?.agent),
      hash: normalizeText(record.sourceArtifact?.hash),
      version: normalizeText(record.sourceArtifact?.version),
    });
    const changed = changedArtifactSignatures.includes(recordArtifactSignature);
    if (!changed) return record;
    return {
      ...record,
      status: 'invalidated',
      invalidatedAt,
    };
  });

  return {
    ...memory,
    invalidatedAt,
    invalidation: {
      runId: runId || memory.runId || null,
      reason: reason || 'artifact_changed',
      changedArtifacts,
    },
    records: updatedRecords,
    memories: updatedRecords,
    updatedAt: invalidatedAt,
  };
}

function isMemoryFresh(memory = {}, input = {}) {
  const nextSignature = buildMemorySignature(input);
  const memorySignature = normalizeText(memory.memorySignature || memory.signature);
  const artifactSignature = normalizeText(memory.artifactSignature || memory.sourceArtifactSignature);
  const nextArtifactSignature = buildArtifactSignature(defaultSourceArtifacts(input));
  if (memory.invalidatedAt) return false;
  if (!memorySignature || memorySignature !== nextSignature) return false;
  if (artifactSignature && artifactSignature !== nextArtifactSignature) return false;
  return true;
}

function readContext({
  memory = {},
  input = {},
  currentShotId = null,
  shotId = null,
  transitionId = null,
  tokenBudget = 2400,
  windowSize = 1,
} = {}) {
  const currentId = currentShotId || shotId || null;
  return {
    fresh: isMemoryFresh(memory, input),
    memory,
    contextPack: buildDirectorContextPack(memory, {
      currentShotId: currentId,
      transitionId,
      tokenBudget,
      windowSize,
    }),
  };
}

function writeMemory({
  records = [],
  sourceArtifacts = [],
  producer = 'storyboardContextAgent',
  scope = {},
  memoryType = 'summary',
  memoryId = null,
  kind = 'fact',
  content = {},
  pinned = false,
  scoring = {},
  layer = null,
  trustLevel = null,
  stabilityClass = null,
  status = 'active',
} = {}) {
  return createMemory({
    memoryId: memoryId || `mem-${memoryType}-${normalizeId(scope.shotId || scope.transitionId || scope.locationId || 'general')}`,
    memoryType,
    layer,
    scope,
    kind,
    content,
    sourceArtifacts,
    producer,
    pinned,
    scoring,
    trustLevel,
    stabilityClass,
    status,
  });
}

function compactMemory({ memory = {}, strategy = 'default' } = {}) {
  const compaction = compactMemories(asArray(memory.records));
  return {
    ...memory,
    compactionStrategy: strategy,
    compactionLog: compaction.compactionLog,
    records: compaction.memories,
    memories: compaction.memories,
    updatedAt: new Date().toISOString(),
  };
}

function makeConflict(groupId, conflictType, scope, fields, memoryIds = []) {
  return {
    conflictGroupId: groupId,
    kind: conflictType,
    conflictType,
    scope,
    fields,
    memoryIds: unique(memoryIds),
    severity: 'warn',
  };
}

function normalizedComparable(value) {
  return normalizeText(Array.isArray(value) ? value.join('|') : value).toLowerCase();
}

function addFieldConflicts(conflicts, groupPrefix, kindPrefix, scope, memoryId, entityKey, observations, fields) {
  const byField = new Map();
  for (const observation of observations) {
    for (const field of fields) {
      const value = normalizedComparable(observation[field]);
      if (!value) continue;
      const key = `${field}:${value}`;
      if (!byField.has(field)) byField.set(field, new Map());
      if (!byField.get(field).has(value)) byField.get(field).set(value, []);
      byField.get(field).get(value).push(observation);
    }
  }

  for (const [field, values] of byField.entries()) {
    if (values.size < 2) continue;
    conflicts.push(
      makeConflict(
        `${groupPrefix}-${entityKey}-${field}`,
        `${kindPrefix}_${field}_mismatch`,
        scope,
        {
          [entityKey.includes('prop') ? 'propId' : 'characterId']: entityKey,
          field,
          values: [...values.keys()],
        },
        [memoryId]
      )
    );
  }
}

function detectCharacterAndPropConflicts(shotMemories = []) {
  const conflicts = [];
  const characterObservations = new Map();
  const propObservations = new Map();

  for (const memory of shotMemories) {
    const shotId = memory.scope?.shotId;
    for (const observation of asArray(memory.content?.characterContinuity)) {
      const characterId = normalizeId(observation.characterId);
      if (!characterId) continue;
      if (!characterObservations.has(characterId)) characterObservations.set(characterId, []);
      characterObservations.get(characterId).push({ ...observation, shotId, memoryId: memory.memoryId });
    }
    for (const prop of asArray(memory.content?.propContinuity)) {
      const propId = normalizeId(prop.propId);
      if (!propId) continue;
      if (!propObservations.has(propId)) propObservations.set(propId, []);
      propObservations.get(propId).push({ ...prop, shotId, memoryId: memory.memoryId });
    }
  }

  for (const [characterId, observations] of characterObservations.entries()) {
    const memoryIds = unique(observations.map((item) => item.memoryId));
    const fields = ['outfit', 'hairStyle', 'scars', 'age', 'identity'];
    for (const field of fields) {
      const values = unique(observations.map((item) => normalizedComparable(item[field])).filter(Boolean));
      if (values.length < 2) continue;
      conflicts.push(
        makeConflict(
          `conflict-character-${characterId}-${field}`,
          `character_${field}_mismatch`,
          { characterId },
          { characterId, field, values, shotIds: unique(observations.map((item) => item.shotId)) },
          memoryIds
        )
      );
    }
  }

  for (const [propId, observations] of propObservations.entries()) {
    const memoryIds = unique(observations.map((item) => item.memoryId));
    const fields = ['holder', 'status', 'location'];
    for (const field of fields) {
      const values = unique(observations.map((item) => normalizedComparable(item[field])).filter(Boolean));
      if (values.length < 2) continue;
      conflicts.push(
        makeConflict(
          `conflict-prop-${propId}-${field}`,
          `prop_${field}_mismatch`,
          { propId },
          { propId, field, values, shotIds: unique(observations.map((item) => item.shotId)) },
          memoryIds
        )
      );
    }
  }

  return conflicts;
}

function detectConflicts(memories = []) {
  const conflicts = [];
  const warnings = [];
  const shotMemories = memories.filter((memory) => memory.memoryType === 'shot');
  const transitionMemories = memories.filter((memory) => memory.memoryType === 'transition');

  for (const memory of shotMemories) {
    const shotId = memory.scope?.shotId;
    const sceneId = normalizeId(memory.scope?.sceneId);
    const contentScene = normalizeId(memory.content?.scene);
    const locationId = normalizeId(memory.scope?.locationId);
    const motionLocation = normalizeId(memory.content?.motion?.spaceAnchor || memory.content?.motion?.continuityContext?.spaceAnchor);
    const motionDirection = getMotionDirection(memory.content?.motion);
    const continuityDirection = normalizeText(memory.content?.continuity?.screenDirection).toLowerCase();
    const motionAxis = getMotionAxis(memory.content?.motion);
    const continuityAxis = getMotionAxis(memory.content?.continuity);

    if (shotId && sceneId && contentScene && sceneId !== contentScene && locationId && locationId !== contentScene) {
      conflicts.push(
        makeConflict(
          `conflict-shot-${shotId}-scene-location`,
          'scene_location_mismatch',
          { shotId, transitionId: null },
          { sceneId, scene: contentScene, locationId },
          [memory.memoryId]
        )
      );
    }
    if (shotId && locationId && motionLocation && locationId !== motionLocation) {
      conflicts.push(
        makeConflict(
          `conflict-shot-${shotId}-location-motion`,
          'scene_location_mismatch',
          { shotId, transitionId: null },
          { locationId, motionLocation },
          [memory.memoryId]
        )
      );
    }
    if (shotId && motionDirection && continuityDirection && motionDirection !== continuityDirection) {
      conflicts.push(
        makeConflict(
          `conflict-shot-${shotId}-motion-direction`,
          'motion_direction_mismatch',
          { shotId, transitionId: null },
          { motionDirection, continuityDirection },
          [memory.memoryId]
        )
      );
    }
    if (shotId && motionAxis && continuityAxis && motionAxis !== continuityAxis) {
      conflicts.push(
        makeConflict(
          `conflict-shot-${shotId}-motion-axis`,
          'motion_axis_mismatch',
          { shotId, transitionId: null },
          { motionAxis, continuityAxis },
          [memory.memoryId]
        )
      );
    }
  }

  for (const memory of transitionMemories) {
    const transitionId = memory.scope?.transitionId;
    const previous = memory.content?.previousExitState;
    const next = memory.content?.nextEntryState;
    const previousDirection = normalizeText(memory.content?.screenDirection?.previous).toLowerCase();
    const nextDirection = normalizeText(memory.content?.screenDirection?.next).toLowerCase();
    const previousAnchor = normalizeId(memory.content?.spaceAnchor?.previous);
    const nextAnchor = normalizeId(memory.content?.spaceAnchor?.next);

    if (transitionId && previous && next && normalizeText(previous).toLowerCase() !== normalizeText(next).toLowerCase()) {
      conflicts.push(
        makeConflict(
          `conflict-${transitionId}-entry-exit`,
          'entry_exit_state_mismatch',
          { shotId: null, transitionId },
          { previousExitState: previous, nextEntryState: next },
          [memory.memoryId]
        )
      );
    }
    if (transitionId && previousDirection && nextDirection && previousDirection !== 'unspecified' && nextDirection !== 'unspecified' && previousDirection !== nextDirection) {
      conflicts.push(
        makeConflict(
          `conflict-${transitionId}-motion-direction`,
          'motion_direction_mismatch',
          { shotId: null, transitionId },
          { previousDirection, nextDirection },
          [memory.memoryId]
        )
      );
    }
    if (transitionId && previousAnchor && nextAnchor && previousAnchor !== nextAnchor) {
      conflicts.push(
        makeConflict(
          `conflict-${transitionId}-scene-location`,
          'scene_location_mismatch',
          { shotId: null, transitionId },
          { previousAnchor, nextAnchor },
          [memory.memoryId]
        )
      );
    }
  }

  conflicts.push(...detectCharacterAndPropConflicts(shotMemories));

  for (const conflict of conflicts) {
    warnings.push({
      code: 'STORYBOARD_CONTEXT_CONFLICT',
      severity: 'warn',
      conflictGroupId: conflict.conflictGroupId,
      kind: conflict.kind,
      conflictType: conflict.conflictType,
      message: `Storyboard context conflict detected: ${conflict.kind}.`,
    });
  }

  return { conflicts, warnings };
}

function contentFingerprint(memory = {}) {
  return JSON.stringify({
    memoryType: memory.memoryType,
    scope: memory.scope,
    content: memory.content,
  });
}

function compactMemories(memories = []) {
  const compactionLog = [];
  const compacted = [];
  const seen = new Map();

  for (const memory of memories) {
    if (memory.pinned) {
      compacted.push(memory);
      continue;
    }

    const fingerprint = contentFingerprint(memory);
    if (seen.has(fingerprint)) {
      const kept = seen.get(fingerprint);
      kept.refCount += memory.refCount || 0;
      kept.referenceCount += memory.referenceCount || 0;
      kept.reverseDependencies = unique([...asArray(kept.reverseDependencies), ...asArray(memory.reverseDependencies)]);
      compactionLog.push({
        action: 'deduplicate',
        removedMemoryId: memory.memoryId,
        keptMemoryId: kept.memoryId,
        reason: 'duplicate memory content and scope',
      });
      continue;
    }

    if (memory.sourceIntegrity?.status !== 'review_required' && (memory.retentionScore || 0) < 0.5) {
      const targetLayer = (memory.retentionScore || 0) < 0.35 ? 'archived' : 'cold';
      memory.layer = targetLayer;
      memory.retentionClass = targetLayer;
      memory.status = targetLayer;
      compactionLog.push({
        action: 'migrate',
        memoryId: memory.memoryId,
        toLayer: targetLayer,
        reason: 'low retention score',
      });
    }

    seen.set(fingerprint, memory);
    compacted.push(memory);
  }

  return { memories: compacted, compactionLog };
}

function estimateTokens(value) {
  return Math.max(1, Math.ceil(JSON.stringify(value || '').length / 4));
}

function summarizeMemory(memory = {}) {
  return {
    memoryId: memory.memoryId,
    memoryType: memory.memoryType,
    scope: memory.scope,
    kind: memory.kind,
    summary: memory.content?.lesson || memory.content?.action || memory.content?.scene || memory.content?.name || memory.content?.locationId || null,
    retentionScore: memory.retentionScore,
    sourceIntegrity: memory.sourceIntegrity,
  };
}

function memoryPriority(memory = {}, selectedShotIds = new Set(), selectedTransitionIds = new Set(), currentShotId = null) {
  if (memory.pinned) return 100;
  if (memory.scope?.shotId === currentShotId) return 95;
  if (selectedShotIds.has(memory.scope?.shotId)) return 85;
  if (selectedTransitionIds.has(memory.scope?.transitionId)) return 80;
  if (memory.constraintStrength === 'hard' && (memory.importance || 0) >= 0.75) return 75;
  if (memory.memoryType === 'character' || memory.memoryType === 'location') return 60;
  return Math.round((memory.retentionScore || 0) * 50);
}

function sortedShotIds(memory = {}) {
  return asArray(memory.shotMemory)
    .slice()
    .sort((a, b) => (a.content?.order || 0) - (b.content?.order || 0))
    .map((item) => item.scope?.shotId)
    .filter(Boolean);
}

export function buildDirectorContextPack(memory = {}, options = {}) {
  const tokenBudget = Number.isFinite(Number(options.tokenBudget)) ? Number(options.tokenBudget) : 2400;
  const currentShotId = normalizeId(options.currentShotId || options.shotId);
  const windowSize = Number.isFinite(Number(options.windowSize)) ? Math.max(0, Number(options.windowSize)) : 1;
  const allMemories = asArray(memory.memories || memory.records);
  const shotIds = sortedShotIds(memory);
  const currentIndex = currentShotId ? shotIds.indexOf(currentShotId) : -1;
  const selectedShotIds = new Set();

  if (currentShotId) selectedShotIds.add(currentShotId);
  if (currentIndex >= 0) {
    for (let index = Math.max(0, currentIndex - windowSize); index <= Math.min(shotIds.length - 1, currentIndex + windowSize); index += 1) {
      selectedShotIds.add(shotIds[index]);
    }
  }

  const selectedTransitionIds = new Set();
  for (const transition of asArray(memory.transitionMemory)) {
    const previousShotId = transition.content?.previousShotId;
    const nextShotId = transition.content?.nextShotId;
    if (selectedShotIds.has(previousShotId) || selectedShotIds.has(nextShotId)) {
      selectedTransitionIds.add(transition.scope?.transitionId);
    }
  }

  const pinned = allMemories.filter((item) => item.pinned);
  const currentShot = allMemories.filter((item) => item.scope?.shotId === currentShotId);
  const adjacent = allMemories.filter((item) => selectedShotIds.has(item.scope?.shotId) && item.scope?.shotId !== currentShotId);
  const transitions = allMemories.filter((item) => selectedTransitionIds.has(item.scope?.transitionId));
  const hardConstraints = allMemories.filter(
    (item) => item.sourceIntegrity?.status === 'verified' && item.constraintStrength === 'hard' && (item.importance || 0) >= 0.75
  );
  const reviewRequired = allMemories.filter((item) => item.sourceIntegrity?.status !== 'verified');
  const softCandidates = allMemories.filter(
    (item) => !hardConstraints.includes(item) && !reviewRequired.includes(item)
  );

  const compactionLog = [];
  const droppedMemoryIds = [];
  const includedIds = new Set();
  const sections = {
    pinned: [],
    currentShot: [],
    adjacentShots: [],
    transitions: [],
    hardConstraints: [],
    softContext: [],
    reviewRequired: [],
  };
  let usedTokens = 0;

  function addToSection(sectionName, memoryItem, required = false, allowDuplicate = false) {
    if (!memoryItem?.memoryId || (!allowDuplicate && includedIds.has(memoryItem.memoryId))) return;
    const tokens = estimateTokens(memoryItem);
    if (!required && usedTokens + tokens > tokenBudget) {
      const summary = summarizeMemory(memoryItem);
      const summaryTokens = estimateTokens(summary);
      if (usedTokens + summaryTokens <= tokenBudget && sectionName !== 'hardConstraints') {
        sections[sectionName].push(summary);
        if (!allowDuplicate) includedIds.add(memoryItem.memoryId);
        usedTokens += summaryTokens;
        compactionLog.push({ action: 'summarize', memoryId: memoryItem.memoryId, section: sectionName, reason: 'token budget' });
      } else {
        droppedMemoryIds.push(memoryItem.memoryId);
        compactionLog.push({ action: 'drop', memoryId: memoryItem.memoryId, section: sectionName, reason: 'token budget' });
      }
      return;
    }
    sections[sectionName].push(memoryItem);
    if (!allowDuplicate) includedIds.add(memoryItem.memoryId);
    usedTokens += tokens;
  }

  for (const item of pinned.sort((a, b) => memoryPriority(b, selectedShotIds, selectedTransitionIds, currentShotId) - memoryPriority(a, selectedShotIds, selectedTransitionIds, currentShotId))) {
    addToSection('pinned', item, true);
  }
  for (const item of currentShot) addToSection('currentShot', item, true, true);
  for (const item of transitions) addToSection('transitions', item, true);
  for (const item of adjacent) addToSection('adjacentShots', item, true, true);
  for (const item of hardConstraints) addToSection('hardConstraints', item, true, true);

  const remainingSoft = softCandidates
    .filter((item) => !includedIds.has(item.memoryId))
    .sort((a, b) => memoryPriority(b, selectedShotIds, selectedTransitionIds, currentShotId) - memoryPriority(a, selectedShotIds, selectedTransitionIds, currentShotId));
  for (const item of remainingSoft) addToSection('softContext', item, false);

  for (const item of reviewRequired) {
    addToSection('reviewRequired', item, true, true);
  }

  return {
    currentShotId,
    tokenBudget,
    estimatedTokens: usedTokens,
    selectedShotIds: [...selectedShotIds],
    selectedTransitionIds: [...selectedTransitionIds].filter(Boolean),
    ...sections,
    droppedMemoryIds: unique(droppedMemoryIds),
    compactionLog,
  };
}

function buildMetrics(memory, warnings = []) {
  return {
    memoryCount: memory.memories.length,
    shotMemoryCount: memory.memories.filter((item) => item.memoryType === 'shot').length,
    transitionMemoryCount: memory.memories.filter((item) => item.memoryType === 'transition').length,
    characterMemoryCount: memory.memories.filter((item) => item.memoryType === 'character').length,
    warningCount: warnings.length,
    happyHorseReferenceCount: memory.happyHorseReferencePlan.references.length,
  };
}

export function buildStoryboardContextMemory(input = {}) {
  const shots = asArray(input.shots);
  const sourceArtifacts = defaultSourceArtifacts(input);
  const memorySignature = buildMemorySignature(input);
  const artifactSignature = buildArtifactSignature(sourceArtifacts);
  const characters = registryWithGovernance(input.characterRegistry, input.characterAssetGovernanceReport);
  const warnings = [];
  if (!hasUsableSourceArtifact(sourceArtifacts)) {
    warnings.push({
      code: 'SOURCE_ARTIFACT_REVIEW_REQUIRED',
      severity: 'warn',
      message: 'Storyboard context memory was built without a non-synthetic source artifact; constraints are soft until reviewed.',
    });
  }
  const happyHorseReferencePlan = buildHappyHorseReferencePlan(characters);
  warnings.push(...happyHorseReferencePlan.warnings);

  const shotMemories = shots
    .map((shot, index) => buildShotMemory({ shot, index, input, sourceArtifacts, characters, warnings }))
    .filter(Boolean);
  const transitionMemories = [];
  for (let index = 0; index < shots.length - 1; index += 1) {
    const transition = buildTransitionMemory({
      previousShot: shots[index],
      nextShot: shots[index + 1],
      index,
      input: { ...input, characterRegistry: characters },
      sourceArtifacts,
    });
    if (transition) transitionMemories.push(transition);
  }
  const characterMemories = buildCharacterMemories({ characters, sourceArtifacts });
  const workingMemory = buildWorkingMemory({ shots, sourceArtifacts });
  const locationMemories = buildLocationMemories({ shots, sourceArtifacts });
  const experienceMemory = buildExperienceMemory({ input, sourceArtifacts });
  const evidenceMemories = buildEvidenceMemories({ sourceArtifacts });
  const builtMemories = attachReverseDependencies([
    workingMemory,
    ...shotMemories,
    ...transitionMemories,
    ...characterMemories,
    ...locationMemories,
    experienceMemory,
    ...evidenceMemories,
  ]);
  const conflictResult = detectConflicts(builtMemories);
  warnings.push(...conflictResult.warnings);
  const compaction = compactMemories(builtMemories);
  const memories = compaction.memories;
  const compactedShotMemories = memories.filter((memory) => memory.memoryType === 'shot');
  const compactedTransitionMemories = memories.filter((memory) => memory.memoryType === 'transition');
  const indexes = buildIndexes(memories);
  const shotContextIndex = buildContextIndex(compactedShotMemories, 'shot');
  const transitionContextIndex = buildContextIndex(
    compactedTransitionMemories,
    'transition'
  );
  const now = input.now || new Date().toISOString();

  const memory = {
    schemaVersion: SCHEMA_VERSION,
    projectId: input.projectId || 'unknown-project',
    runId: input.runId || input.runJobId || 'unknown-run',
    createdAt: now,
    updatedAt: now,
    memorySignature,
    sourceArtifactSignature: artifactSignature,
    sourceArtifacts,
    indexes,
    records: memories,
    shotMemory: compactedShotMemories,
    transitionMemory: compactedTransitionMemories,
    shotContextIndex,
    transitionContextIndex,
    happyHorseReferencePlan,
    warnings,
    memories,
    compactionLog: compaction.compactionLog,
    conflicts: conflictResult.conflicts,
  };

  memory.metrics = buildMetrics(memory, warnings);
  return memory;
}

export {
  buildArtifactSignature,
  buildStoryboardContextMemoryMarkdown,
  buildMemorySignature,
  compactMemory,
  isMemoryFresh,
  memoryWriteModeFor,
  readContext,
  recordInvalidation,
  writeMemory,
};

export const __testables = {
  HAPPY_HORSE_REF_LIMIT,
  buildHappyHorseReferencePlan,
  buildArtifactSignature,
  buildMemorySignature,
  buildIndexes,
  compactMemory,
  hasUsableSourceArtifact,
  isMemoryFresh,
  memoryWriteModeFor,
  scoreMemory,
  readContext,
  recordInvalidation,
  writeMemory,
};
