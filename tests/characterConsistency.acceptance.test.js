import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDirector } from '../src/agents/director.js';
import { buildCharacterRegistry } from '../src/agents/characterRegistry.js';
import { generateAllPrompts } from '../src/agents/promptEngineer.js';
import { runConsistencyCheck } from '../src/agents/consistencyChecker.js';
import { runContinuityCheck } from '../src/agents/continuityChecker.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { buildEpisodeDirName, buildProjectDirName } from '../src/utils/naming.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-character-consistency-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

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

test('character consistency acceptance run writes bible anchors identity report and continuity report artifacts', async () => {
  await withTempRoot(async (tempRoot) => {
    const dirs = createDirs(path.join(tempRoot, 'job'));
    const runJobs = [];

    const director = createDirector({
      initDirs: () => dirs,
      generateJobId: () => 'job_character_consistency_acceptance',
      loadJSON: () => null,
      createRunJob: (runJob) => runJobs.push(structuredClone(runJob)),
      appendAgentTaskRun: () => {},
      finishRunJob: () => {},
      loadProject: () => ({ id: 'project_1', name: '宫墙疑云' }),
      loadScript: () => ({
        id: 'script_1',
        title: '第一卷',
        characters: [],
        mainCharacterTemplates: [
          { id: 'tpl_hero', name: '沈清', gender: 'female', basePromptTokens: 'young noblewoman' },
        ],
      }),
      loadEpisode: () => ({
        id: 'episode_1',
        title: '第一集',
        episodeNo: 1,
        episodeCharacters: [
          {
            id: 'ep_char_1',
            name: '沈清',
            gender: 'female',
            mainCharacterTemplateId: 'tpl_hero',
            characterBibleId: 'bible_shenqing',
          },
        ],
        shots: [
          {
            id: 'shot_001',
            scene: '宫道',
            action: '回头',
            characters: ['沈清'],
            shotCharacters: [{ episodeCharacterId: 'ep_char_1', isPrimary: true }],
          },
          {
            id: 'shot_002',
            scene: '回廊',
            action: '快步前行',
            characters: ['沈清'],
            shotCharacters: [{ episodeCharacterId: 'ep_char_1', isPrimary: true }],
            continuityState: {
              carryOverFromShotId: 'shot_001',
              sceneLighting: 'cold moonlight',
              cameraAxis: 'left_to_right',
              propStates: [{ name: 'letter', side: 'right-hand' }],
              emotionState: { 沈清: '警觉' },
              continuityRiskTags: ['letter continuity'],
            },
          },
        ],
      }),
      listCharacterBibles: () => [
        {
          id: 'bible_shenqing',
          projectId: 'project_1',
          basePromptTokens: 'young woman, pale hanfu, neat fringe',
          negativeDriftTokens: 'different hairstyle, deep blue robe',
          coreTraits: { hairStyle: 'neat fringe', skinTone: 'fair skin' },
          wardrobeAnchor: { silhouette: 'long pale hanfu' },
        },
      ],
      buildCharacterRegistry: (characters, scriptContext, style, deps) =>
        buildCharacterRegistry(characters, scriptContext, style, deps),
      generateAllPrompts: (shots, registry, style, deps) =>
        generateAllPrompts(shots, registry, style, {
          ...deps,
          chatJSON: async () => ({
            image_prompt: 'cinematic palace corridor portrait',
            negative_prompt: 'blurry',
            style_notes: 'stable identity',
          }),
        }),
      generateAllImages: async (prompts) =>
        prompts.map((prompt) => ({
          shotId: prompt.shotId,
          imagePath: path.join(dirs.images, `${prompt.shotId}.png`),
          success: true,
        })),
      regenerateImage: async (shotId) => ({
        shotId,
        imagePath: path.join(dirs.images, `${shotId}-regenerated.png`),
        success: true,
      }),
      runConsistencyCheck: (registry, images, deps) =>
        runConsistencyCheck(registry, images, {
          ...deps,
          checkCharacterConsistency: async () => ({
            character: '沈清',
            overallScore: 6,
            identityDriftTags: ['hair_drift'],
            anchorSummary: { hair: 'fringe changed to loose curls' },
            problematicImageIndices: [1],
            suggestion: 'lock fringe and pale hanfu silhouette',
          }),
        }),
      runContinuityCheck: (shots, images, deps) =>
        runContinuityCheck(shots, images, {
          ...deps,
          threshold: 7,
          checkTransition: async (previousShot, currentShot) => ({
            previousShotId: previousShot.id,
            shotId: currentShot.id,
            continuityScore: 6,
            violations: ['prop_position_jump'],
            repairHints: ['keep letter in right hand'],
          }),
        }),
      generateAllAudio: async (shots) =>
        shots.map((shot) => ({ shotId: shot.id, audioPath: path.join(dirs.audio, `${shot.id}.mp3`) })),
      composeVideo: async (_shots, _images, _audio, outputPath) => {
        fs.writeFileSync(outputPath, 'video');
        return outputPath;
      },
    });

    const outputPath = await director.runEpisodePipeline({
      projectId: 'project_1',
      scriptId: 'script_1',
      episodeId: 'episode_1',
      options: {
        storeOptions: { baseTempDir: tempRoot },
        startedAt: '2026-04-02T09:00:00.000Z',
      },
    });

    assert.equal(runJobs.length, 1);
    assert.equal(
      outputPath,
      path.join(
        dirs.output,
        buildProjectDirName('宫墙疑云', 'project_1'),
        buildEpisodeDirName({ episodeNo: 1, id: 'episode_1' }),
        'final-video.mp4'
      )
    );
    assert.equal(fs.existsSync(path.join(path.dirname(outputPath), 'delivery-summary.md')), true);
    const artifactContext = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '宫墙疑云',
      scriptId: 'script_1',
      scriptTitle: '第一卷',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: runJobs[0].id,
      startedAt: '2026-04-02T09:00:00.000Z',
    });

    const characterBibleInput = JSON.parse(
      fs.readFileSync(
        path.join(artifactContext.agents.characterRegistry.inputsDir, 'character-bibles.json'),
        'utf-8'
      )
    );
    assert.equal(characterBibleInput[0].id, 'bible_shenqing');

    const registry = JSON.parse(
      fs.readFileSync(
        path.join(artifactContext.agents.characterRegistry.outputsDir, 'character-registry.json'),
        'utf-8'
      )
    );
    assert.equal(registry[0].characterBibleId, 'bible_shenqing');
    assert.equal(registry[0].negativeDriftTokens, 'different hairstyle, deep blue robe');

    const promptTable = fs.readFileSync(
      path.join(artifactContext.agents.promptEngineer.outputsDir, 'prompts.table.md'),
      'utf-8'
    );
    assert.match(promptTable, /shot_002/);

    const consistencyReport = JSON.parse(
      fs.readFileSync(
        path.join(artifactContext.agents.consistencyChecker.outputsDir, 'consistency-report.json'),
        'utf-8'
      )
    );
    assert.deepEqual(consistencyReport[0].identityDriftTags, ['hair_drift']);

    const continuityFlagged = JSON.parse(
      fs.readFileSync(
        path.join(artifactContext.agents.continuityChecker.outputsDir, 'flagged-transitions.json'),
        'utf-8'
      )
    );
    assert.deepEqual(continuityFlagged, [
      {
        previousShotId: 'shot_001',
        shotId: 'shot_002',
        triggerSource: 'llm_score',
        hardViolationCodes: [],
        continuityScore: 6,
        violations: ['prop_position_jump'],
        repairHints: ['keep letter in right hand'],
        recommendedAction: 'regenerate_prompt_and_image',
        repairMethod: 'prompt_regen',
        continuityTargets: ['prop_position_jump'],
      },
    ]);
  });
});
