import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildDirectorContextPack, buildStoryboardContext } from '../src/agents/storyboardContextAgent.js';
import { buildStoryboardContextMemory } from '../src/domain/storyboardContextMemory.js';

function makeArtifactContext(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    inputsDir: path.join(root, '0-inputs'),
    outputsDir: path.join(root, '1-outputs'),
    metricsDir: path.join(root, '2-metrics'),
    errorsDir: path.join(root, '3-errors'),
    manifestPath: path.join(root, 'manifest.json'),
  };
}

function sampleInput(overrides = {}) {
  return {
    projectId: 'project-demo',
    runId: 'run-demo',
    now: '2026-06-10T00:00:00.000Z',
    sourceArtifacts: [
      {
        path: 'output/run-demo/director/shot-plan.json',
        artifactType: 'director-pack',
        agent: 'director',
        hash: 'sha256-test',
      },
    ],
    shots: [
      {
        id: 'shot-001',
        sceneId: 'scene-001',
        scene: 'stable yard',
        location: 'stable yard',
        spatialLayout: 'stalls on left, rail on right',
        lightSource: 'warm window light',
        timeOfDay: 'morning',
        action: 'HappyHorse runs right with the lantern',
        characters: [
          {
            id: 'happyhorse',
            outfit: 'red saddle blanket',
            hairStyle: 'braided mane',
            identity: 'stable hero',
          },
        ],
        props: [{ id: 'lantern', holder: 'happyhorse', status: 'intact', location: 'mouth' }],
        exitState: 'HappyHorse exits screen right carrying the lantern',
      },
      {
        id: 'shot-002',
        sceneId: 'scene-001',
        scene: 'stable yard',
        location: 'stable yard',
        action: 'HappyHorse enters from left and jumps over a rail',
        characters: ['happyhorse'],
        entryState: 'HappyHorse enters with the lantern still visible',
      },
    ],
    characterRegistry: [
      {
        id: 'happyhorse',
        name: 'HappyHorse',
        priority: 'lead',
        characterBibleId: 'bible-happyhorse',
        appearanceSummary: 'bright chestnut horse with expressive eyes',
        outfit: 'red saddle blanket',
        hairStyle: 'braided mane',
        scars: 'small star-shaped scar on left shoulder',
        age: 'young adult',
        identity: 'stable hero',
        personalitySummary: 'brave, curious, loyal',
        canonicalReferences: Array.from({ length: 12 }, (_, index) => `/refs/happyhorse-${index + 1}.png`),
      },
    ],
    characterAssetGovernanceReport: {
      records: [
        {
          assetId: 'happyhorse',
          name: 'HappyHorse',
          characterBibleId: 'bible-happyhorse',
          canonicalReferences: ['/refs/happyhorse-canonical.png'],
          governanceStatus: 'approved',
        },
      ],
    },
    motionPlan: [
      {
        shotId: 'shot-001',
        screenDirection: 'right',
        spaceAnchor: 'stable yard',
        visualGoal: 'horse runs right',
        continuityContext: { storyBeat: 'run right', screenDirection: 'right', spaceAnchor: 'stable yard' },
      },
      {
        shotId: 'shot-002',
        screenDirection: 'right',
        spaceAnchor: 'stable yard',
        visualGoal: 'horse jumps',
        continuityContext: { storyBeat: 'jump rail', screenDirection: 'right', spaceAnchor: 'stable yard' },
      },
    ],
    performancePlan: [{ shotId: 'shot-001', emotion: 'urgent' }],
    continuityReport: [{ shotId: 'shot-001', status: 'pass', exitState: 'lantern in mouth' }],
    continuityFlaggedTransitions: [],
    imageResults: [{ shotId: 'shot-001', imagePath: '/images/shot-001.png', status: 'success' }],
    videoProviderCapabilities: { sora2: { imageToVideo: true } },
    ...overrides,
  };
}

test('main character canonical refs are written into shot and character memory', () => {
  const memory = buildStoryboardContextMemory(sampleInput());
  const shotMemory = memory.shotMemory.find((item) => item.scope.shotId === 'shot-001');
  const characterMemory = memory.memories.find((item) => item.memoryId === 'mem-character-happyhorse');

  assert.equal(shotMemory.content.referencesByCharacter.happyhorse.includes('/refs/happyhorse-canonical.png'), true);
  assert.equal(characterMemory.content.canonicalReferences.includes('/refs/happyhorse-canonical.png'), true);
  assert.equal(characterMemory.pinned, true);
  assert.equal(memory.indexes.byCharacterId.happyhorse.includes('mem-character-happyhorse'), true);
});

