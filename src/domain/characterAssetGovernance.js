import path from 'node:path';

const LEAD_PRIORITIES = new Set(['lead', 'main', 'hero', 'anchor']);
const TEMPORARY_ROLE_TYPES = new Set(['temporary', 'temp', 'minor', 'guest', 'background', 'extra']);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeId(value) {
  return normalizeText(value) || null;
}

function normalizePriority(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (LEAD_PRIORITIES.has(normalized)) return 'lead';
  if (normalized === 'supporting') return 'support';
  if (normalized === 'temporary') return 'temporary';
  return normalized || 'support';
}

function normalizeRoleType(value) {
  return normalizeText(value).toLowerCase();
}

function uniqueRefs(values = []) {
  const refs = [];
  const seen = new Set();
  for (const value of values) {
    const ref = typeof value === 'string' ? value : value?.path || value?.url || value?.imagePath || null;
    const normalized = normalizeText(ref);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    refs.push(normalized);
  }
  return refs;
}

function findRefSheet(card = {}, characterRefSheets = []) {
  const identity = card.episodeCharacterId || card.characterId || card.id || card.name;
  return (Array.isArray(characterRefSheets) ? characterRefSheets : []).find((item) => {
    const candidates = [
      item?.characterId,
      item?.episodeCharacterId,
      item?.characterName,
      item?.name,
    ].map(normalizeText);
    return candidates.includes(normalizeText(identity)) || candidates.includes(normalizeText(card.name));
  }) ?? null;
}

export function collectCanonicalReferences(card = {}, characterRefSheets = []) {
  const refSheet = findRefSheet(card, characterRefSheets);
  return uniqueRefs([
    ...(Array.isArray(card.referenceImages) ? card.referenceImages : []),
    card.referenceImagePath,
    card.bestFramePath,
    refSheet?.imagePath,
  ]);
}

export function classifyCharacterAssetPolicy(card = {}, characterRefSheets = []) {
  const priority = normalizePriority(card.priority || card.characterPriority || card.tier);
  const roleType = normalizeRoleType(card.roleType || card.episodeCharacter?.roleType);
  const isTemporary =
    priority === 'temporary' ||
    TEMPORARY_ROLE_TYPES.has(roleType) ||
    card.isTemporary === true ||
    card.episodeCharacter?.isTemporary === true;
  const isLead = priority === 'lead' || card.isPrimary === true || card.episodeCharacter?.isPrimary === true;
  const characterBibleId = normalizeId(card.characterBibleId);
  const refs = collectCanonicalReferences(card, characterRefSheets);
  const warnings = [];
  const blockers = [];

  if (isLead && !characterBibleId) {
    blockers.push('主角/长期复用角色缺少 characterBibleId');
  }
  if (!isTemporary && refs.length === 0) {
    warnings.push('缺少 canonical refs 或三视图资产');
  }
  if (characterBibleId && refs.length === 0) {
    warnings.push('角色已进入项目级资产库，但还没有可复用参考图');
  }

  const reusePolicy = isTemporary
    ? 'episode_local'
    : (isLead || characterBibleId ? 'strong_bind' : 'medium_bind');
  const reviewRequired = blockers.length > 0 || warnings.length > 0 || (!characterBibleId && !isTemporary);
  const governanceStatus =
    blockers.length > 0
      ? 'blocked'
      : reviewRequired
        ? 'needs_review'
        : 'approved';

  return {
    priority,
    roleType: roleType || null,
    isTemporary,
    isLead,
    characterBibleId,
    reusePolicy,
    canonicalReferences: refs,
    governanceStatus,
    reviewRequired,
    warnings,
    blockers,
  };
}

