import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkCharacterConsistency, runConsistencyCheck } from '../src/agents/consistencyChecker.js';

test('runConsistencyCheck marks lead+anchor score 8.2 as pass_with_review and avoids auto regen', async () => {
  const result = await runConsistencyCheck(
    [
      {
        name: '沈清',
        priority: 'lead',
        visualDescription: 'young woman in pale hanfu',
        basePromptTokens: 'young woman, pale hanfu',
      },
    ],
    [
      {
        shotId: 'shot_001',
        imagePath: 'a.png',
        success: true,
        characters: ['沈清'],
        shotType: 'close-up',
      },
      {
        shotId: 'shot_002',
        imagePath: 'b.png',
        success: true,
        characters: ['沈清'],
      },
    ],
    {
      checkCharacterConsistency: async () => ({
        character: '沈清',
        overallScore: 8.2,
        identityDriftTags: ['hair_drift', 'palette_drift', 'hair_drift'],
        hardFailureReasons: [],
        softRiskTags: ['hair_drift'],
        anchorSummary: {
          hair: 'bangs became curls',
          palette: 'robe changed from pale green to deep blue',
        },
        problematicImageIndices: [0],
        suggestion: 'lock hairstyle and robe palette',
      }),
    }
  );

  assert.equal(result.reports.length, 1);
  assert.deepEqual(result.reports[0].identityDriftTags, ['hair_drift', 'palette_drift']);
  assert.equal(result.reports[0].characterPriority, 'lead');
  assert.equal(result.reports[0].shotConsistencyClass, 'anchor');
  assert.deepEqual(result.reports[0].hardFailureReasons, []);
  assert.deepEqual(result.reports[0].softRiskTags, ['hair_drift']);
  assert.equal(result.reports[0].qaDecision.status, 'pass_with_review');
  assert.equal(result.reports[0].regenStrategy, 'none');
  assert.deepEqual(result.needsRegeneration, []);
});

test('runConsistencyCheck allows support+complex score 7.1 as low-confidence pass with soft risks only', async () => {
  const result = await runConsistencyCheck(
    [
      {
        name: '店长',
        priority: 'support',
        visualDescription: 'middle-aged man in shirt',
      },
    ],
    [
      {
        shotId: 'shot_010',
        imagePath: 'x.png',
        success: true,
        characters: ['店长'],
        tags: ['action', 'crowd'],
      },
      {
        shotId: 'shot_011',
        imagePath: 'y.png',
        success: true,
        characters: ['店长'],
      },
    ],
    {
      checkCharacterConsistency: async () => ({
        character: '店长',
        overallScore: 7.1,
        identityDriftTags: ['palette_drift'],
        hardFailureReasons: [],
        softRiskTags: ['palette_drift'],
        problematicImageIndices: [0],
        suggestion: 'stabilize palette',
      }),
    }
  );

  assert.equal(result.reports[0].shotConsistencyClass, 'complex');
  assert.equal(result.reports[0].qaDecision.status, 'pass_with_review');
  assert.equal(result.reports[0].regenStrategy, 'none');
  assert.deepEqual(result.needsRegeneration, []);
});

test('runConsistencyCheck blocks immediately when hardFailureReasons exist', async () => {
  const result = await runConsistencyCheck(
    [
      {
        name: '沈清',
        priority: 'lead',
        visualDescription: 'young woman in pale hanfu',
      },
    ],
    [
      { shotId: 'shot_020', imagePath: 'm.png', success: true, characters: ['沈清'] },
      { shotId: 'shot_021', imagePath: 'n.png', success: true, characters: ['沈清'] },
    ],
    {
      checkCharacterConsistency: async () => ({
        character: '沈清',
        overallScore: 9.6,
        identityDriftTags: ['identity_swap'],
        hardFailureReasons: ['identity_swap'],
        softRiskTags: [],
        problematicImageIndices: [1],
        suggestion: 're-anchor from bible references',
      }),
    }
  );

  assert.equal(result.reports[0].qaDecision.status, 'block');
  assert.equal(result.reports[0].regenStrategy, 'reanchor_regenerate');
  assert.deepEqual(result.reports[0].hardFailureReasons, ['identity_swap']);
  assert.deepEqual(result.needsRegeneration, [
    {
      shotId: 'shot_021',
      reason: '沈清 触发硬失败：identity_swap',
      regenStrategy: 'reanchor_regenerate',
      hardFailureReasons: ['identity_swap'],
      softRiskTags: [],
      suggestion: 're-anchor from bible references',
    },
  ]);
});