test('adjacent action shots create transition memory', () => {
  const memory = buildStoryboardContextMemory(sampleInput());
  const transitionId = 'transition-shot-001-shot-002';

  assert.equal(memory.transitionMemory.length, 1);
  assert.equal(memory.transitionMemory[0].scope.transitionId, transitionId);
  assert.equal(memory.transitionContextIndex[transitionId].memoryIds.includes(`mem-${transitionId}-handoff`), true);
  assert.equal(memory.indexes.byTransitionId[transitionId].includes(`mem-${transitionId}-handoff`), true);
});

test('HappyHorse reference plan is capped at nine refs', () => {
  const memory = buildStoryboardContextMemory(sampleInput());

  assert.equal(memory.happyHorseReferencePlan.references.length, 9);
  assert.equal(memory.happyHorseReferencePlan.warnings.some((warning) => warning.code === 'HAPPY_HORSE_REFERENCE_TRIMMED'), true);
});

test('missing character assets produce warning without crashing', () => {
  const memory = buildStoryboardContextMemory(
    sampleInput({
      characterRegistry: [{ id: 'happyhorse', name: 'HappyHorse', priority: 'lead' }],
      characterAssetGovernanceReport: { records: [] },
    })
  );

  assert.equal(memory.happyHorseReferencePlan.references.length, 0);
  assert.equal(memory.warnings.some((warning) => warning.code === 'HAPPY_HORSE_REFERENCE_MISSING'), true);
  assert.equal(memory.warnings.some((warning) => warning.code === 'CHARACTER_REFERENCE_MISSING'), true);
});

test('storyboard context agent writes complete artifact set', async (t) => {
  const artifactContext = makeArtifactContext(t);
  const memory = await buildStoryboardContext(sampleInput(), { artifactContext });

  const outputFiles = [
    'storyboard-context-memory.json',
    'storyboard-context-memory.md',
    'shot-context-index.json',
    'transition-context-index.json',
  ];
  for (const fileName of outputFiles) {
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, fileName)), true);
  }
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'storyboard-context-memory-metrics.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'qa-summary.json')), true);
  assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'qa-summary.md')), true);
  assert.equal(fs.existsSync(artifactContext.manifestPath), true);

  const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
  const savedMemory = JSON.parse(
    fs.readFileSync(path.join(artifactContext.outputsDir, 'storyboard-context-memory.json'), 'utf-8')
  );

  assert.equal(manifest.memoryCount, memory.metrics.memoryCount);
  assert.equal(savedMemory.schemaVersion, '1.0.0');
  assert.deepEqual(Object.keys(savedMemory.shotContextIndex), ['shot-001', 'shot-002']);
});

test('memory records cover five context memory classes', () => {
  const memory = buildStoryboardContextMemory(sampleInput());
  const types = new Set(memory.records.map((item) => item.memoryType));

  assert.equal(types.has('working'), true);
  assert.equal(types.has('shot'), true);
  assert.equal(types.has('character'), true);
  assert.equal(types.has('location'), true);
  assert.equal(types.has('experience'), true);
  assert.equal(types.has('evidence'), true);
  assert.equal(memory.indexes.byMemoryType.working.includes('mem-working-summary'), true);
  assert.equal(memory.indexes.byMemoryType.evidence.includes('mem-evidence-01'), true);
});

test('missing sourceArtifact downgrades memory constraints and warns', () => {
  const memory = buildStoryboardContextMemory(sampleInput({ sourceArtifacts: [] }));
  const shotMemory = memory.records.find((item) => item.memoryType === 'shot');
  const evidenceMemory = memory.records.find((item) => item.memoryType === 'evidence');

  assert.equal(memory.sourceArtifacts[0].synthetic, true);
  assert.equal(shotMemory.sourceIntegrity.status, 'review_required');
  assert.equal(shotMemory.constraintStrength, 'soft');
  assert.equal(shotMemory.retentionClass, 'review_required');
  assert.equal(evidenceMemory.content.synthetic, true);
  assert.equal(memory.warnings.some((warning) => warning.code === 'SOURCE_ARTIFACT_REVIEW_REQUIRED'), true);
});

test('incomplete source artifact cannot create hard constraints', () => {
  const memory = buildStoryboardContextMemory(
    sampleInput({
      sourceArtifacts: [
        {
          path: 'output/run-demo/director/shot-plan.json',
        },
      ],
    })
  );
  const pack = buildDirectorContextPack(memory, { currentShotId: 'shot-001', tokenBudget: 4000 });

  assert.equal(memory.records.find((item) => item.memoryType === 'shot').constraintStrength, 'soft');
  assert.equal(pack.hardConstraints.length, 0);
  assert.equal(pack.reviewRequired.some((item) => item.memoryId === 'mem-shot-001-context'), true);
});

