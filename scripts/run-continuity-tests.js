import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { findLatestArtifactDirs, printArtifactGuide } from './test-artifact-guide.js';

const artifactRoot = path.join(process.cwd(), 'temp', 'debug-continuity-only');
const testFiles = [
  'tests/continuityChecker.test.js',
  'tests/continuityChecker.artifacts.test.js',
  'tests/continuityOnly.acceptance.test.js',
  'tests/continuityOnly.debug.test.js',
];

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
  env: { ...process.env },
});

const latestRunDirs = findLatestArtifactDirs(artifactRoot, {
  markerFileNames: ['qa-overview.md'],
  limit: 1,
  parentLevels: 1,
});

printArtifactGuide({
  title: 'Continuity 测试指南',
  status: result.status === 0 ? 'passed' : 'failed',
  artifactRoot,
  quickLookFiles: [
    path.join(artifactRoot, 'projects'),
    path.join(
      artifactRoot,
      'projects',
      '多角色多场景一致性测试__multi-scene-character-demo',
      'scripts'
    ),
  ],
  notes: [
    '先进入 projects 目录，再继续进入 scripts/<剧本>/episodes/<分集>/runs/<最新run>。',
    '到了某次 run 后，优先看 qa-overview.md，再看 06-continuity-checker/1-outputs/qa-summary.md。',
    '真正定位连贯性问题时，重点看 continuity-report.md、flagged-transitions.json、repair-plan.json、repair-attempts.json。',
  ],
  latestRunDirs,
});

process.exit(result.status ?? 1);
