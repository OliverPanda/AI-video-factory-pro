import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkCrossVideoConsistency, buildUnifiedClipIndex } from '../src/domain/crossVideoConsistency.js';
import { runCrossVideoConsistency } from '../src/agents/crossVideoConsistencyAgent.js';

function withTempRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aivf-cross-video-'));
  return Promise.resolve()
    .then(() => fn(tempRoot))
    .finally(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
}

function baseInput(overrides = {}) {
  return {
    projectKey: 'HappyHorse',
    videoMetadata: [
      {
        videoId: 'video-001',
        firstShotId: 'shot_001',
        lastShotId: 'shot_002',
        exitPose: 'happyhorse facing camera',
        characters: [{ id: 'happyhorse', appearanceSummary: 'golden horse hero' }],
        scenes: [{ id: 'stable', location: 'main stable', lighting: 'warm morning' }],
      },
      {
        videoId: 'video-002',
        firstShotId: 'shot_003',
        lastShotId: 'shot_004',
        entryPose: 'happyhorse facing camera',
        exitPose: 'happyhorse trotting right',
        characters: [{ id: 'happyhorse', appearanceSummary: 'golden horse hero' }],
        scenes: [{ id: 'stable', location: 'main stable', lighting: 'warm morning' }],
      },
    ],
    contextMemory: {
      characters: [{ id: 'happyhorse', appearanceSummary: 'golden horse hero' }],
      scenes: [{ id: 'stable', location: 'main stable', lighting: 'warm morning' }],
    },
    videoResults: [
      {
        shotId: 'shot_001',
        videoId: 'video-001',
        provider: 'happyhorse',
        status: 'completed',
        referenceIds: ['ref-hh-v1'],
      },
      {
        shotId: 'shot_002',
        videoId: 'video-001',
        provider: 'happyhorse',
        status: 'completed',
        referenceIds: ['ref-hh-v1'],
      },
      {
        shotId: 'shot_003',
        videoId: 'video-002',
        provider: 'happyhorse',
        status: 'completed',
        referenceIds: ['ref-hh-v1'],
      },
      {
        shotId: 'shot_004',
        videoId: 'video-002',
        provider: 'happyhorse',
        status: 'completed',
        referenceIds: ['ref-hh-v1'],
      },
    ],
    sequenceClipResults: [
      {
        sequenceId: 'seq-boundary',
        status: 'completed',
        provider: 'happyhorse',
        coveredShotIds: ['shot_002', 'shot_003'],
        coveredBoundaryIds: ['video-001->video-002'],
        referenceIds: ['ref-hh-v1'],
      },
    ],
    bridgeClipResults: [],
    lipsyncResults: [],
    crossVideoBoundaries: [
      {
        boundaryId: 'video-001->video-002',
        fromVideoId: 'video-001',
        toVideoId: 'video-002',
        fromShotId: 'shot_002',
        toShotId: 'shot_003',
        requiresBridge: true,
      },
    ],
    ...overrides,
  };
}

