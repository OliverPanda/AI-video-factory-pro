import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyArtifactReadiness,
  linkSymptomToUpstreamRootCause,
} from '../src/utils/rootCauseClassifier.js';

test('classifyArtifactReadiness detects timeout and missing asset with configurable labels', () => {
  const timeoutResult = classifyArtifactReadiness(
    {
      imagePath: null,
      success: false,
      error: '图像生成超时：shot_1 在 30s 内未完成',
    },
    {
      assetPathField: 'imagePath',
      successField: 'success',
      readyCode: 'ready',
      readyLabel: '关键帧已就绪',
      timeoutCode: 'image_generation_timeout',
      timeoutLabel: '图像生成超时',
      failureCode: 'image_generation_failed',
      failureLabel: '图像生成失败',
      missingCode: 'image_result_missing',
      missingLabel: '关键帧结果缺失',
      missingReasonCode: 'missing_keyframe_image',
      timeoutReasonCode: 'image_generation_timeout',
      failureReasonCode: 'image_generation_failed',
    }
  );

  const missingResult = classifyArtifactReadiness(
    {
      imagePath: null,
      success: null,
    },
    {
      assetPathField: 'imagePath',
      successField: 'success',
      readyCode: 'ready',
      readyLabel: '关键帧已就绪',
      timeoutCode: 'image_generation_timeout',
      timeoutLabel: '图像生成超时',
      failureCode: 'image_generation_failed',
      failureLabel: '图像生成失败',
      missingCode: 'image_result_missing',
      missingLabel: '关键帧结果缺失',
      missingReasonCode: 'missing_keyframe_image',
      timeoutReasonCode: 'image_generation_timeout',
      failureReasonCode: 'image_generation_failed',
    }
  );

  assert.equal(timeoutResult.rootCauseCode, 'image_generation_timeout');
  assert.deepEqual(timeoutResult.reasons, ['missing_keyframe_image', 'image_generation_timeout']);
  assert.equal(missingResult.rootCauseCode, 'image_result_missing');
  assert.deepEqual(missingResult.reasons, ['missing_keyframe_image', 'image_result_missing']);
});

test('linkSymptomToUpstreamRootCause correlates downstream symptom with upstream entry by shot', () => {
  const linked = linkSymptomToUpstreamRootCause({
    upstreamEntries: [
      {
        shotId: 'shot_1',
        rootCauseCode: 'image_generation_timeout',
        rootCauseLabel: '图像生成超时',
      },
    ],
    downstreamEntries: [
      {
        shotId: 'shot_1',
        decision: 'block',
        reasons: ['missing_reference_stack'],
      },
      {
        shotId: 'shot_2',
        decision: 'block',
        reasons: ['missing_reference_stack'],
      },
    ],
    symptomCode: 'missing_reference_stack',
    shouldIncludeDownstreamEntry: (entry) => entry?.decision === 'block',
    buildLink: (downstreamEntry, upstreamEntry) => ({
      shotId: downstreamEntry.shotId,
      symptomCode: 'missing_reference_stack',
      rootCauseCode: upstreamEntry.rootCauseCode,
      rootCauseLabel: upstreamEntry.rootCauseLabel,
    }),
    learnedPattern: '优先排查上游关键帧失败',
  });

  assert.equal(linked.matchedCount, 1);
  assert.deepEqual(linked.matchedShotIds, ['shot_1']);
  assert.equal(linked.entries[0].rootCauseCode, 'image_generation_timeout');
  assert.equal(linked.learnedPattern, '优先排查上游关键帧失败');
});