export function buildCharacterAssetGovernanceReport({
  projectId,
  scriptId,
  episodeId,
  characterRegistry = [],
  characterRefSheets = [],
  now = new Date().toISOString(),
} = {}) {
  const records = (Array.isArray(characterRegistry) ? characterRegistry : []).map((card) => {
    const policy = classifyCharacterAssetPolicy(card, characterRefSheets);
    const assetVersion =
      card?.assetVersion ||
      card?.characterBible?.assetVersion ||
      card?.characterBible?.version ||
      (policy.characterBibleId ? 'v1' : null);
    const assetId = policy.characterBibleId || card.episodeCharacterId || card.id || card.name || 'unknown-character';

    return {
      assetId,
      name: card.name || assetId,
      episodeCharacterId: card.episodeCharacterId || card.id || null,
      characterBibleId: policy.characterBibleId,
      assetVersion,
      priority: policy.priority,
      roleType: policy.roleType,
      reusePolicy: policy.reusePolicy,
      governanceStatus: policy.governanceStatus,
      reviewRequired: policy.reviewRequired,
      canonicalReferences: policy.canonicalReferences,
      warnings: policy.warnings,
      blockers: policy.blockers,
    };
  });

  const reviewItems = records
    .filter((record) => record.reviewRequired)
    .map((record) => ({
      id: `asset_review_${record.assetId}`,
      type: 'asset_governance',
      priority: record.governanceStatus === 'blocked' ? 'high' : 'medium',
      characterBibleId: record.characterBibleId,
      episodeCharacterId: record.episodeCharacterId,
      characterName: record.name,
      reason: [...record.blockers, ...record.warnings].join('；') || '需要确认角色是否应升级为可复用资产',
      suggestedAction:
        record.governanceStatus === 'blocked'
          ? '补齐 characterBibleId 并选择 canonical refs 后再跨集复用'
          : '确认是否升级为项目级资产，或标记为单集临时角色',
      status: 'open',
    }));

  const auditEntries = records.map((record) => ({
    at: now,
    event: 'character_asset_policy_evaluated',
    projectId,
    scriptId,
    episodeId,
    assetId: record.assetId,
    characterBibleId: record.characterBibleId,
    assetVersion: record.assetVersion,
    governanceStatus: record.governanceStatus,
    reusePolicy: record.reusePolicy,
    canonicalReferenceCount: record.canonicalReferences.length,
  }));

  const blockedCount = records.filter((record) => record.governanceStatus === 'blocked').length;
  const reviewCount = records.filter((record) => record.governanceStatus === 'needs_review').length;
  const approvedCount = records.filter((record) => record.governanceStatus === 'approved').length;

  return {
    projectId,
    scriptId,
    episodeId,
    generatedAt: now,
    status: blockedCount > 0 ? 'block' : (reviewCount > 0 ? 'warn' : 'pass'),
    summary: {
      characterCount: records.length,
      approvedCount,
      reviewCount,
      blockedCount,
      reusableAssetCount: records.filter((record) => record.characterBibleId).length,
      localAssetCount: records.filter((record) => record.reusePolicy === 'episode_local').length,
    },
    records,
    reviewItems,
    auditEntries,
  };
}

export function buildCharacterAssetGovernanceMarkdown(report = {}) {
  const lines = [
    '# Character Asset Governance',
    '',
    `- Status: ${report.status || 'unknown'}`,
    `- Characters: ${report.summary?.characterCount || 0}`,
    `- Approved: ${report.summary?.approvedCount || 0}`,
    `- Needs Review: ${report.summary?.reviewCount || 0}`,
    `- Blocked: ${report.summary?.blockedCount || 0}`,
    '',
    '| Character | Bible | Version | Policy | Status | Refs | Issues |',
    '| --- | --- | --- | --- | --- | ---: | --- |',
  ];

  for (const record of report.records || []) {
    const issues = [...(record.blockers || []), ...(record.warnings || [])].join('<br>') || '';
    lines.push(
      `| ${record.name || ''} | ${record.characterBibleId || ''} | ${record.assetVersion || ''} | ${record.reusePolicy || ''} | ${record.governanceStatus || ''} | ${(record.canonicalReferences || []).length} | ${issues} |`
    );
  }

  lines.push('', '## Review Items');
  if ((report.reviewItems || []).length === 0) {
    lines.push('- 无');
  } else {
    for (const item of report.reviewItems || []) {
      lines.push(`- [${item.priority}] ${item.characterName}: ${item.reason} -> ${item.suggestedAction}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function buildReferenceSummary(records = []) {
  return (Array.isArray(records) ? records : []).map((record) => ({
    character: record.name,
    characterBibleId: record.characterBibleId,
    referenceCount: (record.canonicalReferences || []).length,
    references: (record.canonicalReferences || []).map((ref) => path.basename(ref)),
  }));
}

export default {
  buildCharacterAssetGovernanceMarkdown,
  buildCharacterAssetGovernanceReport,
  buildReferenceSummary,
  classifyCharacterAssetPolicy,
  collectCanonicalReferences,
};
