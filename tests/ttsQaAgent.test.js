import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { runTtsQa } from '../src/agents/ttsQaAgent.js';
import { createRunArtifactContext } from '../src/utils/runArtifacts.js';
import { withManagedTempRoot } from './helpers/testArtifacts.js';

test('tts QA returns pass when all dialogue shots have audio and stay within duration budget', async (t) => {
  await withManagedTempRoot(t, 'aivf-tts-qa', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '验收项目',
      scriptId: 'script_1',
      scriptTitle: '第一卷',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_tts_qa_pass',
      startedAt: '2026-04-03T12:00:00.000Z',
    });

    const result = await runTtsQa(
      [
        { id: 'shot_1', dialogue: '你来了。', duration: 3 },
        { id: 'shot_2', dialogue: '我一直在等你。', duration: 4 },
      ],
      [
        { shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', hasDialogue: true },
        { shotId: 'shot_2', audioPath: '/tmp/shot_2.mp3', hasDialogue: true },
      ],
      [
        { shotId: 'shot_1', hasDialogue: true, usedDefaultVoiceFallback: false, speakerName: '沈清' },
        { shotId: 'shot_2', hasDialogue: true, usedDefaultVoiceFallback: false, speakerName: '阿九' },
      ],
      {
        artifactContext: ctx.agents.ttsQaAgent,
        getAudioDurationMs: async (audioPath) => {
          if (audioPath.endsWith('shot_1.mp3')) return 3000;
          return 4100;
        },
      }
    );

    assert.equal(result.status, 'pass');
    assert.equal(result.blockers.length, 0);
    assert.equal(result.warnings.length, 0);
    assert.deepEqual(result.manualReviewPlan.categories.protagonistShots, ['shot_1']);
    assert.deepEqual(result.manualReviewPlan.categories.closeUpLipsyncShots, []);
    assert.equal(fs.existsSync(path.join(ctx.agents.ttsQaAgent.metricsDir, 'tts-qa.json')), true);
    assert.equal(fs.existsSync(path.join(ctx.agents.ttsQaAgent.metricsDir, 'asr-report.json')), true);
    assert.equal(fs.existsSync(path.join(ctx.agents.ttsQaAgent.outputsDir, 'voice-cast-report.md')), true);
    assert.equal(fs.existsSync(path.join(ctx.agents.ttsQaAgent.outputsDir, 'manual-review-sample.md')), true);
  }, 'tts-qa');
});

test('tts QA returns warn when fallback voices are used but delivery is still complete', async (t) => {
  await withManagedTempRoot(t, 'aivf-tts-qa', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '验收项目',
      scriptId: 'script_1',
      scriptTitle: '第一卷',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_tts_qa_warn',
      startedAt: '2026-04-03T12:00:00.000Z',
    });

    const result = await runTtsQa(
      [{ id: 'shot_1', dialogue: '你来了。', duration: 3 }],
      [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', hasDialogue: true }],
      [{ shotId: 'shot_1', hasDialogue: true, usedDefaultVoiceFallback: true, speakerName: '沈清' }],
      {
        artifactContext: ctx.agents.ttsQaAgent,
        getAudioDurationMs: async () => 3000,
      }
    );

    assert.equal(result.status, 'warn');
    assert.equal(result.blockers.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /fallback/i);
  }, 'tts-qa');
});

test('tts QA returns block when a dialogue shot is missing audio', async (t) => {
  await withManagedTempRoot(t, 'aivf-tts-qa', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '验收项目',
      scriptId: 'script_1',
      scriptTitle: '第一卷',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_tts_qa_block',
      startedAt: '2026-04-03T12:00:00.000Z',
    });

    const result = await runTtsQa(
      [{ id: 'shot_1', dialogue: '你来了。', duration: 3 }],
      [{ shotId: 'shot_1', audioPath: null, hasDialogue: true }],
      [{ shotId: 'shot_1', hasDialogue: true, usedDefaultVoiceFallback: false, speakerName: '沈清' }],
      {
        artifactContext: ctx.agents.ttsQaAgent,
        getAudioDurationMs: async () => 0,
      }
    );

    assert.equal(result.status, 'block');
    assert.equal(result.blockers.length, 1);
    assert.match(result.blockers[0], /音频缺失/);
  }, 'tts-qa');
});

test('tts QA returns warn when the same speaker drifts across different voices', async (t) => {
  await withManagedTempRoot(t, 'aivf-tts-qa', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '验收项目',
      scriptId: 'script_1',
      scriptTitle: '第一卷',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_tts_qa_consistency_warn',
      startedAt: '2026-04-03T12:00:00.000Z',
    });

    const result = await runTtsQa(
      [
        { id: 'shot_1', dialogue: '第一句。', duration: 3 },
        { id: 'shot_2', dialogue: '第二句。', duration: 3 },
      ],
      [
        { shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', hasDialogue: true },
        { shotId: 'shot_2', audioPath: '/tmp/shot_2.mp3', hasDialogue: true },
      ],
      [
        {
          shotId: 'shot_1',
          hasDialogue: true,
          usedDefaultVoiceFallback: false,
          speakerName: '沈清',
          ttsOptions: { provider: 'xfyun', voice: 'voice_a' },
        },
        {
          shotId: 'shot_2',
          hasDialogue: true,
          usedDefaultVoiceFallback: false,
          speakerName: '沈清',
          ttsOptions: { provider: 'xfyun', voice: 'voice_b' },
        },
      ],
      {
        artifactContext: ctx.agents.ttsQaAgent,
        getAudioDurationMs: async () => 3000,
      }
    );

    assert.equal(result.status, 'warn');
    assert.match(result.warnings.join('\n'), /音色漂移|speaker consistency/i);
  }, 'tts-qa');
});