test('complete high-importance source enters hard constraints', () => {
  const memory = buildStoryboardContextMemory(sampleInput());
  const pack = buildDirectorContextPack(memory, { currentShotId: 'shot-001', tokenBudget: 4000 });

  assert.equal(memory.records.find((item) => item.memoryId === 'mem-shot-001-context').constraintStrength, 'hard');
  assert.equal(pack.hardConstraints.some((item) => item.memoryId === 'mem-working-summary'), true);
  assert.equal(pack.reviewRequired.length, 0);
});

test('conflicting storyboard context produces conflicts and warning', () => {
  const memory = buildStoryboardContextMemory(
    sampleInput({
      shots: [
        {
          id: 'shot-001',
          sceneId: 'scene-001',
          scene: 'stable yard',
          location: 'stable yard',
          action: 'HappyHorse runs right',
          characters: ['happyhorse'],
          exitState: 'HappyHorse exits screen right',
        },
        {
          id: 'shot-002',
          sceneId: 'scene-001',
          scene: 'forest road',
          location: 'forest road',
          action: 'HappyHorse enters from left',
          characters: ['happyhorse'],
          entryState: 'HappyHorse enters empty handed',
        },
      ],
      motionPlan: [
        {
          shotId: 'shot-001',
          screenDirection: 'right',
          spaceAnchor: 'stable yard',
          continuityContext: { screenDirection: 'right', spaceAnchor: 'stable yard' },
        },
        {
          shotId: 'shot-002',
          screenDirection: 'left',
          spaceAnchor: 'forest road',
          continuityContext: { screenDirection: 'left', spaceAnchor: 'forest road' },
        },
      ],
    })
  );

  assert.equal(memory.conflicts.length >= 3, true);
  assert.equal(memory.conflicts.some((conflict) => conflict.conflictType === 'entry_exit_state_mismatch'), true);
  assert.equal(memory.conflicts.some((conflict) => conflict.conflictType === 'motion_direction_mismatch'), true);
  assert.equal(memory.conflicts.some((conflict) => conflict.conflictType === 'scene_location_mismatch'), true);
  assert.equal(memory.conflicts.every((conflict) => Boolean(conflict.conflictGroupId)), true);
  assert.equal(memory.warnings.some((warning) => warning.code === 'STORYBOARD_CONTEXT_CONFLICT'), true);
});

test('character and prop continuity conflicts are detected deterministically', () => {
  const memory = buildStoryboardContextMemory(
    sampleInput({
      shots: [
        {
          id: 'shot-001',
          sceneId: 'scene-001',
          scene: 'stable yard',
          location: 'stable yard',
          action: 'HappyHorse carries lantern',
          characters: [
            {
              id: 'happyhorse',
              outfit: 'red saddle blanket',
              hairStyle: 'braided mane',
              identity: 'stable hero',
            },
          ],
          props: [{ id: 'lantern', holder: 'happyhorse', status: 'intact', location: 'mouth' }],
        },
        {
          id: 'shot-002',
          sceneId: 'scene-001',
          scene: 'stable yard',
          location: 'stable yard',
          action: 'HappyHorse reaches rail',
          characters: [
            {
              id: 'happyhorse',
              outfit: 'blue racing blanket',
              hairStyle: 'loose mane',
              identity: 'circus performer',
            },
          ],
          props: [{ id: 'lantern', holder: 'stable hand', status: 'cracked', location: 'floor' }],
        },
      ],
    })
  );

  assert.equal(memory.conflicts.some((conflict) => conflict.kind === 'character_outfit_mismatch'), true);
  assert.equal(memory.conflicts.some((conflict) => conflict.kind === 'character_hairStyle_mismatch'), true);
  assert.equal(memory.conflicts.some((conflict) => conflict.kind === 'character_identity_mismatch'), true);
  assert.equal(memory.conflicts.some((conflict) => conflict.kind === 'prop_holder_mismatch'), true);
  assert.equal(memory.conflicts.some((conflict) => conflict.kind === 'prop_status_mismatch'), true);
  assert.equal(memory.conflicts.some((conflict) => conflict.kind === 'prop_location_mismatch'), true);
  assert.equal(memory.conflicts.every((conflict) => Boolean(conflict.conflictGroupId) && conflict.severity), true);
});

