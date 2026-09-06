import { appendBillingLedgerEntry, updateBillingLedgerEntry } from './billingLedger.js';
import { emitOpenMeterEvent } from './openmeterClient.js';

function trimPrompt(value = '', max = 180) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

export async function recordBillingEvent(runDir, input = {}) {
  if (!runDir) {
    return null;
  }

  const idempotencyKey = input.idempotencyKey || [
    input.runId || 'run',
    input.category || 'unknown',
    input.shotId || 'shot',
    input.operation || 'unknown',
    input.requestId || 'request',
  ].join(':');

  const entry = appendBillingLedgerEntry(runDir, {
    ...input,
    idempotencyKey,
    promptSummary: trimPrompt(input.promptSummary || input.prompt || ''),
    referenceCount: input.referenceCount || 0,
  });

  const metering = await emitOpenMeterEvent(entry);
  updateBillingLedgerEntry(runDir, entry.id, {
    metadata: {
      ...(entry.metadata || {}),
      openmeter: metering,
    },
    meteringStatus: metering?.sent ? 'sent' : 'failed',
    meteringError: metering?.reason || null,
  });

  return {
    ...entry,
    metadata: {
      ...(entry.metadata || {}),
      openmeter: metering,
    },
    meteringStatus: metering?.sent ? 'sent' : 'failed',
    meteringError: metering?.reason || null,
  };
}

export default {
  recordBillingEvent,
};
