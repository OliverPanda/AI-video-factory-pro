/**
 * 角色设定Agent - 维护角色视觉档案，确保跨镜头一致性
 */

import fs from 'node:fs';
import path from 'node:path';
import { chatJSON } from '../llm/client.js';
import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';
import logger from '../utils/logger.js';

const CHARACTER_SYSTEM = `你是专业的漫剧角色设计师，负责为角色创建详细的视觉设定档案。
你需要从剧本信息中提取角色的视觉特征，并生成可用于AI图像生成的英文描述词。

原则：
- 描述要具体可视化，避免抽象词汇
- 优先描述可见特征：发型、发色、面部、体型、服装
- 生成图像提示词要与所选风格（写实/3D）匹配`;

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildRegistryMarkdown(cards) {
  return `${cards
    .map(
      (card) =>
        `## ${card.name}\n` +
        `- Character Bible: ${card.characterBibleId || ''}\n` +
        `- Gender: ${card.gender || ''}\n` +
        `- Age: ${card.age || ''}\n` +
        `- Visual: ${card.visualDescription || ''}\n` +
        `- Tokens: ${card.basePromptTokens || ''}\n` +
        `- Negative Drift Tokens: ${card.negativeDriftTokens || ''}\n` +
        `- Personality: ${card.personality || ''}\n`
    )
    .join('\n')}\n`;
}

function hasUsefulProfile(character = {}) {
  return Boolean(character.visualDescription || character.basePromptTokens);
}

function normalizeNameKey(name) {
  return String(name || '').trim().toLowerCase();
}

function normalizeAliasList(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

const CHARACTER_TOKEN_BLOCKLIST_RE =
  /\b(?:ladder|stairs?|staircase|rack|shelf|shelves|pillar|column|wall|door|window|room|corridor|hallway|building|architecture|background|furniture|table|chair|desk|sofa|bed|street|road|car|vehicle)\b/i;

function sanitizeTokenParts(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !CHARACTER_TOKEN_BLOCKLIST_RE.test(part));
}

export function buildCharacterIdentityCandidates(character = {}) {
  return [
    character?.episodeCharacterId,
    character?.characterId,
    character?.id,
    character?.mainCharacterTemplateId,
    character?.characterBibleId,
    character?.voicePresetId,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

export function resolveCharacterIdentity(character = {}) {
  return buildCharacterIdentityCandidates(character)[0] || null;
}

export function findCharacterByIdentity(registry = [], identity = null) {
  const target = String(identity || '').trim();
  if (!target) return null;

  return (
    registry.find((character) => buildCharacterIdentityCandidates(character).includes(target)) ?? null
  );
}

function findCharacterByName(registry = [], name = '') {
  const target = normalizeNameKey(name);
  if (!target) return null;

  return (
    registry.find((character) => {
      const candidates = [character?.name, ...(Array.isArray(character?.aliases) ? character.aliases : [])];
      return candidates.some((candidate) => normalizeNameKey(candidate) === target);
    }) ?? null
  );
}

function findUniqueCharacterByName(registry = [], name = '') {
  const target = normalizeNameKey(name);
  if (!target) return null;

  const matches = (Array.isArray(registry) ? registry : []).filter((character) => {
    const candidates = [character?.name, ...(Array.isArray(character?.aliases) ? character.aliases : [])];
    return candidates.some((candidate) => normalizeNameKey(candidate) === target);
  });

  return matches.length === 1 ? matches[0] : null;
}

export function findCharacterByIdentityOrName(registry = [], identityOrName = '') {
  return findCharacterByIdentity(registry, identityOrName) ?? findUniqueCharacterByName(registry, identityOrName);
}

function buildNameMapping(cards, sourceCharacters = [], generatedCharacters = []) {
  return sourceCharacters.map((source, index) => {
    const registryCharacter =
      cards.find(
        (card) =>
          card?.episodeCharacterId === (source?.episodeCharacterId ?? source?.id) ||
          card?.id === source?.id ||
          card?.name === source?.name
      ) ?? null;
    const matchedGeneratedCharacter =
      generatedCharacters.find((character) => character?.name === registryCharacter?.name) ?? null;

    return {
      sourceId: source?.id ?? null,
      sourceEpisodeCharacterId: source?.episodeCharacterId ?? source?.id ?? null,
      sourceName: source?.name ?? '',
      registryId: registryCharacter?.id ?? null,
      registryEpisodeCharacterId: registryCharacter?.episodeCharacterId ?? null,
      registryName: registryCharacter?.name ?? '',
      generatedName: matchedGeneratedCharacter?.name ?? null,
      matchedBy: matchedGeneratedCharacter ? 'generated_name' : (registryCharacter ? 'source_fallback' : 'unmatched'),
      hasUsefulProfile: hasUsefulProfile(registryCharacter),
    };
  });
}

function buildCharacterMetrics(cards, sourceCharacters, generatedCharacters = []) {
  const sourceCount = Array.isArray(sourceCharacters) ? sourceCharacters.length : 0;
  const sourceMappings = buildNameMapping(cards, sourceCharacters, generatedCharacters);
  const coveredCount = sourceMappings.filter((mapping) => mapping.hasUsefulProfile).length;
  const fallbackMergedCount = sourceMappings.filter((mapping) => mapping.matchedBy === 'source_fallback').length;
  const missingProfileCount = sourceMappings.filter((mapping) => !mapping.hasUsefulProfile).length;
  const characterBibleLinkedCount = cards.filter((card) => card?.characterBibleId).length;

  return {
    character_count: cards.length,
    registry_coverage_rate: sourceCount > 0 ? Math.min(coveredCount / sourceCount, 1) : 1,
    fallback_merged_count: fallbackMergedCount,
    missing_profile_count: missingProfileCount,
    character_bible_linked_count: characterBibleLinkedCount,
  };
}

function writeCharacterRegistryArtifacts(
  cards,
  sourceCharacters,
  generatedCharacters,
  artifactContext,
  extraInputs = {}
) {
  if (!artifactContext) {
    return;
  }

  saveJSON(path.join(artifactContext.inputsDir, 'source-characters.json'), sourceCharacters);
  if (extraInputs.characterBibles) {
    saveJSON(path.join(artifactContext.inputsDir, 'character-bibles.json'), extraInputs.characterBibles);
  }
  if (extraInputs.mainCharacterTemplates) {
    saveJSON(
      path.join(artifactContext.inputsDir, 'main-character-templates.json'),
      extraInputs.mainCharacterTemplates
    );
  }
  saveJSON(path.join(artifactContext.outputsDir, 'character-registry.json'), cards);
  writeTextFile(path.join(artifactContext.outputsDir, 'character-registry.md'), buildRegistryMarkdown(cards));
  saveJSON(
    path.join(artifactContext.outputsDir, 'character-name-mapping.json'),
    buildNameMapping(cards, sourceCharacters, generatedCharacters)
  );

  const metrics = buildCharacterMetrics(cards, sourceCharacters, generatedCharacters);
  saveJSON(path.join(artifactContext.metricsDir, 'character-metrics.json'), metrics);
  saveJSON(artifactContext.manifestPath, {
    status: 'completed',
    characterCount: cards.length,
    outputFiles: [
      'character-registry.json',
      'character-registry.md',
      'character-name-mapping.json',
      'character-metrics.json',
    ],
  });
  writeAgentQaSummary(
    {
      agentKey: 'characterRegistry',
      agentName: 'Character Registry',
      status: metrics.missing_profile_count > 0 ? 'warn' : 'pass',
      headline:
        metrics.missing_profile_count > 0
          ? `有 ${metrics.missing_profile_count} 个角色档案还不完整`
          : `已完成 ${cards.length} 个角色的建档`,
      summary:
        metrics.missing_profile_count > 0
          ? '大部分角色已完成映射，但仍有角色缺少可直接用于后续生成的完整视觉信息。'
          : '角色映射和视觉锚点已准备好，可供 Prompt 和配音链路继续使用。',
      passItems: [
        `角色档案数：${cards.length}`,
        `Character Bible 关联数：${metrics.character_bible_linked_count}`,
      ],
      warnItems:
        metrics.missing_profile_count > 0
          ? [`缺少完整 profile 的角色数：${metrics.missing_profile_count}`]
          : [],
      nextAction:
        metrics.missing_profile_count > 0
          ? '建议优先补齐缺 profile 的关键角色，再继续追求高质量产出。'
          : '可以继续进入 Prompt 生成阶段。',
      evidenceFiles: [
        '1-outputs/character-registry.json',
        '1-outputs/character-name-mapping.json',
        '2-metrics/character-metrics.json',
      ],
      metrics,
    },
    artifactContext
  );
}

/**
 * 构建角色视觉档案
 * @param {Array<{name, gender, age}>} characters - 角色列表（来自剧本解析）
 * @param {string} scriptContext - 剧本摘要（提供上下文）
 * @param {string} style - 'realistic' | '3d'
 * @returns {Promise<Array<CharacterCard>>}
 */
export async function buildCharacterRegistry(characters, scriptContext, style = 'realistic', deps = {}) {
  const runChatJSON = deps.chatJSON || chatJSON;
  logger.info('CharacterRegistry', `构建 ${characters.length} 个角色的视觉档案...`);

  if (Array.isArray(deps.episodeCharacters) && deps.episodeCharacters.length > 0) {
    const cards = buildEpisodeCharacterRegistry(
      deps.mainCharacterTemplates || [],
      deps.episodeCharacters,
      deps.characterBibles || []
    );
    writeCharacterRegistryArtifacts(
      cards,
      deps.episodeCharacters,
      [],
      deps.artifactContext,
      {
        characterBibles: deps.characterBibles || [],
        mainCharacterTemplates: deps.mainCharacterTemplates || [],
      }
    );
    logger.info('CharacterRegistry', `角色档案构建完成：${cards.map((c) => c.name).join('、')}`);
    return cards;
  }

  const prompt = `