test('token budget context pack preserves pinned current and adjacent context while compacting low value records', () => {
  const memory = buildStoryboardContextMemory(
    sampleInput({
      shots: [
        ...sampleInput().shots,
        {
          id: 'shot-003',
          sceneId: 'scene-002',
          scene: 'forest road',
          location: 'forest road',
          action: 'A distant cart rolls away',
          characters: [],
        },
      ],
      characterRegistry: [
        ...sampleInput().characterRegistry,
        { id: 'background-extra', name: 'Background Extra', isTemporary: true },
      ],
      characterAssetGovernanceReport: { records: [] },
    })
  );
  const pack = buildDirectorContextPack(memory, { currentShotId: 'shot-002', tokenBudget: 950, windowSize: 1 });

  assert.equal(pack.pinned.some((item) => item.memoryId === 'mem-working-summary'), true);
  assert.equal(pack.currentShot.some((item) => item.memoryId === 'mem-shot-002-context'), true);
  assert.equal(pack.adjacentShots.some((item) => item.memoryId === 'mem-shot-001-context'), true);
  assert.equal(pack.selectedShotIds.includes('shot-001'), true);
  assert.equal(pack.selectedShotIds.includes('shot-002'), true);
  assert.equal(pack.droppedMemoryIds.length > 0 || pack.compactionLog.some((entry) => ['drop', 'summarize'].includes(entry.action)), true);
});

test('character and location long-term memory includes appearance and layout fields', () => {
  const memory = buildStoryboardContextMemory(sampleInput());
  const characterMemory = memory.records.find((item) => item.memoryId === 'mem-character-happyhorse');
  const locationMemory = memory.records.find((item) => item.memoryId === 'mem-location-stable yard');

  assert.equal(characterMemory.content.appearance.outfit, 'red saddle blanket');
  assert.equal(characterMemory.content.appearance.hairStyle, 'braided mane');
  assert.equal(characterMemory.content.appearance.scars, 'small star-shaped scar on left shoulder');
  assert.equal(characterMemory.content.appearance.age, 'young adult');
  assert.equal(characterMemory.content.appearance.identity, 'stable hero');
  assert.equal(characterMemory.content.appearance.personalitySummary, 'brave, curious, loyal');
  assert.equal(locationMemory.content.spatialLayout.includes('stalls on left, rail on right'), true);
  assert.equal(locationMemory.content.lightSources.includes('warm window light'), true);
  assert.equal(locationMemory.content.timeOfDay.includes('morning'), true);
  assert.equal(locationMemory.content.keyProps.includes('lantern'), true);
});

test('agent can return optional director context pack', async () => {
  const memory = await buildStoryboardContext(sampleInput(), { currentShotId: 'shot-001', tokenBudget: 1200 });

  assert.equal(memory.contextPack.currentShotId, 'shot-001');
  assert.equal(memory.contextPack.currentShot.some((item) => item.memoryId === 'mem-shot-001-context'), true);
});

test('compaction logs duplicate removal and cold migration while preserving pinned records', () => {
  const memory = buildStoryboardContextMemory(
    sampleInput({
      sourceArtifacts: [
        {
          path: 'output/run-demo/director/shot-plan.json',
          artifactType: 'director-pack',
          agent: 'director',
          hash: 'sha256-test',
        },
        {
          path: 'in-memory/duplicate-note.json',
          artifactType: 'synthetic-note',
          agent: 'storyboardContextAgent',
          hash: 'sha256-synthetic',
          synthetic: true,
        },
        {
          path: 'in-memory/duplicate-note.json',
          artifactType: 'synthetic-note',
          agent: 'storyboardContextAgent',
          hash: 'sha256-synthetic',
          synthetic: true,
        },
      ],
      shots: [
        {
          id: 'shot-001',
          sceneId: 'scene-001',
          scene: 'stable yard',
          action: 'HappyHorse runs right with the lantern',
          characters: ['happyhorse'],
          exitState: 'HappyHorse exits screen right carrying the lantern',
        },
        {
          id: 'shot-001',
          sceneId: 'scene-001',
          scene: 'stable yard',
          action: 'HappyHorse runs right with the lantern',
          characters: ['happyhorse'],
          exitState: 'HappyHorse exits screen right carrying the lantern',
        },
      ],
      characterRegistry: [
        {
          id: 'happyhorse',
          name: 'HappyHorse',
          priority: 'lead',
          characterBibleId: 'bible-happyhorse',
          canonicalReferences: ['/refs/happyhorse-canonical.png'],
        },
        {
          id: 'background-extra',
          name: 'Background Extra',
          isTemporary: true,
        },
      ],
      characterAssetGovernanceReport: { records: [] },
      motionPlan: [],
      performancePlan: [],
      continuityReport: [],
      imageResults: [],
    })
  );

  const pinnedShotRecords = memory.records.filter((item) => item.memoryId === 'mem-shot-001-context');
  const extraMemory = memory.records.find((item) => item.memoryId === 'mem-character-background-extra');

  assert.equal(memory.compactionLog.some((entry) => entry.action === 'deduplicate'), true);
  assert.equal(memory.compactionLog.some((entry) => entry.action === 'migrate' && entry.memoryId === 'mem-character-background-extra'), true);
  assert.equal(pinnedShotRecords.length, 2);
  assert.equal(pinnedShotRecords.every((item) => item.pinned), true);
  assert.equal(extraMemory.layer === 'cold' || extraMemory.layer === 'archived', true);
});
