import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEpisodeDirName, buildProjectDirName } from '../src/utils/naming.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { __testables as directorTestables } from '../src/agents/director.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-run-artifacts-'));

  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
}

test('buildProjectDirName combines readable title with stable id', () => {
  assert.equal(buildProjectDirName('咖啡馆相遇', 'project_123'), '咖啡馆相遇__project_123');
});

test('buildEpisodeDirName normalizes episode numbers into 第01集 format', () => {
  assert.equal(buildEpisodeDirName({ episodeNo: 1, id: 'episode_001' }), '第01集__episode_001');
});

test('createRunArtifactContext creates root manifest-friendly folder structure', async () => {
  await withTempRoot(async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_123',
      projectName: '咖啡馆相遇',
      scriptId: 'script_001',
      scriptTitle: '第一卷',
      episodeId: 'episode_001',
      episodeTitle: '试播集',
      episodeNo: 1,
      runJobId: 'run_abc',
      startedAt: '2026-04-01T09:00:00.000Z',
    });

    assert.equal(fs.existsSync(path.join(ctx.runDir, 'manifest.json')), false);
    assert.equal(
      ctx.agents.scriptParser.dir.endsWith(path.join('01-script-parser')),
      true
    );
    assert.equal(fs.existsSync(ctx.runDir), true);
    assert.equal(fs.existsSync(ctx.agents.scriptParser.dir), true);
    assert.deepEqual(Object.keys(ctx.agents), [
      'scriptParser',
      'characterRegistry',
      'promptEngineer',
      'imageGenerator',
      'consistencyChecker',
      'continuityChecker',
      'ttsAgent',
      'ttsQaAgent',
      'lipsyncAgent',
      'motionPlanner',
      'performancePlanner',
      'videoRouter',
      'runwayVideoAgent',
      'motionEnhancer',
      'shotQaAgent',
      'bridgeShotPlanner',
      'bridgeShotRouter',
      'bridgeClipGenerator',
      'bridgeQaAgent',
      'actionSequencePlanner',
      'actionSequenceRouter',
      'sequenceClipGenerator',
      'sequenceQaAgent',
      'videoComposer',
    ]);

    const expectedBridgeDirs = {
      bridgeShotPlanner: '09g-bridge-shot-planner',
      bridgeShotRouter: '09h-bridge-shot-router',
      bridgeClipGenerator: '09i-bridge-clip-generator',
      bridgeQaAgent: '09j-bridge-qa',
      actionSequencePlanner: '09k-action-sequence-planner',
      actionSequenceRouter: '09l-action-sequence-router',
      sequenceClipGenerator: '09m-sequence-clip-generator',
      sequenceQaAgent: '09n-sequence-qa',
    };
    for (const [agentKey, dirName] of Object.entries(expectedBridgeDirs)) {
      const agentContext = ctx.agents[agentKey];
      assert.ok(agentContext, `${agentKey} context missing`);
      assert.equal(agentContext.dir.endsWith(path.join(dirName)), true);
    }
    assert.equal(
      ctx.qaOverviewJsonPath,
      path.join(ctx.runDir, 'qa-overview.json')
    );
    assert.equal(
      ctx.qaOverviewMarkdownPath,
      path.join(ctx.runDir, 'qa-overview.md')
    );
    assert.equal(
      ctx.projectDir,
      path.join(tempRoot, 'projects', '咖啡馆相遇__project_123')
    );
    assert.equal(
      ctx.episodeDir,
      path.join(
        tempRoot,
        'projects',
        '咖啡馆相遇__project_123',
        'scripts',
        '第一卷__script_001',
        'episodes',
        '第01集__episode_001'
      )
    );
    assert.equal(
      ctx.runDir,
      path.join(
        tempRoot,
        'projects',
        '咖啡馆相遇__project_123',
        'scripts',
        '第一卷__script_001',
        'episodes',
        '第01集__episode_001',
        'runs',
        '2026-04-01_090000__run_abc'
      )
    );
    assert.deepEqual(ctx.agents.scriptParser, {
      dir: path.join(ctx.runDir, '01-script-parser'),
      manifestPath: path.join(ctx.runDir, '01-script-parser', 'manifest.json'),
      inputsDir: path.join(ctx.runDir, '01-script-parser', '0-inputs'),
      outputsDir: path.join(ctx.runDir, '01-script-parser', '1-outputs'),
      metricsDir: path.join(ctx.runDir, '01-script-parser', '2-metrics'),
      errorsDir: path.join(ctx.runDir, '01-script-parser', '3-errors'),
    });
  });
});

test('collectRunQaOverview includes bridge and sequence agents in qa counts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-qa-overview-'));

  try {
    const agentNames = [
      'scriptParser',
      'bridgeShotPlanner',
      'bridgeShotRouter',
      'bridgeClipGenerator',
      'bridgeQaAgent',
      'actionSequencePlanner',
      'actionSequenceRouter',
      'sequenceClipGenerator',
      'sequenceQaAgent',
    ];
    const agents = Object.fromEntries(
      agentNames.map((agentKey) => {
        const dir = path.join(tempRoot, agentKey);
        return [
          agentKey,
          {
            dir,
            manifestPath: path.join(dir, 'manifest.json'),
            metricsDir: path.join(dir, '2-metrics'),
          },
        ];
      })
    );
    const manifestByPath = Object.fromEntries(
      Object.values(agents).map((ctx, index) => [
        ctx.manifestPath,
        {
          agentKey: agentNames[index],
          status: 'completed',
        },
      ])
    );

    const overview = directorTestables.collectRunQaOverview(
      (filePath) => manifestByPath[filePath] || null,
      { agents },
      { releasable: true }
    );

    assert.equal(overview.status, 'pass');
    assert.equal(overview.passCount, agentNames.length);
    assert.equal(
      overview.agentSummaries.some((entry) => entry.agentKey === 'bridgeShotPlanner'),
      true
    );
    assert.equal(
      overview.agentSummaries.some((entry) => entry.agentKey === 'sequenceQaAgent'),
      true
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
