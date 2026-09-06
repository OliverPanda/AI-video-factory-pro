import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRunArtifactContext } from '../src/utils/runArtifacts.js';

test('run artifact context includes production loop governance agents', (t) => {
  const baseTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-run-artifacts-loop-'));
  t.after(() => {
    fs.rmSync(baseTempDir, { recursive: true, force: true });
  });

  const context = createRunArtifactContext({
    baseTempDir,
    projectId: 'project_1',
    projectName: '双生囚笼',
    scriptId: 'script_1',
    scriptTitle: '第一季',
    episodeId: 'episode_1',
    episodeTitle: '第一集',
    runJobId: 'run_1',
    startedAt: '2026-06-06T00:00:00.000Z',
  });

  assert.ok(context.agents.characterRefSheetGenerator.dir.endsWith('02b-character-ref-sheets'));
  assert.ok(context.agents.characterAssetGovernance.dir.endsWith('02c-character-asset-governance'));
  assert.ok(context.agents.costGovernance.dir.endsWith('11-cost-governance'));
  assert.ok(context.agents.humanReviewQueue.dir.endsWith('12-human-review-queue'));
});
