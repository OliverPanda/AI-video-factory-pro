import path from 'node:path';
import fs from 'node:fs';

function toWindowsFriendlyPath(filePath) {
  return filePath.split('/').join(path.sep);
}

function collectMatchingFiles(rootDir, targetFileName, matches = []) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return matches;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      collectMatchingFiles(fullPath, targetFileName, matches);
      continue;
    }

    if (entry.isFile() && entry.name === targetFileName) {
      matches.push(fullPath);
    }
  }

  return matches;
}

export function findLatestArtifactDirs(
  artifactRoot,
  { markerFileNames = ['qa-overview.md'], limit = 3, parentLevels = 1 } = {}
) {
  const matches = [];

  for (const markerFileName of markerFileNames) {
    collectMatchingFiles(artifactRoot, markerFileName, matches);
  }

  const uniqueMatches = Array.from(new Set(matches));

  return uniqueMatches
    .map((filePath) => {
      let targetDir = path.dirname(filePath);
      for (let index = 1; index < parentLevels; index += 1) {
        targetDir = path.dirname(targetDir);
      }

      return {
        filePath,
        targetDir,
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit)
    .map((item) => item.targetDir);
}

export function printArtifactGuide({
  title,
  status,
  artifactRoot,
  quickLookFiles = [],
  notes = [],
  latestRunDirs = [],
}) {
  const normalizedRoot = artifactRoot ? toWindowsFriendlyPath(artifactRoot) : null;
  const normalizedFiles = quickLookFiles.map((filePath) => toWindowsFriendlyPath(filePath));
  const normalizedNotes = notes.map((item) => String(item || '').trim()).filter(Boolean);
  const normalizedLatestRuns = latestRunDirs.map((item) => toWindowsFriendlyPath(item));

  console.log('');
  console.log('='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
  console.log(`结果：${status === 'passed' ? '通过' : '失败'}`);

  if (normalizedRoot) {
    console.log(`成果物基础目录：${normalizedRoot}`);
  }

  console.log('');
  console.log('小白查看顺序：');

  if (normalizedFiles.length === 0) {
    console.log('- 本次命令没有额外保留建议文件。');
  } else {
    for (const filePath of normalizedFiles) {
      console.log(`- ${filePath}`);
    }
  }

  if (normalizedNotes.length > 0) {
    console.log('');
    console.log('补充说明：');
    for (const note of normalizedNotes) {
      console.log(`- ${note}`);
    }
  }

  if (normalizedLatestRuns.length > 0) {
    console.log('');
    console.log('最新 run 完整路径：');
    for (const runDir of normalizedLatestRuns) {
      console.log(`- ${runDir}`);
    }
  }

  console.log('='.repeat(72));
  console.log('');
}
