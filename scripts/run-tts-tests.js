import { spawnSync } from 'node:child_process';
import path from 'node:path';

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
if (keepArtifacts) {
  env.KEEP_TEST_ARTIFACTS = '1';
  env.TEST_ARTIFACTS_ROOT = path.join(process.cwd(), 'temp', 'test-artifacts', 'tts');
  console.log(`Keeping TTS test artifacts under: ${env.TEST_ARTIFACTS_ROOT}`);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
  env,
});

process.exit(result.status ?? 1);
