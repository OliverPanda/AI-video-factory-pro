import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables, runPreflightQa } from '../src/agents/preflightQaAgent.js';

test('evaluateShotPackage blocks generation when critical cinematic anchors are missing', () => {
  const result = __testables.evaluateShotPackage({
    shotId: 'shot_block',
    preferredProvider: 'seedance',
    qualityIssues: ['missing_scene_pack', 'missing_reference_stack', 'entry_state_missing', 'exit_state_missing'],
    generationPack: { reference_stack: [] },
    seedancePromptBlocks: [],
    providerRequestHints: {},
  });

  assert.equal(result.decision, 'block');
  assert.equal(result.reviewedPackage.preferredProvider, 'static_image');
  assert.equal(result.reviewedPackage.providerRequestHints.preflightBlocked, true);
  assert.equal(result.reasonDetails[0].label, '场景目标缺失');
  assert.match(result.reasonDetails[0].suggestion, /戏剧动作/);
});

test('evaluateShotPackage rewrites warn packages instead of sending weak prompts through untouched', () => {
  const result = __testables.evaluateShotPackage({
    shotId: 'shot_warn',
    preferredProvider: 'seedance',
    qualityIssues: ['coverage_role_missing', 'blocking_missing', 'continuity_locks_missing'],
    generationPack: { reference_stack: [{ path: '/tmp/ref.png' }] },
    seedancePromptBlocks: [{ key: 'cinematic_intent', text: 'Keep it restrained.' }],
    providerRequestHints: {},
  });

  assert.equal(result.decision, 'warn');
  assert.equal(result.reviewedPackage.seedancePromptBlocks.some((block) => block.key === 'preflight_rewrite'), true);
  assert.equal(result.reviewedPackage.seedancePromptBlocks.some((block) => block.key === 'repair_brief'), true);
  assert.equal(result.reviewedPackage.seedancePromptBlocks.some((block) => block.key === 'repair_directives'), true);
  assert.equal(result.reviewedPackage.providerRequestHints.preflightRewriteApplied, true);
  assert.deepEqual(result.reviewedPackage.providerRequestHints.preflightOwnerAgents, ['directorPackAgent', 'seedancePromptAgent']);
  assert.equal(result.reviewedPackage.generationPack.camera_plan.coverage_role, 'anchor_readable_coverage');
  assert.equal(result.reviewedPackage.generationPack.quality_target, 'narrative_clarity');
});

test('runPreflightQa writes report and reviewed packages artifacts', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-preflight-qa-'));

  try {
    const artifactContext = {
      outputsDir: path.join(tempDir, '1-outputs'),
      metricsDir: path.join(tempDir, '2-metrics'),
      manifestPath: path.join(tempDir, 'manifest.json'),
    };

    const result = await runPreflightQa(
      [
        {
          shotId: 'shot_pass',
          preferredProvider: 'seedance',
          qualityIssues: [],
          generationPack: { reference_stack: [{ path: '/tmp/ref.png' }] },
          seedancePromptBlocks: [
            { key: 'cinematic_intent', text: 'Keep the confrontation grounded.' },
            { key: 'entry_exit', text: 'entry: gun raised; exit: opponent pinned' },
            { key: 'blocking', text: 'A foreground, B midground' },
            { key: 'continuity_locks', text: 'preserve geography and facing' },
            { key: 'camera_plan', text: 'coverage: anchor_master, move: slow_dolly' },
          ],
          providerRequestHints: {},
        },
        {
          shotId: 'shot_block',
          preferredProvider: 'seedance',
          qualityIssues: ['missing_scene_pack', 'missing_reference_stack', 'entry_state_missing', 'exit_state_missing'],
          generationPack: { reference_stack: [] },
          seedancePromptBlocks: [],
          providerRequestHints: {},
        },
      ],
      { artifactContext }
    );

    assert.equal(result.report.blockCount, 1);
    assert.equal(result.report.entries[1].reasonDetails[0].label, '场景目标缺失');
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'preflight-reviewed-packages.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'preflight-fix-brief.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'preflight-fix-brief.md')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'preflight-report.json')), true);

    const fixBrief = JSON.parse(fs.readFileSync(path.join(artifactContext.outputsDir, 'preflight-fix-brief.json'), 'utf-8'));
    assert.equal(fixBrief.entries.length, 1);
    assert.equal(fixBrief.entries[0].shotId, 'shot_block');
    assert.deepEqual(fixBrief.entries[0].ownerAgents, ['sceneGrammarAgent', 'seedancePromptAgent', 'directorPackAgent']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
