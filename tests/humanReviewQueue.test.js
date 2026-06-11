import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHumanReviewQueue } from '../src/utils/humanReviewQueue.js';

test('human review queue aggregates asset, consistency, and cost review items', () => {
  const queue = buildHumanReviewQueue({
    assetGovernanceReport: {
      reviewItems: [
        {
          id: 'asset_review_1',
          type: 'asset_governance',
          priority: 'high',
          characterName: '沈清',
          reason: '缺少 characterBibleId',
          suggestedAction: '补齐角色资产',
        },
      ],
    },
    consistencyResult: {
      reports: [
        {
          character: '沈清',
          overallScore: 6.2,
          regenStrategy: 'reanchor_regenerate',
          hardFailureReasons: ['identity_swap'],
          qaDecision: { status: 'block' },
        },
      ],
      needsRegeneration: [
        {
          shotId: 'shot_1',
          reason: '沈清身份漂移',
          regenStrategy: 'reanchor_regenerate',
        },
      ],
    },
    costReport: {
      warnings: ['计划视频请求数超过预算'],
      blockers: [],
    },
  });

  assert.equal(queue.status, 'block');
  assert.equal(queue.summary.openCount, 4);
  assert.equal(queue.summary.highPriorityCount, 3);
  assert.deepEqual(queue.items.map((item) => item.type), [
    'asset_governance',
    'quality_gate',
    'shot_regeneration',
    'cost_governance',
  ]);
});

test('human review queue passes when there are no open items', () => {
  const queue = buildHumanReviewQueue({});

  assert.equal(queue.status, 'pass');
  assert.equal(queue.summary.openCount, 0);
  assert.deepEqual(queue.items, []);
});

test('human review queue includes low-confidence pass items without blocking', () => {
  const queue = buildHumanReviewQueue({
    consistencyResult: {
      reports: [
        {
          character: '沈清',
          overallScore: 8.2,
          regenStrategy: 'none',
          qaDecision: {
            status: 'pass_with_review',
            threshold: 8.5,
          },
        },
      ],
      needsRegeneration: [],
    },
  });

  assert.equal(queue.status, 'warn');
  assert.equal(queue.summary.openCount, 1);
  assert.equal(queue.items[0].type, 'quality_gate');
  assert.match(queue.items[0].reason, /低置信放行/);
});
