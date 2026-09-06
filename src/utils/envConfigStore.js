import fs from 'node:fs';
import path from 'node:path';

const ENV_LINE_RE = /^([A-Z0-9_]+)=(.*?)(\s+#.*)?$/;

function normalizeEnvValue(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function parseEnvLine(line) {
  const match = line.match(ENV_LINE_RE);
  if (!match) {
    return null;
  }
  return {
    key: match[1],
    value: match[2] || '',
    comment: match[3] || '',
  };
}

function isPathInside(basePath, candidatePath) {
  const absoluteBase = path.resolve(basePath);
  const absoluteCandidate = path.resolve(candidatePath);
  const relative = path.relative(absoluteBase, absoluteCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveEnvFilePath(envFilePath, options = {}) {
  const absolutePath = path.resolve(envFilePath);
  const { allowedRoot, expectedBaseName } = options;

  if (expectedBaseName && path.basename(absolutePath) !== expectedBaseName) {
    throw new Error(`Invalid env file path: expected ${expectedBaseName}`);
  }

  if (allowedRoot && !isPathInside(allowedRoot, absolutePath)) {
    throw new Error(`Invalid env file path: outside allowed root ${allowedRoot}`);
  }

  return absolutePath;
}

export function readEnvFile(envFilePath, options = {}) {
  const absolutePath = resolveEnvFilePath(envFilePath, options);
  if (!fs.existsSync(absolutePath)) {
    return {
      path: absolutePath,
      raw: '',
      lines: [],
      values: {},
    };
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const values = {};

  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    values[parsed.key] = parsed.value;
  }

  return {
    path: absolutePath,
    raw,
    lines,
    values,
  };
}

export function updateEnvFile(envFilePath, updates, options = {}) {
  const state = readEnvFile(envFilePath, options);
  const lines = [...state.lines];
  const pending = new Map(
    Object.entries(updates).map(([key, value]) => [key, normalizeEnvValue(value)])
  );

  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseEnvLine(lines[index]);
    if (!parsed || !pending.has(parsed.key)) continue;
    const nextValue = pending.get(parsed.key);
    lines[index] = `${parsed.key}=${nextValue}${parsed.comment}`;
    pending.delete(parsed.key);
  }

  if (pending.size > 0) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('');
    }
    for (const [key, value] of pending.entries()) {
      lines.push(`${key}=${value}`);
    }
  }

  const nextRaw = lines.join('\n');
  fs.writeFileSync(state.path, nextRaw, 'utf8');

  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = normalizeEnvValue(value);
  }

  return readEnvFile(state.path, options);
}
