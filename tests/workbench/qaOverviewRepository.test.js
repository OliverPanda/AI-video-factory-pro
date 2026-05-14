import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeQaOverview } from '../../src/workbench/dataSources/qaOverviewRepository.js';

test('normalizeQaOverview removes empty agent summary rows', () => {
  const result = normalizeQaOverview({
    status: 'pass',
    agentSummaries: [
      { agentName: '', headline: '', summary: '' },
      { agentName: 'Shot QA Agent', headline: '通过', summary: 'ok', status: 'pass' },
    ],
  });

  assert.equal(result.agentSummaries.length, 1);
  assert.equal(result.agentSummaries[0].agentName, 'Shot QA Agent');
});

test('normalizeQaOverview recomputes counters when missing', () => {
  const result = normalizeQaOverview({
    agentSummaries: [
      { agentName: 'A', status: 'pass' },
      { agentName: 'B', status: 'warn' },
      { agentName: 'C', status: 'block' },
    ],
  });

  assert.equal(result.passCount, 1);
  assert.equal(result.warnCount, 1);
  assert.equal(result.blockCount, 1);
  assert.equal(result.status, 'block');
});
