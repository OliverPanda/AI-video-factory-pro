import fs from 'node:fs';
import path from 'node:path';

export function safeExists(filePath) {
  try { return fs.existsSync(filePath); } catch { return false; }
}

export function createPathSecurityError(message) {
  const error = new Error(message);
  error.code = 'PATH_OUTSIDE_ROOT';
  return error;
}

export function isPathInside(basePath, candidatePath) {
  const absoluteBase = path.resolve(basePath);
  const absoluteCandidate = path.resolve(candidatePath);
  const relative = path.relative(absoluteBase, absoluteCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolvePathInside(basePath, targetPath, rootLabel = 'root directory') {
  const candidatePath = path.resolve(basePath, targetPath);
  if (!isPathInside(basePath, candidatePath)) {
    throw createPathSecurityError(`Resolved path is outside ${rootLabel}: ${targetPath}`);
  }
  return candidatePath;
}

export function validatePathSegment(value, label) {
  if (!value || typeof value !== 'string') {
    throw new Error(`Invalid ${label}: empty or missing`);
  }
  if (value.length > 255) {
    throw new Error(`Invalid ${label}: too long`);
  }
  if (value.includes('..') || value.includes('\\') || value.includes('\0') || value.includes('/')) {
    throw new Error(`Invalid ${label}: contains disallowed characters`);
  }
  if (/[\x00-\x1f]/.test(value)) {
    throw new Error(`Invalid ${label}: contains control characters`);
  }
  return value;
}

export function removePathIfSafe(targetPath, workspaceRoot) {
  if (!targetPath) return false;
  const absoluteTarget = resolvePathInside(workspaceRoot, targetPath, 'workspace');
  if (!safeExists(absoluteTarget)) return false;
  fs.rmSync(absoluteTarget, { recursive: true, force: true });
  return true;
}
