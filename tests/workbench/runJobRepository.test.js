import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { listRunJobs } from '../../src/workbench/dataSources/runJobRepository.js';

test('listRunJobs loads run-jobs from fixture tree', () => {
  const fixtureRoot = path.resolve('tests/fixtures/workbench/minimal-run-jobs');
  const runJobs = listRunJobs({ tempProjectsDir: fixtureRoot });

  assert.equal(runJobs.length, 2);
  assert.equal(runJobs[0].id, 'run_fixture_recent');
  assert.equal(runJobs[1].id, 'run_fixture_old');
});
