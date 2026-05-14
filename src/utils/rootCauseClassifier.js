function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeStringList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

export function classifyArtifactReadiness(result = {}, options = {}) {
  const {
    assetPathField = 'imagePath',
    successField = 'success',
    errorFields = ['error', 'reason'],
    timeoutPattern = /超时|timeout/i,
    readyCode = 'ready',
    readyLabel = '资产已就绪',
    timeoutCode = 'generation_timeout',
    timeoutLabel = '生成超时',
    failureCode = 'generation_failed',
    failureLabel = '生成失败',
    missingCode = 'result_missing',
    missingLabel = '结果缺失',
    missingReasonCode = 'missing_asset',
    timeoutReasonCode = 'generation_timeout',
    failureReasonCode = 'generation_failed',
    missingEvidenceWithoutPath = 'missing_asset_result',
    missingEvidenceWithPath = 'missing_success_flag',
  } = options;

  const assetPath = result?.[assetPathField] || null;
  const hasAssetPath = Boolean(assetPath);
  const isSuccess = result?.[successField] !== false && hasAssetPath;
  const errorText = errorFields
    .map((field) => normalizeString(result?.[field]))
    .find(Boolean) || '';

  if (isSuccess) {
    return {
      isReady: true,
      rootCauseCode: readyCode,
      rootCauseLabel: readyLabel,
      reasons: [],
      evidenceSummary: hasAssetPath ? `${assetPathField}_ready` : '',
    };
  }

  if (timeoutPattern.test(errorText)) {
    return {
      isReady: false,
      rootCauseCode: timeoutCode,
      rootCauseLabel: timeoutLabel,
      reasons: [missingReasonCode, timeoutReasonCode],
      evidenceSummary: errorText || timeoutCode,
    };
  }

  if (errorText) {
    return {
      isReady: false,
      rootCauseCode: failureCode,
      rootCauseLabel: failureLabel,
      reasons: [missingReasonCode, failureReasonCode],
      evidenceSummary: errorText,
    };
  }

  return {
    isReady: false,
    rootCauseCode: missingCode,
    rootCauseLabel: missingLabel,
    reasons: [missingReasonCode, missingCode],
    evidenceSummary: hasAssetPath ? missingEvidenceWithPath : missingEvidenceWithoutPath,
  };
}

export function linkSymptomToUpstreamRootCause({
  upstreamEntries = [],
  downstreamEntries = [],
  symptomCode,
  shouldIncludeDownstreamEntry,
  buildLink,
  learnedPattern = '',
} = {}) {
  const upstreamByShotId = new Map(
    (Array.isArray(upstreamEntries) ? upstreamEntries : [])
      .filter((entry) => entry?.shotId)
      .map((entry) => [entry.shotId, entry])
  );

  const matchedEntries = (Array.isArray(downstreamEntries) ? downstreamEntries : []).flatMap((entry) => {
    if (!entry?.shotId) {
      return [];
    }
    const reasons = normalizeStringList(entry?.reasons);
    if (symptomCode && !reasons.includes(symptomCode)) {
      return [];
    }
    if (typeof shouldIncludeDownstreamEntry === 'function' && !shouldIncludeDownstreamEntry(entry)) {
      return [];
    }
    const upstreamEntry = upstreamByShotId.get(entry.shotId);
    if (!upstreamEntry) {
      return [];
    }
    const link = typeof buildLink === 'function'
      ? buildLink(entry, upstreamEntry)
      : null;
    return link ? [link] : [];
  });

  return {
    matchedCount: matchedEntries.length,
    matchedShotIds: matchedEntries.map((entry) => entry.shotId).filter(Boolean),
    entries: matchedEntries,
    learnedPattern: matchedEntries.length > 0 ? normalizeString(learnedPattern) : '',
  };
}

export default {
  classifyArtifactReadiness,
  linkSymptomToUpstreamRootCause,
};