test('tts QA writes ASR report and warns when transcript drift exceeds threshold', async (t) => {
  await withManagedTempRoot(t, 'aivf-tts-qa', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '验收项目',
      scriptId: 'script_1',
      scriptTitle: '第一卷',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_tts_qa_asr_warn',
      startedAt: '2026-04-03T12:00:00.000Z',
    });

    const result = await runTtsQa(
      [{ id: 'shot_1', dialogue: '你终于来了。', duration: 3 }],
      [{ shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', hasDialogue: true }],
      [{ shotId: 'shot_1', hasDialogue: true, usedDefaultVoiceFallback: false, speakerName: '沈清' }],
      {
        artifactContext: ctx.agents.ttsQaAgent,
        getAudioDurationMs: async () => 3000,
        transcribeAudio: async () => '你总于来了',
      }
    );

    assert.equal(result.status, 'warn');
    assert.match(result.warnings.join('\n'), /ASR|转写/i);

    const asrReport = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.ttsQaAgent.metricsDir, 'asr-report.json'), 'utf-8')
    );
    assert.equal(asrReport.entries.length, 1);
    assert.equal(asrReport.entries[0].transcript, '你总于来了');
    assert.equal(asrReport.entries[0].status, 'warn');
  }, 'tts-qa');
});

test('tts QA writes manual review sampling plan into report artifacts', async (t) => {
  await withManagedTempRoot(t, 'aivf-tts-qa', async (tempRoot) => {
    const ctx = createRunArtifactContext({
      baseTempDir: tempRoot,
      projectId: 'project_1',
      projectName: '验收项目',
      scriptId: 'script_1',
      scriptTitle: '第一卷',
      episodeId: 'episode_1',
      episodeTitle: '第一集',
      episodeNo: 1,
      runJobId: 'run_tts_qa_manual_review',
      startedAt: '2026-04-03T12:00:00.000Z',
    });

    const result = await runTtsQa(
      [
        { id: 'shot_1', dialogue: '你来了。', speaker: '沈清', camera_type: '特写', emotion: '震惊', duration: 3 },
        { id: 'shot_2', dialogue: '我知道。', speaker: '沈清', duration: 3 },
        { id: 'shot_3', dialogue: '快走。', speaker: '阿九', emotion: '紧张', duration: 3 },
      ],
      [
        { shotId: 'shot_1', audioPath: '/tmp/shot_1.mp3', hasDialogue: true },
        { shotId: 'shot_2', audioPath: '/tmp/shot_2.mp3', hasDialogue: true },
        { shotId: 'shot_3', audioPath: '/tmp/shot_3.mp3', hasDialogue: true },
      ],
      [
        { shotId: 'shot_1', hasDialogue: true, usedDefaultVoiceFallback: false, speakerName: '沈清' },
        { shotId: 'shot_2', hasDialogue: true, usedDefaultVoiceFallback: false, speakerName: '沈清' },
        { shotId: 'shot_3', hasDialogue: true, usedDefaultVoiceFallback: false, speakerName: '阿九' },
      ],
      {
        artifactContext: ctx.agents.ttsQaAgent,
        getAudioDurationMs: async () => 3000,
      }
    );

    assert.deepEqual(result.manualReviewPlan.categories.protagonistShots, ['shot_1', 'shot_2']);
    assert.deepEqual(result.manualReviewPlan.categories.supportingShots, ['shot_3']);
    assert.deepEqual(result.manualReviewPlan.categories.highEmotionShots, ['shot_1', 'shot_3']);
    assert.deepEqual(result.manualReviewPlan.categories.closeUpLipsyncShots, ['shot_1']);

    const qaJson = JSON.parse(
      fs.readFileSync(path.join(ctx.agents.ttsQaAgent.metricsDir, 'tts-qa.json'), 'utf-8')
    );
    assert.deepEqual(qaJson.manualReviewPlan.categories.closeUpLipsyncShots, ['shot_1']);

    const sampleReport = fs.readFileSync(
      path.join(ctx.agents.ttsQaAgent.outputsDir, 'manual-review-sample.md'),
      'utf-8'
    );
    assert.match(sampleReport, /主角抽查：shot_1, shot_2/);
    assert.match(sampleReport, /Close-up \/ 强检镜头：shot_1/);
  }, 'tts-qa');
});
