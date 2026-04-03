import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
import { runContinuityCheck } from '../src/agents/continuityChecker.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { saveJSON as realSaveJSON } from '../src/utils/fileHelper.js';

function createDirs(root) {
  const dirs = {
    root,
    images: path.join(root, 'images'),
    audio: path.join(root, 'audio'),
    output: path.join(root, 'output'),
  };

  Object.values(dirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  return dirs;
}

test('continuity-only debug run keeps artifacts under repo temp for manual inspection', async () => {
  const baseTempDir = path.join(process.cwd(), 'temp', 'debug-continuity-only');
  fs.rmSync(baseTempDir, { recursive: true, force: true });
  fs.mkdirSync(baseTempDir, { recursive: true });

  const dirs = createDirs(path.join(baseTempDir, 'job'));
  const runJobs = [];
  const sampleRoot = path.join(process.cwd(), 'temp', 'projects', 'multi-scene-character-demo');

  const project = JSON.parse(fs.readFileSync(path.join(sampleRoot, 'project.json'), 'utf-8'));
  const script = JSON.parse(
    fs.readFileSync(path.join(sampleRoot, 'scripts', 'pilot', 'script.json'), 'utf-8')
  );
  const episode = JSON.parse(
    fs.readFileSync(
      path.join(sampleRoot, 'scripts', 'pilot', 'episodes', 'episode-1', 'episode.json'),
      'utf-8'
    )
  );
  const characterBibles = fs
    .readdirSync(path.join(sampleRoot, 'character-bibles'))
    .filter((name) => name.endsWith('.json'))
    .map((name) =>
      JSON.parse(fs.readFileSync(path.join(sampleRoot, 'character-bibles', name), 'utf-8'))
    );

  const director = createDirector({
    initDirs: () => dirs,
    generateJobId: () => 'job_continuity_only_debug',
    loadJSON: () => null,
    saveJSON: realSaveJSON,
    createRunJob: (runJob) => runJobs.push(structuredClone(runJob)),
    appendAgentTaskRun: () => {},
    finishRunJob: () => {},
    loadProject: () => project,
    loadScript: () => script,
    loadEpisode: () => episode,
    listCharacterBibles: () => characterBibles,
    buildCharacterRegistry: async () =>
      episode.episodeCharacters.map((character) => ({
        id: character.id,
        name: character.name,
        characterBibleId: character.characterBibleId,
        basePromptTokens: character.name,
      })),
    generateAllPrompts: async (shots) =>
      shots.map((shot) => ({
        shotId: shot.id,
        image_prompt: `${shot.scene}, ${shot.action}`,
        negative_prompt: '',
      })),
    generateAllImages: async (prompts) =>
      prompts.map((prompt) => ({
        shotId: prompt.shotId,
        imagePath: path.join(dirs.images, `${prompt.shotId}.png`),
        success: true,
      })),
    runConsistencyCheck: async () => ({ reports: [], needsRegeneration: [] }),
    runContinuityCheck: (shots, imageResults, deps) =>
      runContinuityCheck(shots, imageResults, {
        ...deps,
        threshold: 7,
        checkTransition: async (previousShot, currentShot) => {
          if (currentShot.id === 'shot_004') {
            return {
              previousShotId: previousShot.id,
              shotId: currentShot.id,
              continuityScore: 6,
              softWarnings: [
                {
                  code: 'hand_off_jump',
                  severity: 'medium',
                  message: '密信交接后的站位和动作承接不够顺',
                },
              ],
              repairHints: [
                '保持顾言在画面左侧接信，沈清在右侧递信',
                '强调密信已从沈清右手过渡到顾言左手',
              ],
              continuityTargets: ['staging', 'prop_state'],
              recommendedAction: 'regenerate_prompt_and_image',
              repairMethod: 'prompt_regen',
            };
          }

          if (currentShot.id === 'shot_005') {
            return {
              previousShotId: previousShot.id,
              shotId: currentShot.id,
              continuityScore: 8,
              softWarnings: [
                {
                  code: 'three_character_blocking',
                  severity: 'medium',
                  message: '三人调度复杂，建议人工复核站位',
                },
              ],
              repairHints: ['保留顾言持信，侍卫阿成正面拦截'],
              continuityTargets: ['group_staging'],
              recommendedAction: 'manual_review',
              repairMethod: 'manual_review',
            };
          }

          return {
            previousShotId: previousShot.id,
            shotId: currentShot.id,
            continuityScore: 9,
            softWarnings: [],
            repairHints: [],
            continuityTargets: [],
            recommendedAction: 'pass',
            repairMethod: 'manual_review',
          };
        },
      }),
    regenerateImage: async (shotId) => ({
      shotId,
      imagePath: path.join(dirs.images, `${shotId}-continuity-fixed.png`),
      keyframeAssetId: `${shotId}_fixed_keyframe`,
      success: true,
    }),
    generateAllAudio: async () => [],
    composeVideo: async (_shots, _images, _audio, outputPath) => {
      fs.writeFileSync(outputPath, 'video');
      return outputPath;
    },
  });

  await director.runEpisodePipeline({
    projectId: 'multi-scene-character-demo',
    scriptId: 'pilot',
    episodeId: 'episode-1',
    options: {
      startedAt: '2026-04-02T13:30:00.000Z',
      storeOptions: { baseTempDir },
    },
  });

  assert.equal(runJobs.length, 1);

  const artifactContext = createRunArtifactContext({
    baseTempDir,
    projectId: 'multi-scene-character-demo',
    projectName: project.name,
    scriptId: 'pilot',
    scriptTitle: script.title,
    episodeId: 'episode-1',
    episodeTitle: episode.title,
    episodeNo: episode.episodeNo,
    runJobId: runJobs[0].id,
    startedAt: '2026-04-02T13:30:00.000Z',
  });

  console.log('\n[continuity-debug] artifact run dir:');
  console.log(artifactContext.runDir);
  console.log('[continuity-debug] open these files:');
  console.log(path.join(artifactContext.agents.continuityChecker.outputsDir, 'continuity-report.json'));
  console.log(path.join(artifactContext.agents.continuityChecker.outputsDir, 'flagged-transitions.json'));
  console.log(path.join(artifactContext.agents.continuityChecker.outputsDir, 'repair-plan.json'));
  console.log(path.join(artifactContext.agents.continuityChecker.outputsDir, 'repair-attempts.json'));
});
