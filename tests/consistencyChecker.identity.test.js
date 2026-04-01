import test from 'node:test';
import assert from 'node:assert/strict';

import { runConsistencyCheck } from '../src/agents/consistencyChecker.js';

test('runConsistencyCheck aggregates identity drift tags into reports and metrics-ready output', async () => {
  const result = await runConsistencyCheck(
    [
      {
        name: '沈清',
        visualDescription: 'young woman in pale hanfu',
        basePromptTokens: 'young woman, pale hanfu',
      },
    ],
    [
      { shotId: 'shot_001', imagePath: 'a.png', success: true, characters: ['沈清'] },
      { shotId: 'shot_002', imagePath: 'b.png', success: true, characters: ['沈清'] },
    ],
    {
      checkCharacterConsistency: async () => ({
        character: '沈清',
        overallScore: 5,
        identityDriftTags: ['hair_drift', 'palette_drift', 'hair_drift'],
        anchorSummary: {
          hair: 'bangs became curls',
          palette: 'robe changed from pale green to deep blue',
        },
        problematicImageIndices: [1],
        suggestion: 'lock hairstyle and robe palette',
      }),
    }
  );

  assert.equal(result.reports.length, 1);
  assert.deepEqual(result.reports[0].identityDriftTags, ['hair_drift', 'palette_drift']);
  assert.deepEqual(result.reports[0].anchorSummary, {
    hair: 'bangs became curls',
    palette: 'robe changed from pale green to deep blue',
  });
  assert.deepEqual(result.needsRegeneration, [
    {
      shotId: 'shot_002',
      reason: '沈清 一致性评分 5/10',
      suggestion: 'lock hairstyle and robe palette',
    },
  ]);
});
