import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { findLatestArtifactDirs, printArtifactGuide } from './test-artifact-guide.js';

const keepArtifacts = process.argv.includes('--keep-artifacts');
const agentKey = process.argv.slice(2).find((arg) => !arg.startsWith('--'));

function createConfig({
  agentKey,
  title,
  scope,
  testFiles,
  nodeArgs = [],
  markerFileNames = ['qa-summary.md', 'qa-overview.md', 'delivery-summary.md'],
  parentLevels = 3,
  notes = [],
}) {
  const artifactRoot = path.join(process.cwd(), 'temp', scope);
  return {
    agentKey,
    title,
    scope,
    artifactRoot,
    nodeArgs: ['--test', ...nodeArgs, ...testFiles],
    markerFileNames,
    parentLevels,
    notes,
  };
}

const CONFIGS = {
  'script-parser': createConfig({
    agentKey: 'script-parser',
    title: 'Script Parser 测试指南',
    scope: 'script-parser',
    testFiles: ['tests/scriptParser.artifacts.test.js'],
    notes: [
      '优先进入最新 run 下的 01-script-parser。',
      '先看 1-outputs/shots.table.md 和 qa-summary.md。',
      '需要原始输入时，再看 0-inputs/source-script.txt。',
    ],
  }),
  'character-registry': createConfig({
    agentKey: 'character-registry',
    title: 'Character Registry 测试指南',
    scope: 'character-registry',
    testFiles: ['tests/promptEngineer.artifacts.test.js'],
    nodeArgs: [
      '--test-name-pattern',
      'character registry writes registry outputs metrics and manifest when artifactContext is present',
    ],
    notes: [
      '优先进入最新 run 下的 02-character-registry。',
      '先看 1-outputs/character-registry.md 和 qa-summary.md。',
      '排查映射问题时，再看 character-name-mapping.json。',
    ],
  }),
  'prompt-engineer': createConfig({
    agentKey: 'prompt-engineer',
    title: 'Prompt Engineer 测试指南',
    scope: 'prompt-engineer',
    testFiles: ['tests/promptEngineer.artifacts.test.js'],
    nodeArgs: [
      '--test-name-pattern',
      'prompt engineer writes prompt outputs metrics fallback evidence and manifest when artifactContext is present',
    ],
    notes: [
      '优先进入最新 run 下的 03-prompt-engineer。',
      '先看 1-outputs/prompts.table.md 和 qa-summary.md。',
      'LLM 降级时重点看 3-errors/ 下的 fallback 证据。',
    ],
  }),
  'image-generator': createConfig({
    agentKey: 'image-generator',
    title: 'Image Generator 测试指南',
    scope: 'image-generator',
    testFiles: ['tests/imageGenerator.artifacts.test.js'],
    notes: [
      '优先进入最新 run 下的 04-image-generator。',
      '先看 1-outputs/images.index.json 和 qa-summary.md。',
      '失败重试链路重点看 3-errors/retry-log.json。',
    ],
  }),
  'consistency-checker': createConfig({
    agentKey: 'consistency-checker',
    title: 'Consistency Checker 测试指南',
    scope: 'consistency-checker',
    testFiles: ['tests/ttsAgent.artifacts.test.js'],
    nodeArgs: [
      '--test-name-pattern',
      'consistency checker writes report flagged shots metrics and manifest when artifactContext is present',
    ],
    notes: [
      '优先进入最新 run 下的 05-consistency-checker。',
      '先看 consistency-report.md、flagged-shots.json 和 qa-summary.md。',
    ],
  }),
  'continuity-checker': createConfig({
    agentKey: 'continuity-checker',
    title: 'Continuity Checker 测试指南',
    scope: 'continuity-checker',
    testFiles: ['tests/continuityChecker.test.js', 'tests/continuityChecker.artifacts.test.js', 'tests/continuityOnly.acceptance.test.js'],
    notes: [
      '优先进入最新 run 下的 06-continuity-checker。',
      '先看 continuity-report.md、flagged-transitions.json 和 qa-summary.md。',
      '真正定位修复方案时，再看 repair-plan.json 和 repair-attempts.json。',
    ],
  }),
  'tts-agent': createConfig({
    agentKey: 'tts-agent',
    title: 'TTS Agent 测试指南',
    scope: 'tts-agent',
    testFiles: [
      'tests/dialogueNormalizer.test.js',
      'tests/ttsAgent.voicePreset.test.js',
      'tests/ttsAgent.artifacts.test.js',
      'tests/director.voicePreset.test.js',
    ],
    notes: [
      '优先进入最新 run 下的 07-tts-agent。',
      '先看 dialogue-table.md、voice-resolution.json 和 qa-summary.md。',
      '逐镜头失败证据在 3-errors/ 下。',
    ],
  }),
  'tts-qa': createConfig({
    agentKey: 'tts-qa',
    title: 'TTS QA 测试指南',
    scope: 'tts-qa',
    testFiles: ['tests/ttsQaAgent.test.js'],
    notes: [
      '优先进入最新 run 下的 08-tts-qa。',
      '先看 voice-cast-report.md、manual-review-sample.md 和 qa-summary.md。',
      'ASR 回写详情在 2-metrics/asr-report.json。',
    ],
  }),
  'lipsync-agent': createConfig({
    agentKey: 'lipsync-agent',
    title: 'Lip-sync Agent 测试指南',
    scope: 'lipsync-agent',
    testFiles: ['tests/lipsyncAgent.test.js'],
    notes: [
      '优先进入最新 run 下的 08b-lipsync-agent。',
      '先看 lipsync-report.md、lipsync.index.json 和 qa-summary.md。',
      '失败或降级镜头在 3-errors/ 下有逐镜头证据。',
    ],
  }),
  'video-composer': createConfig({
    agentKey: 'video-composer',
    title: 'Video Composer 测试指南',
    scope: 'video-composer',
    testFiles: ['tests/videoComposer.artifacts.test.js'],
    notes: [
      '优先进入最新 run 下的 09-video-composer。',
      '先看 compose-plan.json、segment-index.json、video-metrics.json 和 qa-summary.md。',
      'FFmpeg 失败时重点看 ffmpeg-command.txt 和 ffmpeg-stderr.txt。',
    ],
  }),
  director: createConfig({
    agentKey: 'director',
    title: 'Director 测试指南',
    scope: 'director',
    testFiles: ['tests/director.artifacts.test.js', 'tests/director.project-run.test.js'],
    markerFileNames: ['qa-overview.md', 'delivery-summary.md', 'qa-summary.md'],
    notes: [
      '优先进入最新 run 根目录，先看 qa-overview.md。',
      '如果已经出片，再看 delivery-summary.md。',
      '再按需进入各 agent 子目录继续排查。',
    ],
  }),
};