test('runConsistencyCheck matches character images by stable id before display name', async () => {
  const result = await runConsistencyCheck(
    [
      {
        episodeCharacterId: 'char_target',
        name: '沈清',
        priority: 'lead',
        visualDescription: 'young woman in pale hanfu',
      },
    ],
    [
      {
        shotId: 'shot_wrong_name_collision',
        imagePath: 'a.png',
        success: true,
        characters: [{ episodeCharacterId: 'char_other', name: '沈清' }],
      },
      {
        shotId: 'shot_target',
        imagePath: 'b.png',
        success: true,
        characters: [{ episodeCharacterId: 'char_target', name: '沈清' }],
        shotType: 'close-up',
      },
      {
        shotId: 'shot_target_2',
        imagePath: 'c.png',
        success: true,
        characters: [{ episodeCharacterId: 'char_target', name: '沈清' }],
      },
    ],
    {
      checkCharacterConsistency: async (_name, _card, charImages) => {
        assert.deepEqual(charImages.map((image) => image.shotId), ['shot_target', 'shot_target_2']);
        return {
          character: '沈清',
          overallScore: 8.2,
          identityDriftTags: ['hair_drift'],
          hardFailureReasons: [],
          softRiskTags: ['hair_drift'],
          problematicImageIndices: [0],
          suggestion: 'lock hairstyle',
        };
      },
    }
  );

  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].qaDecision.status, 'pass_with_review');
  assert.deepEqual(result.needsRegeneration, []);
});

test('runConsistencyCheck falls back to legacy name matching when image results do not carry structured ids', async () => {
  const result = await runConsistencyCheck(
    [
      {
        episodeCharacterId: 'char_legacy',
        name: '沈清',
        priority: 'support',
        visualDescription: 'young woman in pale hanfu',
      },
    ],
    [
      { shotId: 'shot_legacy_1', imagePath: 'a.png', success: true, characters: ['沈清'] },
      { shotId: 'shot_legacy_2', imagePath: 'b.png', success: true, characters: ['沈清'], shotType: 'close-up' },
    ],
    {
      checkCharacterConsistency: async (_name, _card, charImages) => {
        assert.deepEqual(charImages.map((image) => image.shotId), ['shot_legacy_1', 'shot_legacy_2']);
        return {
          character: '沈清',
          overallScore: 7.5,
          identityDriftTags: ['hair_drift'],
          hardFailureReasons: [],
          softRiskTags: ['hair_drift'],
          problematicImageIndices: [1],
          suggestion: 'lock hairstyle',
        };
      },
    }
  );

  assert.equal(result.reports.length, 1);
  assert.deepEqual(result.needsRegeneration.map((entry) => entry.shotId), ['shot_legacy_2']);
});

