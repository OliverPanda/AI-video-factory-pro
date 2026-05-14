import test from 'node:test';
import assert from 'node:assert/strict';

import { runContinuityCheck } from '../src/agents/continuityChecker.js';

test('runContinuityCheck respects carry-over shot ids and flags low-score transitions', async () => {
  const shots = [
    {
      id: 'shot_001',
      scene: '御花园',
      continuityState: {
        cameraAxis: 'right_to_left',
        sceneLighting: 'golden dusk',
      },
    },
    {
      id: 'shot_002',
      scene: '御花园',
      continuityState: {
        carryOverFromShotId: 'shot_001',
        sceneLighting: 'golden dusk',
        cameraAxis: 'left_to_right',
        propStates: [{ name: 'letter', side: 'right-hand' }],
      },
    },
    {
      id: 'shot_003',
      scene: '回廊',
      continuityState: {
        carryOverFromShotId: 'shot_002',
        sceneLighting: 'golden dusk',
      },
    },
  ];

  const imageResults = [
    { shotId: 'shot_001', imagePath: '001.png', success: true },
    { shotId: 'shot_002', imagePath: '002.png', success: true },
    { shotId: 'shot_003', imagePath: '003.png', success: true },
  ];

  const transitions = [];
  const { reports, flaggedTransitions } = await runContinuityCheck(shots, imageResults, {
    threshold: 7,
    checkTransition: async (previousShot, currentShot) => {
      transitions.push([previousShot.id, currentShot.id]);
      if (currentShot.id === 'shot_002') {
        return {
          previousShotId: previousShot.id,
          shotId: currentShot.id,
          continuityScore: 6,
          violations: ['axis_flip'],
          repairHints: ['restore left_to_right camera axis'],
          checkedDimensions: { lighting: currentShot.continuityState.sceneLighting },
        };
      }

      return {
        previousShotId: previousShot.id,
        shotId: currentShot.id,
        continuityScore: 9,
        violations: [],
        repairHints: [],
        checkedDimensions: { lighting: currentShot.continuityState.sceneLighting },
      };
    },
  });

  assert.deepEqual(transitions, [
    ['shot_001', 'shot_002'],
    ['shot_002', 'shot_003'],
  ]);
  assert.equal(reports.length, 2);
  assert.deepEqual(reports[0].hardViolations.map((item) => item.code), ['camera_axis_flip']);
  assert.equal(reports[0].recommendedAction, 'regenerate_prompt_and_image');
  assert.deepEqual(reports[0].repairHints, ['restore left_to_right camera axis']);
  assert.deepEqual(flaggedTransitions, [
    {
      previousShotId: 'shot_001',
      shotId: 'shot_002',
      triggerSource: 'combined',
      hardViolationCodes: ['camera_axis_flip'],
      continuityScore: 6,
      violations: ['camera_axis_flip', 'axis_flip'],
      repairHints: ['restore left_to_right camera axis'],
      recommendedAction: 'regenerate_prompt_and_image',
      repairMethod: 'prompt_regen',
      continuityTargets: ['camera_axis_flip', 'axis_flip'],
    },
  ]);
});

test('runContinuityCheck flags prop state drift from wrist to neck', async () => {
  const shots = [
    {
      id: 'shot_006',
      scene: '游戏登录空间',
      action: '他手腕上缠着锁链的另一端。',
      continuityState: {
        propStates: [
          { name: 'binding_chain', holderEpisodeCharacterId: 'zero', side: 'wrist', state: 'attached' },
        ],
      },
    },
    {
      id: 'shot_007',
      scene: '游戏登录空间',
      action: '两人面对面，锁链错误地贴近脖子。',
      continuityState: {
        carryOverFromShotId: 'shot_006',
        propStates: [
          { name: 'binding_chain', holderEpisodeCharacterId: 'zero', side: 'neck', state: 'attached' },
        ],
      },
    },
  ];
  const imageResults = [
    { shotId: 'shot_006', imagePath: '006.png', success: true },
    { shotId: 'shot_007', imagePath: '007.png', success: true },
  ];

  const { reports } = await runContinuityCheck(shots, imageResults);

  assert.equal(reports.length, 1);
  assert.equal(reports[0].hardViolations.some((violation) => violation.code === 'prop_state_break'), true);
});

test('runContinuityCheck flags core prop forbidden body anchor drift', async () => {
  const shots = [
    {
      id: 'shot_006',
      scene: '游戏登录空间',
      action: '他手腕上缠着锁链的另一端。',
    },
    {
      id: 'shot_007',
      scene: '游戏登录空间',
      action: '两人面对面，锁链错误地贴近 neck。',
      continuityState: {
        carryOverFromShotId: 'shot_006',
      },
    },
  ];
  const imageResults = [
    { shotId: 'shot_006', imagePath: '006.png', success: true },
    { shotId: 'shot_007', imagePath: '007.png', success: true },
  ];

  const { reports } = await runContinuityCheck(shots, imageResults, {
    corePropRegistry: [
      {
        propId: 'binding_chain',
        displayName: '绑定锁链',
        aliases: ['锁链'],
        activeShotIds: ['shot_006', 'shot_007'],
        placementPolicy: {
          anchorType: 'wrist_endpoint_pair',
          forbiddenAnchors: ['neck', 'collar', 'throat'],
        },
      },
    ],
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].hardViolations.some((violation) => violation.code === 'prop_anchor_drift'), true);
});