test('sequence coverage suppresses duplicate per-shot reference gaps', () => {
  const report = checkCrossVideoConsistency(
    baseInput({
      videoResults: [
        { shotId: 'shot_001', videoId: 'video-001', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_002', videoId: 'video-001' },
        { shotId: 'shot_003', videoId: 'video-002' },
        { shotId: 'shot_004', videoId: 'video-002', referenceIds: ['ref-hh-v1'] },
      ],
      sequenceClipResults: [
        {
          sequenceId: 'seq-boundary',
          status: 'completed',
          coveredShotIds: ['shot_002', 'shot_003'],
          coveredBoundaryIds: ['video-001->video-002'],
          referenceIds: ['ref-seq'],
        },
      ],
    })
  );

  assert.equal(report.entries.filter((entry) => entry.dimension === 'reference_gap').length, 0);
  assert.equal(report.summary.sequenceCoveredShotCount, 2);
});

test('missing projectKey does not write HappyHorse context memory by default', () => {
  const report = checkCrossVideoConsistency(baseInput({ projectKey: undefined }));

  assert.equal(report.projectKey, null);
  assert.equal(report.status, 'warn');
  assert.equal(report.contextMemoryPatch.writeAllowed, false);
  assert.equal(report.contextMemoryPatch.reason, 'non_happyhorse_project');
  assert.equal(
    report.entries.some((entry) => entry.dimension === 'insufficient_evidence' && entry.status === 'warn'),
    true
  );
});

test('non-HappyHorse projectKey blocks context memory writes', () => {
  const report = checkCrossVideoConsistency(baseInput({ projectKey: 'OtherProject' }));

  assert.equal(report.status, 'block');
  assert.equal(report.contextMemoryPatch.writeAllowed, false);
});

test('HappyHorse projectKey with seedance provider blocks context memory writes', () => {
  const report = checkCrossVideoConsistency(
    baseInput({
      videoProvider: 'seedance',
      videoResults: [
        { shotId: 'shot_001', videoId: 'video-001', provider: 'seedance', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_002', videoId: 'video-001', provider: 'seedance', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_003', videoId: 'video-002', provider: 'seedance', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_004', videoId: 'video-002', provider: 'seedance', referenceIds: ['ref-hh-v1'] },
      ],
    })
  );

  assert.equal(report.status, 'block');
  assert.equal(report.contextMemoryPatch.writeAllowed, false);
  assert.equal(report.contextMemoryPatch.reason, 'non_happyhorse_provider');
  assert.equal(
    report.entries.some((entry) => entry.message.includes('HappyHorse-provider-only')),
    true
  );
});

test('metadata-only seedance provider blocks HappyHorse context memory writes', () => {
  const report = checkCrossVideoConsistency(
    baseInput({
      videoProvider: undefined,
      videoResults: baseInput().videoResults.map(({ provider, ...result }) => result),
      sequenceClipResults: baseInput().sequenceClipResults.map(({ provider, ...result }) => result),
      videoMetadata: baseInput().videoMetadata.map((metadata) => ({ ...metadata, provider: 'seedance' })),
    })
  );

  assert.equal(report.status, 'block');
  assert.equal(report.contextMemoryPatch.writeAllowed, false);
  assert.equal(report.contextMemoryPatch.reason, 'non_happyhorse_provider');
});

test('bridge internal transition is indexed but not treated as a main timeline shot', () => {
  const input = baseInput({
    videoResults: [],
    sequenceClipResults: [],
    bridgeClipResults: [
      {
        bridgeId: 'bridge-internal',
        fromShotId: 'shot_002',
        toShotId: 'shot_003',
        boundaryId: 'video-001->video-002',
        transitionType: 'image_reference_transition',
        referenceIds: ['ref-bridge'],
      },
    ],
  });

  const index = buildUnifiedClipIndex(input);
  const report = checkCrossVideoConsistency(input);

  assert.equal(index.bridgeClips[0].isMainTimeline, false);
  assert.equal(report.entries.some((entry) => entry.dimension === 'reference_gap' && entry.clipId === 'bridge-internal'), false);
  assert.equal(report.entries.some((entry) => entry.dimension === 'bridge_coverage_gap'), false);
});

test('clip index includes lipsync clips with shot sequence and bridge associations', () => {
  const input = baseInput({
    bridgeClipResults: [
      {
        bridgeId: 'bridge-dialogue',
        fromShotId: 'shot_002',
        toShotId: 'shot_003',
        boundaryId: 'video-001->video-002',
        transitionType: 'image_reference_transition',
        referenceIds: ['ref-bridge'],
      },
    ],
    lipsyncResults: [
      {
        lipsyncId: 'lip-shot-002',
        shotId: 'shot_002',
        sequenceId: 'seq-boundary',
        bridgeId: 'bridge-dialogue',
        status: 'completed',
      },
    ],
  });

  const index = buildUnifiedClipIndex(input);
  const lipsyncClip = index.lipsyncClips[0];

  assert.equal(lipsyncClip.kind, 'lipsync');
  assert.equal(lipsyncClip.type, 'lipsync');
  assert.equal(lipsyncClip.shotId, 'shot_002');
  assert.equal(lipsyncClip.sequenceId, 'seq-boundary');
  assert.equal(lipsyncClip.bridgeId, 'bridge-dialogue');
  assert.equal(index.byKey.get('shot:shot_002').lipsync.status, 'completed');
});

test('missing reference evidence creates reference_gap', () => {
  const report = checkCrossVideoConsistency(
    baseInput({
      videoResults: [
        { shotId: 'shot_001', videoId: 'video-001', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_002', videoId: 'video-001', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_003', videoId: 'video-002', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_004', videoId: 'video-002' },
      ],
    })
  );

  const gaps = report.entries.filter((entry) => entry.dimension === 'reference_gap');
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].clipId, 'shot_004');
  assert.equal(gaps[0].recommendedAction, 'attach_reference_and_regenerate');
});

test('high-risk motion blocks blind bridge and recommends regenerate_sequence', () => {
  const report = checkCrossVideoConsistency(
    baseInput({
      sequenceClipResults: [
        {
          sequenceId: 'seq-high-risk',
          status: 'completed',
          coveredShotIds: ['shot_002', 'shot_003'],
          coveredBoundaryIds: ['video-001->video-002'],
          referenceIds: ['ref-seq'],
          motionRisk: 'high',
        },
      ],
    })
  );

  const highRisk = report.entries.find((entry) => entry.clipId === 'seq-high-risk');
  assert.equal(report.status, 'block');
  assert.equal(highRisk.dimension, 'pose_mismatch');
  assert.equal(highRisk.status, 'block');
  assert.equal(highRisk.recommendedAction, 'regenerate_sequence');
});

test('sequence-covered dialogue shot without lipsync or downgrade creates lipsync_risk', () => {
  const report = checkCrossVideoConsistency(
    baseInput({
      videoResults: [
        { shotId: 'shot_001', videoId: 'video-001', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_002', videoId: 'video-001', referenceIds: ['ref-hh-v1'], hasDialogue: true },
        { shotId: 'shot_003', videoId: 'video-002', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_004', videoId: 'video-002', referenceIds: ['ref-hh-v1'] },
      ],
      lipsyncResults: [],
    })
  );

  const lipsyncRisks = report.entries.filter((entry) => entry.dimension === 'lipsync_risk');
  assert.equal(lipsyncRisks.some((entry) => entry.clipId === 'shot_002'), true);
  assert.equal(lipsyncRisks.every((entry) => entry.recommendedAction === 'manual_review'), true);
});

test('sequence lipsync evidence covers dialogue shot in sequence coverage', () => {
  const report = checkCrossVideoConsistency(
    baseInput({
      videoResults: [
        { shotId: 'shot_001', videoId: 'video-001', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_002', videoId: 'video-001', referenceIds: ['ref-hh-v1'], hasDialogue: true },
        { shotId: 'shot_003', videoId: 'video-002', referenceIds: ['ref-hh-v1'] },
        { shotId: 'shot_004', videoId: 'video-002', referenceIds: ['ref-hh-v1'] },
      ],
      lipsyncResults: [{ lipsyncId: 'lip-seq-boundary', sequenceId: 'seq-boundary', status: 'completed' }],
    })
  );

  assert.equal(report.entries.some((entry) => entry.dimension === 'lipsync_risk' && entry.clipId === 'shot_002'), false);
});

test('bridge dialogue hint without lipsync or downgrade creates lipsync_risk', () => {
  const report = checkCrossVideoConsistency(
    baseInput({
      bridgeClipResults: [
        {
          bridgeId: 'bridge-speech',
          fromShotId: 'shot_002',
          toShotId: 'shot_003',
          boundaryId: 'video-001->video-002',
          transitionType: 'image_reference_transition',
          referenceIds: ['ref-bridge'],
          requirementHint: 'speech required for transition line',
        },
      ],
      lipsyncResults: [],
    })
  );

  const bridgeRisk = report.entries.find((entry) => entry.dimension === 'lipsync_risk' && entry.clipId === 'bridge-speech');
  assert.equal(Boolean(bridgeRisk), true);
  assert.equal(bridgeRisk.recommendedAction, 'manual_review');
});

test('runCrossVideoConsistency writes report markdown metrics manifest and qa summary artifacts', async () => {
  await withTempRoot(async (tempRoot) => {
    const artifactContext = {
      outputsDir: path.join(tempRoot, '1-outputs'),
      metricsDir: path.join(tempRoot, '2-metrics'),
      manifestPath: path.join(tempRoot, 'manifest.json'),
    };
    fs.mkdirSync(artifactContext.outputsDir, { recursive: true });
    fs.mkdirSync(artifactContext.metricsDir, { recursive: true });

    const report = await runCrossVideoConsistency(baseInput(), { artifactContext });

    assert.equal(report.status, 'pass');
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'cross-video-consistency-report.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'cross-video-consistency-report.md')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'cross-video-context-memory.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'flagged-cross-video-links.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'cross-video-consistency-metrics.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.metricsDir, 'qa-summary.json')), true);
    assert.equal(fs.existsSync(path.join(artifactContext.outputsDir, 'qa-summary.md')), true);
    assert.equal(fs.existsSync(artifactContext.manifestPath), true);

    const manifest = JSON.parse(fs.readFileSync(artifactContext.manifestPath, 'utf-8'));
    assert.equal(manifest.status, 'completed');
    assert.deepEqual(manifest.outputFiles, [
      'cross-video-consistency-report.json',
      'cross-video-consistency-report.md',
      'cross-video-context-memory.json',
      'flagged-cross-video-links.json',
      'cross-video-consistency-metrics.json',
    ]);

    const metrics = JSON.parse(
      fs.readFileSync(path.join(artifactContext.metricsDir, 'cross-video-consistency-metrics.json'), 'utf-8')
    );
    assert.equal(metrics.sequenceCoveredShotCount, 2);
    assert.equal(metrics.status, 'pass');
  });
});