test('checkCharacterConsistency aggregates hard/soft tags across real batches and keeps decimal average', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-consistency-real-batch-'));
  try {
    const images = Array.from({ length: 7 }, (_, index) => {
      const imagePath = path.join(tempRoot, `img-${index + 1}.png`);
      fs.writeFileSync(imagePath, `fake-${index + 1}`);
      return { shotId: `shot_${String(index + 1).padStart(3, '0')}`, imagePath };
    });

    let callCount = 0;
    const report = await checkCharacterConsistency(
      '沈清',
      { name: '沈清' },
      images,
      {
        visionChat: async () => {
          callCount += 1;
          const responsePayloads = [
            {
              overallScore: 8.2,
              identityDriftTags: ['hair_drift'],
              hardFailureReasons: ['identity_swap'],
              softRiskTags: ['hair_drift'],
              problematicImageIndices: [0, '2'],
            },
            {
              overallScore: 8.5,
              identityDriftTags: ['palette_drift'],
              hardFailureReasons: ['face_swap'],
              softRiskTags: ['palette_drift'],
              problematicImageIndices: ['0'],
            },
          ];
          return JSON.stringify(responsePayloads[callCount - 1]);
        },
      }
    );

    assert.equal(callCount, 2);
    assert.equal(report.overallScore, 8.35);
    assert.deepEqual(report.hardFailureReasons, ['identity_swap', 'face_swap']);
    assert.deepEqual(report.softRiskTags, ['hair_drift', 'palette_drift']);
    assert.deepEqual(report.problematicImageIndices, [0, 2, 6]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('runConsistencyCheck preserves skipped/error and normalizes numeric strings', async () => {
  const result = await runConsistencyCheck(
    [
      {
        name: '沈清',
        priority: 'lead',
        visualDescription: 'young woman in pale hanfu',
      },
    ],
    [
      { shotId: 'shot_030', imagePath: 'm.png', success: true, characters: ['沈清'] },
      { shotId: 'shot_031', imagePath: 'n.png', success: true, characters: ['沈清'] },
      { shotId: 'shot_032', imagePath: 'o.png', success: true, characters: ['沈清'] },
    ],
    {
      checkCharacterConsistency: async () => ({
        character: '沈清',
        overallScore: '8.2',
        identityDriftTags: ['hair_drift'],
        hardFailureReasons: [],
        softRiskTags: ['hair_drift'],
        problematicImageIndices: ['1', 2, -1, 'abc'],
        skipped: true,
        error: 'mock timeout',
      }),
    }
  );

  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].overallScore, 8.2);
  assert.deepEqual(result.reports[0].problematicImageIndices, [1, 2]);
  assert.equal(result.reports[0].skipped, true);
  assert.equal(result.reports[0].error, 'mock timeout');
  assert.deepEqual(result.needsRegeneration, []);
});

test('runConsistencyCheck treats invalid overallScore as risky instead of defaulting to pass', async () => {
  const result = await runConsistencyCheck(
    [
      {
        name: '沈清',
        priority: 'lead',
        visualDescription: 'young woman in pale hanfu',
      },
    ],
    [
      { shotId: 'shot_040', imagePath: 'm.png', success: true, characters: ['沈清'], shotType: 'close-up' },
      { shotId: 'shot_041', imagePath: 'n.png', success: true, characters: ['沈清'] },
    ],
    {
      checkCharacterConsistency: async () => ({
        character: '沈清',
        overallScore: 'not-a-number',
        identityDriftTags: ['hair_drift'],
        hardFailureReasons: [],
        softRiskTags: ['hair_drift'],
        problematicImageIndices: [0],
        suggestion: 'lock hairstyle and face shape',
      }),
    }
  );

  assert.equal(result.reports[0].overallScore, 0);
  assert.equal(result.reports[0].qaDecision.status, 'warn');
  assert.deepEqual(result.needsRegeneration, [
    {
      shotId: 'shot_040',
      reason: '沈清 一致性评分 0/10（lead/anchor）',
      regenStrategy: 'prompt_tighten',
      hardFailureReasons: [],
      softRiskTags: ['hair_drift'],
      suggestion: 'lock hairstyle and face shape',
    },
  ]);
});

test('runConsistencyCheck keeps consistency_check_unavailable as blocking report without inventing a fake shot-level fallback', async () => {
  const result = await runConsistencyCheck(
    [
      {
        episodeCharacterId: 'char_1',
        name: '沈清',
        priority: 'lead',
        visualDescription: 'young woman in pale hanfu',
      },
    ],
    [
      { shotId: 'shot_050', imagePath: 'm.png', success: true, characters: [{ episodeCharacterId: 'char_1', name: '沈清' }] },
      { shotId: 'shot_051', imagePath: 'n.png', success: true, characters: [{ episodeCharacterId: 'char_1', name: '沈清' }] },
    ],
    {
      checkCharacterConsistency: async () => ({
        character: '沈清',
        overallScore: 0,
        identityDriftTags: ['consistency_check_unavailable'],
        hardFailureReasons: ['consistency_check_unavailable'],
        softRiskTags: ['consistency_check_unavailable'],
        problematicImageIndices: [],
        error: '所有批次均失败',
      }),
    }
  );

  assert.equal(result.reports[0].qaDecision.status, 'block');
  assert.deepEqual(result.reports[0].hardFailureReasons, ['consistency_check_unavailable']);
  assert.deepEqual(result.needsRegeneration, []);
});

test('runConsistencyCheck maps problematicImageIndices against valid image list when some imagePath are missing', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-consistency-index-map-'));
  try {
    const validImageA = path.join(tempRoot, 'shot-valid-a.png');
    const validImageB = path.join(tempRoot, 'shot-valid-b.png');
    fs.writeFileSync(validImageA, 'a');
    fs.writeFileSync(validImageB, 'b');

    const result = await runConsistencyCheck(
      [
        {
          name: '沈清',
          priority: 'support',
          visualDescription: 'young woman in pale hanfu',
        },
      ],
      [
        {
          shotId: 'shot_missing',
          imagePath: path.join(tempRoot, 'missing.png'),
          success: true,
          characters: ['沈清'],
        },
        {
          shotId: 'shot_valid_a',
          imagePath: validImageA,
          success: true,
          characters: ['沈清'],
        },
        {
          shotId: 'shot_valid_b',
          imagePath: validImageB,
          success: true,
          characters: ['沈清'],
        },
      ],
      {
        visionChat: async () =>
          JSON.stringify({
            overallScore: 6.2,
            problematicImageIndices: [0],
            identityDriftTags: ['hair_drift'],
            softRiskTags: ['hair_drift'],
          }),
      }
    );

    assert.equal(result.reports.length, 1);
    assert.deepEqual(result.reports[0].problematicImageIndices, [0]);
    assert.equal(result.needsRegeneration.length, 1);
    assert.equal(result.needsRegeneration[0].shotId, 'shot_valid_a');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
