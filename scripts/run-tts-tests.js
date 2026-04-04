import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { findLatestArtifactDirs, printArtifactGuide } from './test-artifact-guide.js';

const keepArtifacts = process.argv.includes('--keep-artifacts');
const testFiles = [
  'tests/dialogueNormalizer.test.js',
  'tests/pronunciationLexiconStore.test.js',
  'tests/voiceCastStore.test.js',
  'tests/asrApi.test.js',
  'tests/lipsyncApi.test.js',
  'tests/lipsyncAgent.test.js',
  'tests/ttsQaAgent.test.js',
  'tests/ttsApi.test.js',
  'tests/ttsAgent.test.js',
  'tests/ttsAgent.voicePreset.test.js',
  'tests/ttsAgent.artifacts.test.js',
  'tests/director.voicePreset.test.js',
];

const env = { ...process.env };
const artifactRoot = path.join(process.cwd(), 'temp', 'tts-agent');
if (keepArtifacts) {
  env.KEEP_TEST_ARTIFACTS = '1';
  env.TEST_ARTIFACTS_ROOT = artifactRoot;
  console.log(`Keeping TTS test artifacts under: ${env.TEST_ARTIFACTS_ROOT}`);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
  env,
});

if (keepArtifacts) {
  const latestRunDirs = findLatestArtifactDirs(artifactRoot, {
    markerFileNames: ['qa-overview.md', 'delivery-summary.md'],
    limit: 3,
    parentLevels: 1,
  });

  printArtifactGuide({
    title: 'TTS / QA / Lip-sync 测试指南',
    status: result.status === 0 ? 'passed' : 'failed',
    artifactRoot,
    quickLookFiles: [
      artifactRoot,
      path.join(artifactRoot, 'projects'),
    ],
    notes: [
      '先进入某个测试目录，再继续进入 projects/<项目>/scripts/<剧本>/episodes/<分集>/runs/<最新run>。',
      '到了某次 run 后，优先看 qa-overview.md。',
      '配音重点看 07-tts-agent/1-outputs/dialogue-table.md 和 08-tts-qa/1-outputs/qa-summary.md。',
      '口型重点看 08b-lipsync-agent/1-outputs/lipsync-report.md 和 08b-lipsync-agent/2-metrics/lipsync-report.json。',
      '如果这批产物来自 legacy 兼容模式测试，终端可能打印的是最新交付目录路径；这时优先打开 delivery-summary.md 和 final-video.mp4。',
    ],
    latestRunDirs,
  });
}

process.exit(result.status ?? 1);
