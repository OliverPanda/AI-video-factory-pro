import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function sanitizeSegment(value) {
  return String(value || 'artifact').replace(/[^\w\u4e00-\u9fa5-]/g, '_');
}

export function shouldKeepTestArtifacts() {
  return process.env.KEEP_TEST_ARTIFACTS === '1';
}

export function getTestArtifactsRoot(scope = 'general') {
  if (shouldKeepTestArtifacts()) {
    return path.resolve(process.env.TEST_ARTIFACTS_ROOT || path.join(process.cwd(), 'temp', scope));
  }

  return os.tmpdir();
}

export function makeManagedTempDir(t, prefix, scope = 'general') {
  const root = getTestArtifactsRoot(scope);
  fs.mkdirSync(root, { recursive: true });

  const dir = shouldKeepTestArtifacts()
    ? fs.mkdtempSync(path.join(root, `${sanitizeSegment(prefix)}-`))
    : fs.mkdtempSync(path.join(root, `${sanitizeSegment(prefix)}-`));

  t.after(() => {
    if (!shouldKeepTestArtifacts()) {
      fs.rmSync(dir, { recursive: true, force: true });
    } else {
      // Keep artifacts on disk for manual inspection.
      const markerPath = path.join(dir, '.keep');
      if (!fs.existsSync(markerPath)) {
        fs.writeFileSync(markerPath, 'kept by KEEP_TEST_ARTIFACTS=1\n', 'utf-8');
      }
    }
  });

  return dir;
}

export function withManagedTempRoot(t, prefix, fn, scope = 'general') {
  const tempRoot = makeManagedTempDir(t, prefix, scope);
  return Promise.resolve().then(() => fn(tempRoot));
}