if (!agentKey || !CONFIGS[agentKey]) {
  console.error(
    `用法：node scripts/run-agent-prod-tests.js <agentKey> [--keep-artifacts]\n可选 agentKey：${Object.keys(CONFIGS).join(', ')}`
  );
  process.exit(1);
}

const config = CONFIGS[agentKey];
const env = { ...process.env };

if (keepArtifacts) {
  env.KEEP_TEST_ARTIFACTS = '1';
  env.TEST_ARTIFACTS_ROOT = config.artifactRoot;
  console.log(`Keeping ${config.agentKey} test artifacts under: ${env.TEST_ARTIFACTS_ROOT}`);
}

const result = spawnSync(process.execPath, config.nodeArgs, {
  stdio: 'inherit',
  env,
});

if (keepArtifacts) {
  const latestRunDirs = findLatestArtifactDirs(config.artifactRoot, {
    markerFileNames: config.markerFileNames,
    limit: 3,
    parentLevels: config.parentLevels,
  });

  printArtifactGuide({
    title: config.title,
    status: result.status === 0 ? 'passed' : 'failed',
    artifactRoot: config.artifactRoot,
    quickLookFiles: [config.artifactRoot, path.join(config.artifactRoot, 'projects')],
    notes: config.notes,
    latestRunDirs,
  });
}

process.exit(result.status ?? 1);
