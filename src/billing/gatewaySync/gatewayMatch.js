function normalizedTokens(...values) {
  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

export function getGatewayEventMatchPriority(gatewayEvent = {}) {
  return [
    { field: 'requestId', value: gatewayEvent.requestId || null },
    { field: 'providerJobId', value: gatewayEvent.providerJobId || null },
    { field: 'idempotencyKey', value: gatewayEvent.idempotencyKey || null },
  ].filter((item) => typeof item.value === 'string' && item.value.trim());
}

export function findLedgerMatch(ledgerEntries = [], gatewayEvent = {}) {
  const priorities = getGatewayEventMatchPriority(gatewayEvent);
  for (const priority of priorities) {
    const matched = ledgerEntries.find((entry) => {
      const candidateTokens =
        priority.field === 'requestId'
          ? normalizedTokens(entry?.requestId, entry?.billingRef)
          : priority.field === 'providerJobId'
            ? normalizedTokens(entry?.billingRef, entry?.requestId)
            : normalizedTokens(entry?.idempotencyKey);
      return candidateTokens.includes(String(priority.value).trim());
    });
    if (matched) {
      return matched;
    }
  }
  return null;
}

export default {
  findLedgerMatch,
  getGatewayEventMatchPriority,
};
