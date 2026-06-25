/**
 * 共享规范化工具函数
 * ponytail: extracted from 15+ duplicated definitions across domain/agents
 */

export function normalizeText(value, fallback = '') {
  if (value == null) return fallback;
  if (typeof value === 'object') return fallback;
  return String(value).trim() || fallback;
}

export function normalizeIdentity(value) {
  const text = normalizeText(value);
  return text || null;
}

export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  // ponytail: scalar wrapping preserves promptContract compatibility
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = normalizeText(value);
    return normalized ? [normalized] : [];
  }
  return [];
}

export function normalizePlainObject(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...fallback };
  }
  return { ...fallback, ...value };
}

export function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeText(value)?.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeMediaTaskDuration(durationSec) {
  const target = Number(durationSec);
  if (!Number.isFinite(target) || target <= 4) return '4';
  if (target <= 8) return '8';
  return '12';
}
