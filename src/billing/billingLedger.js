import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { classifyBillingOperation } from './operationClassifier.js';

export const BILLING_LEDGER_FILE = 'billing-ledger.json';

const CACHE_TTL_MS = Number(process.env.WORKBENCH_CACHE_TTL_MS || 5000);
const _ledgerCache = new Map();

export function createBillingLedgerEntry(input = {}) {
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const openmeter = metadata.openmeter && typeof metadata.openmeter === 'object' ? metadata.openmeter : {};
  const billingStatus = input.status || 'unknown';
  return {
    id: input.id || `${input.category || 'unknown'}_${input.runId || 'run'}_${input.shotId || 'shot'}_${Date.now()}`,
    runId: input.runId || '',
    projectId: input.projectId || '',
    scriptId: input.scriptId || '',
    episodeId: input.episodeId || '',
    shotId: input.shotId || null,
    category: input.category || 'unknown',
    provider: input.provider || 'unknown',
    operation: classifyBillingOperation(input),
    requestId: input.requestId || null,
    currency: input.currency || 'CNY',
    amount: Number.isFinite(Number(input.amount)) ? Number(input.amount) : null,
    status: input.status || 'unknown',
    timestamp: input.timestamp || new Date().toISOString(),
    requestedAt: input.requestedAt || null,
    finishedAt: input.finishedAt || null,
    imagePath: input.imagePath || null,
    videoPath: input.videoPath || null,
    durationSec: Number.isFinite(Number(input.durationSec)) ? Number(input.durationSec) : null,
    promptSummary: input.promptSummary || '',
    referenceCount: Number.isFinite(Number(input.referenceCount)) ? Number(input.referenceCount) : 0,
    mode: input.mode || null,
    billingRef: input.billingRef || null,
    billingStatus,
    meteringStatus: openmeter.sent === true ? 'sent' : openmeter.sent === false ? 'failed' : 'unknown',
    meteringError: openmeter.reason || null,
    idempotencyKey: input.idempotencyKey || null,
    metadata: {
      ...metadata,
      openmeter,
    },
  };
}

export function getBillingLedgerPath(runDir) {
  return path.join(runDir, BILLING_LEDGER_FILE);
}

export function readBillingLedger(runDir) {
  const now = Date.now();
  const cached = _ledgerCache.get(runDir);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  const ledgerPath = getBillingLedgerPath(runDir);
  let result;
  try {
    if (!fs.existsSync(ledgerPath)) {
      result = [];
    } else {
      const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      result = Array.isArray(raw) ? raw : [];
    }
  } catch {
    result = [];
  }

  _ledgerCache.set(runDir, { value: result, ts: now });
  if (_ledgerCache.size > 500) {
    const oldest = _ledgerCache.keys().next().value;
    _ledgerCache.delete(oldest);
  }

  return result;
}

export function appendBillingLedgerEntry(runDir, entry) {
  ensureDir(runDir);
  const ledgerPath = getBillingLedgerPath(runDir);
  const current = readBillingLedger(runDir);
  const nextEntry = createBillingLedgerEntry(entry);
  const existingIndex =
    nextEntry.idempotencyKey
      ? current.findIndex((item) => item?.idempotencyKey && item.idempotencyKey === nextEntry.idempotencyKey)
      : current.findIndex((item) => item?.id && item.id === nextEntry.id);
  if (existingIndex >= 0) {
    current[existingIndex] = {
      ...current[existingIndex],
      ...nextEntry,
    };
    saveJSON(ledgerPath, current);
    return current[existingIndex];
  }
  current.push(nextEntry);
  saveJSON(ledgerPath, current);
  return current[current.length - 1];
}

export function updateBillingLedgerEntry(runDir, entryId, patch = {}) {
  const ledgerPath = getBillingLedgerPath(runDir);
  const current = readBillingLedger(runDir);
  const index = current.findIndex((item) => item?.id === entryId);
  if (index < 0) {
    return null;
  }
  current[index] = {
    ...current[index],
    ...patch,
  };
  saveJSON(ledgerPath, current);
  return current[index];
}

export function summarizeBillingLedger(entries = []) {
  const billedEntries = entries.filter((entry) => entry?.status === 'billed' && Number.isFinite(Number(entry?.amount)));
  const waiveredEntries = entries.filter((entry) => entry?.status === 'waived');
  const failedEntries = entries.filter((entry) => entry?.status === 'failed');
  const total = billedEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const byCategory = billedEntries.reduce((acc, entry) => {
    const key = entry.category || 'unknown';
    acc[key] = (acc[key] || 0) + Number(entry.amount || 0);
    return acc;
  }, {});
  const currency = billedEntries[0]?.currency || 'CNY';
  const unknownCount = entries.filter((entry) => entry?.status === 'unknown').length;

  return {
    currency,
    total,
    byCategory,
    billedCount: billedEntries.length,
    waivedCount: waiveredEntries.length,
    failedCount: failedEntries.length,
    unknownCount,
    hasRealBilling: billedEntries.length > 0,
  };
}

export default {
  BILLING_LEDGER_FILE,
  createBillingLedgerEntry,
  getBillingLedgerPath,
  readBillingLedger,
  appendBillingLedgerEntry,
  updateBillingLedgerEntry,
  summarizeBillingLedger,
};
