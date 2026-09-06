import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables } from '../src/agents/director.js';

// P2a：legacy stopAt 协议收敛单测。
// 背景：run.js / workbench 传来的 --stop-at 字符串此前在 legacy 默认轨被静默忽略，
// normalizeStopAt 统一三档字符串协议（与实验轨 Director.js 对齐），并兼容旧布尔开关。

const { normalizeStopAt } = __testables;

test('normalizeStopAt 解析三档字符串协议', () => {
  assert.deepEqual(normalizeStopAt({ stopAt: 'after_ref_sheets' }), {
    stopAfterRefSheets: true,
    stopAfterImages: false,
    stopBeforeVideo: false,
  });
  assert.deepEqual(normalizeStopAt({ stopAt: 'after_images' }), {
    stopAfterRefSheets: false,
    stopAfterImages: true,
    stopBeforeVideo: false,
  });
  assert.deepEqual(normalizeStopAt({ stopAt: 'before_video' }), {
    stopAfterRefSheets: false,
    stopAfterImages: false,
    stopBeforeVideo: true,
  });
});

test('normalizeStopAt 兼容旧布尔开关', () => {
  assert.equal(normalizeStopAt({ stopAfterImages: true }).stopAfterImages, true);
  assert.equal(normalizeStopAt({ stopBeforeVideo: true }).stopBeforeVideo, true);
  assert.equal(normalizeStopAt({ stopAfterRefSheets: true }).stopAfterRefSheets, true);
});

test('normalizeStopAt 对 full/空值/未知值返回全 false', () => {
  const none = { stopAfterRefSheets: false, stopAfterImages: false, stopBeforeVideo: false };
  assert.deepEqual(normalizeStopAt({ stopAt: 'full' }), none);
  assert.deepEqual(normalizeStopAt({}), none);
  assert.deepEqual(normalizeStopAt({ stopAt: 'unknown_stop' }), none);
  assert.deepEqual(normalizeStopAt(), none);
});

test('normalizeStopAt 归一化大小写与空白', () => {
  assert.equal(normalizeStopAt({ stopAt: '  After_Ref_Sheets ' }).stopAfterRefSheets, true);
  assert.equal(normalizeStopAt({ stopAt: 'BEFORE_VIDEO' }).stopBeforeVideo, true);
});