根据以下剧本信息，为每个角色创建详细的视觉档案：

<剧本背景>
${scriptContext}
</剧本背景>

<角色列表>
${characters.map((c) => `- ${c.name}（${c.gender === 'female' ? '女' : '男'}，${c.age || '成年'}）`).join('\n')}
</角色列表>

<视觉风格>
${style === '3d' ? '3D渲染风格（Pixar/Cinema4D）' : '写实摄影风格（电影级人像）'}
</视觉风格>

请为每个角色输出JSON档案，格式：
{
  "characters": [
    {
      "name": "角色名",
      "gender": "male/female",
      "age": "年龄描述",
      "visualDescription": "用于Prompt的英文外观描述（含发型、肤色、服装等，50词内）",
      "basePromptTokens": "核心提示词（10-15个英文词，每次生成该角色时必须包含）",
      "personality": "性格特点（中文，影响表情/姿态生成）"
    }
  ]
}`;

  const result = await runChatJSON(
    [
      { role: 'system', content: CHARACTER_SYSTEM },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.4 }
  );

  const generatedCharacters = result.characters || [];
  const cards = mergeCharacterSources(generatedCharacters, characters);
  writeCharacterRegistryArtifacts(cards, characters, generatedCharacters, deps.artifactContext, {
    characterBibles: deps.characterBibles || [],
    mainCharacterTemplates: deps.mainCharacterTemplates || [],
  });
  logger.info('CharacterRegistry', `角色档案构建完成：${cards.map((c) => c.name).join('、')}`);
  return cards;
}

/**
 * 获取指定角色的 Prompt 插入词
 * @param {string} characterName
 * @param {Array} registry
 * @returns {string} basePromptTokens
 */
export function getCharacterTokens(characterName, registry) {
  const card = findCharacterByName(registry, characterName);
  return card ? card.basePromptTokens : '';
}

export function getSanitizedCharacterTokens(character = {}) {
  const sourceTokens = character?.basePromptTokens || character?.visualDescription || '';
  return sanitizeTokenParts(sourceTokens).join(', ');
}

function mergeCharacterSources(generatedCharacters = [], sourceCharacters = []) {
  const consumedSourceIndices = new Set();
  const mergedCharacters = generatedCharacters.map((character, index) => {
    const exactMatchIndex = sourceCharacters.findIndex(
      (source, sourceIndex) =>
        !consumedSourceIndices.has(sourceIndex) &&
        normalizeNameKey(source?.name) === normalizeNameKey(character?.name)
    );
    const sourceIndex = exactMatchIndex >= 0 ? exactMatchIndex : index;
    const source = sourceCharacters[sourceIndex] ?? null;
    if (source) {
      consumedSourceIndices.add(sourceIndex);
    }

    if (!source) return character;
    const aliasCandidates = normalizeAliasList([
      ...(Array.isArray(source.aliases) ? source.aliases : []),
      ...(character?.name && character.name !== source.name ? [character.name] : []),
      ...(Array.isArray(character?.aliases) ? character.aliases : []),
    ]);

    return {
      ...character,
      ...source,
      id: source.id ?? character.id,
      episodeCharacterId: source.episodeCharacterId ?? source.id ?? character.episodeCharacterId ?? character.id,
      characterBibleId: source.characterBibleId ?? character.characterBibleId ?? null,
      mainCharacterTemplateId:
        source.mainCharacterTemplateId ?? character.mainCharacterTemplateId ?? null,
      name: source.name ?? character.name ?? '',
      aliases: aliasCandidates.length > 0 ? aliasCandidates : undefined,
      generatedName: character.name ?? null,
    };
  });

  const fallbackCharacters = sourceCharacters
    .filter((_, index) => !consumedSourceIndices.has(index))
    .map((source) => ({
      ...source,
      id: source.id,
      episodeCharacterId: source.episodeCharacterId ?? source.id ?? null,
      characterBibleId: source.characterBibleId ?? null,
      mainCharacterTemplateId: source.mainCharacterTemplateId ?? null,
      aliases: normalizeAliasList(source.aliases || []),
    }));

  return [...mergedCharacters, ...fallbackCharacters];
}

function buildMergedEpisodeCharacter(mainTemplate = {}, episodeCharacter = {}, characterBible = null) {
  const bibleCoreTraits = characterBible?.coreTraits ?? {};
  const bibleHair = bibleCoreTraits.hairStyle ?? null;
  const bibleSkin = bibleCoreTraits.skinTone ?? null;
  const bibleFace = bibleCoreTraits.faceShape ?? null;
  const visualAnchorParts = [bibleFace, bibleHair, bibleSkin].filter(Boolean);

  return {
    ...characterBible,
    ...mainTemplate,
    ...episodeCharacter,
    id: episodeCharacter.id,
    episodeCharacterId: episodeCharacter.id,
    characterBibleId: episodeCharacter.characterBibleId ?? characterBible?.id ?? null,
    mainCharacterTemplateId: episodeCharacter.mainCharacterTemplateId ?? mainTemplate.id ?? null,
    name: episodeCharacter.name ?? mainTemplate.name ?? '',
    gender: episodeCharacter.gender ?? mainTemplate.gender ?? null,
    age: episodeCharacter.age ?? mainTemplate.age ?? null,
    visualDescription:
      episodeCharacter.visualOverride ??
      episodeCharacter.visualDescription ??
      characterBible?.basePromptTokens ??
      (visualAnchorParts.join(', ') || null) ??
      mainTemplate.visualDescription ??
      null,
    basePromptTokens:
      episodeCharacter.basePromptTokens ??
      characterBible?.basePromptTokens ??
      mainTemplate.basePromptTokens ??
      null,
    personality:
      episodeCharacter.personalityOverride ??
      episodeCharacter.personality ??
      mainTemplate.personality ??
      null,
    defaultVoiceProfile:
      episodeCharacter.voiceOverrideProfile ??
      episodeCharacter.defaultVoiceProfile ??
      mainTemplate.defaultVoiceProfile ??
      null,
    negativeDriftTokens: characterBible?.negativeDriftTokens ?? null,
    lightingAnchor: characterBible?.lightingAnchor ?? {},
    wardrobeAnchor: characterBible?.wardrobeAnchor ?? {},
    referenceImages: characterBible?.referenceImages ?? [],
    coreTraits: characterBible?.coreTraits ?? {},
    characterBible: characterBible ?? null,
    mainCharacterTemplate: mainTemplate || null,
    episodeCharacter,
  };
}

export function buildEpisodeCharacterRegistry(
  mainCharacterTemplates = [],
  episodeCharacters = [],
  characterBibles = []
) {
  return episodeCharacters.map((episodeCharacter) => {
    const mainTemplate =
      mainCharacterTemplates.find(
        (template) => template?.id === (episodeCharacter?.mainCharacterTemplateId ?? null)
      ) ?? null;
    const characterBible =
      characterBibles.find((bible) => bible?.id === (episodeCharacter?.characterBibleId ?? null)) ?? null;

    return buildMergedEpisodeCharacter(mainTemplate, episodeCharacter, characterBible);
  });
}

export function getEpisodeCharacterContext(episodeCharacterId, registry = []) {
  const character = findCharacterByIdentity(registry, episodeCharacterId);

  if (!character) return null;

  return {
    character,
    episodeCharacter: character.episodeCharacter ?? null,
    mainCharacterTemplate: character.mainCharacterTemplate ?? null,
    characterBible: character.characterBible ?? null,
  };
}

function sortShotCharacters(shotCharacters = []) {
  return [...shotCharacters].sort((left, right) => {
    const leftOrder = left?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right?.sortOrder ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
}

function findRegistryCharacterByRelation(relation, registry) {
  if (!relation) return null;

  const relationCharacterId = resolveCharacterIdentity(relation);
  if (relationCharacterId) {
    const matchedById = findCharacterByIdentity(registry, relationCharacterId);
    if (matchedById) return matchedById;
  }

  const relationName = relation.characterName ?? relation.name ?? relation.character?.name ?? '';
  if (!relationName) return null;
  return findCharacterByName(registry, relationName);
}

function createParticipant(character, relation = null, fallbackName = '') {
  return {
    relation,
    character,
    name: character?.name || fallbackName || '',
  };
}

function resolveLegacyParticipants(shot, registry = [], relations = []) {
  if (!Array.isArray(shot?.characters) || shot.characters.length === 0) return [];

  return shot.characters
    .map((name, index) => {
      const character = findCharacterByName(registry, name);
      const relation = relations[index] ?? null;
      return createParticipant(character, relation, name);
    })
    .filter((participant) => participant.character || participant.name);
}

export function resolveShotParticipants(shot, registry = []) {
  if (Array.isArray(shot?.shotCharacters) && shot.shotCharacters.length > 0) {
    const sortedRelations = sortShotCharacters(shot.shotCharacters);
    const relationParticipants = sortedRelations
      .map((relation, index) => {
        const character = findRegistryCharacterByRelation(relation, registry);
        const fallbackName =
          relation?.characterName ??
          relation?.name ??
          relation?.character?.name ??
          shot?.characters?.[index] ??
          '';
        return createParticipant(character, relation, fallbackName);
      })
      .filter((participant) => participant.character || participant.name);

    if (relationParticipants.length > 0) {
      return relationParticipants;
    }

    return resolveLegacyParticipants(shot, registry, sortedRelations);
  }

  return resolveLegacyParticipants(shot, registry);
}

export function getShotCharacterCards(shot, registry = []) {
  return resolveShotParticipants(shot, registry)
    .map((participant) => participant.character)
    .filter(Boolean);
}

export function getShotCharacterNames(shot, registry = []) {
  return resolveShotParticipants(shot, registry)
    .map((participant) => participant.name)
    .filter(Boolean);
}

export function resolveShotSpeaker(shot, registry = []) {
  const participants = resolveShotParticipants(shot, registry);
  const relationSpeaker = participants.find((participant) => participant.relation?.isSpeaker);
  if (relationSpeaker) return relationSpeaker;

  if (shot?.speaker) {
    const speakerCard = findCharacterByIdentityOrName(registry, shot.speaker);
    if (speakerCard) {
      const speakerIdentity = resolveCharacterIdentity(speakerCard);
      const identityParticipant = speakerIdentity
        ? participants.find((participant) => resolveCharacterIdentity(participant.character) === speakerIdentity)
        : null;
      if (identityParticipant) return identityParticipant;

      return createParticipant(speakerCard, null, shot.speaker);
    }

    const namedParticipants = participants.filter(
      (participant) => normalizeNameKey(participant.name) === normalizeNameKey(shot.speaker)
    );
    if (namedParticipants.length === 1) return namedParticipants[0];
    if (namedParticipants.length > 1) return createParticipant(null, null, shot.speaker);

    return createParticipant(null, null, shot.speaker);
  }

  return participants[0] ?? null;
}

/**
 * 获取分镜中所有角色的 Prompt 组合
 */
export function getShotCharacterTokens(shot, registry) {
  return getShotCharacterNames(shot, registry)
    .map((name) => findCharacterByName(registry, name))
    .map((card) => getSanitizedCharacterTokens(card))
    .filter(Boolean)
    .join(', ');
}

export const __testables = {
  buildCharacterIdentityCandidates,
  findCharacterByIdentity,
  findCharacterByIdentityOrName,
  mergeCharacterSources,
  findCharacterByName,
};
