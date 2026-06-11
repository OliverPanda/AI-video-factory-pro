/**
 * Prompt Engineering 单元测试
 * 覆盖 CAMERA_GRAMMAR、HAPPYHORSE_CAMERA_GRAMMAR 四维镜头语法
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAMERA_GRAMMAR, HAPPYHORSE_CAMERA_GRAMMAR, CAMERA_KEYWORDS } from '../src/llm/prompts/promptEngineering.js';

describe('CAMERA_KEYWORDS (向后兼容 5 种景别)', () => {
  it('包含 5 种基础景别', () => {
    const keys = Object.keys(CAMERA_KEYWORDS);
    assert.ok(keys.includes('特写'));
    assert.ok(keys.includes('近景'));
    assert.ok(keys.includes('中景'));
    assert.ok(keys.includes('全景'));
    assert.ok(keys.includes('远景'));
  });

  it('每种景别输出非空字符串', () => {
    for (const [key, value] of Object.entries(CAMERA_KEYWORDS)) {
      assert.equal(typeof value, 'string');
      assert.ok(value.length > 0, `${key} 应该输出非空字符串`);
    }
  });
});

describe('CAMERA_GRAMMAR', () => {
  it('shotSize 包含 8 个级别', () => {
    const expected = ['ecu', 'cu', 'mcu', 'ms', 'mls', 'fs', 'ws', 'ews'];
    for (const key of expected) {
      assert.ok(CAMERA_GRAMMAR.shotSize[key], `应包含 ${key}`);
      assert.equal(typeof CAMERA_GRAMMAR.shotSize[key], 'string');
      assert.ok(CAMERA_GRAMMAR.shotSize[key].length > 0);
    }
  });

  it('cameraHeight 包含 5 种机位', () => {
    const expected = ['low_angle', 'eye_level', 'high_angle', 'birds_eye', 'dutch'];
    for (const key of expected) {
      assert.ok(CAMERA_GRAMMAR.cameraHeight[key], `应包含 ${key}`);
    }
  });

  it('composition 包含 8 种构图规则', () => {
    const expected = [
      'rule_of_thirds', 'leading_lines', 'frame_within_frame',
      'symmetry', 'negative_space', 'over_shoulder', 'two_shot', 'group_shot',
    ];
    for (const key of expected) {
      assert.ok(CAMERA_GRAMMAR.composition[key], `应包含 ${key}`);
    }
  });

  it('movement 包含 11 种运动类型', () => {
    const expected = [
      'static_locked', 'slow_push', 'slow_pull', 'tracking',
      'handheld_float', 'whip_pan', 'crane_up', 'crane_down',
      'dolly_zoom', 'steadicam_follow', 'rack_focus',
    ];
    for (const key of expected) {
      assert.ok(CAMERA_GRAMMAR.movement[key], `应包含 ${key}`);
    }
  });

  it('combine 将四个维度合并为逗号分隔字符串', () => {
    const result = CAMERA_GRAMMAR.combine('ms', 'eye_level', 'rule_of_thirds', 'static_locked');
    assert.ok(result.includes('medium shot'));
    assert.ok(result.includes('eye-level'));
    assert.ok(result.includes('rule-of-thirds'));
    assert.ok(result.includes('locked-off'));
    // 不应包含 undefined/null
    assert.ok(!result.includes('undefined'));
    assert.ok(!result.includes('null'));
  });

  it('combine 对未知 key 使用原始值原样传递', () => {
    const result = CAMERA_GRAMMAR.combine('custom_shot', 'eye_level', null, undefined);
    assert.ok(result.includes('custom_shot'));
    assert.ok(result.includes('eye-level'));
  });

  it('combine 全参输出不为空', () => {
    const result = CAMERA_GRAMMAR.combine('cu', 'low_angle', 'symmetry', 'slow_push');
    assert.ok(result.length > 50, `expect >50 chars, got ${result.length}: ${result}`);
  });

  it('combine 无参返回空字符串', () => {
    assert.equal(CAMERA_GRAMMAR.combine(), '');
    assert.equal(CAMERA_GRAMMAR.combine(null, undefined, '', false), '');
  });
});

describe('HAPPYHORSE_CAMERA_GRAMMAR', () => {
  it('movement 覆盖与 CAMERA_GRAMMAR 相同的运动类型（happyhorse 子集）', () => {
    const keys = [
      'static_locked', 'slow_push', 'slow_pull', 'tracking',
      'handheld_float', 'whip_pan', 'crane_up', 'crane_down', 'steadicam_follow',
    ];
    for (const key of keys) {
      assert.ok(HAPPYHORSE_CAMERA_GRAMMAR.movement[key], `应包含 ${key}`);
    }
  });

  it('happyhorse 运动描述除 static_locked 外都包含 motion intensity 和 camera speed', () => {
    for (const [key, value] of Object.entries(HAPPYHORSE_CAMERA_GRAMMAR.movement)) {
      if (key === 'static_locked') {
        assert.ok(!value.includes('motion intensity'), 'static_locked 不应有 motion intensity（无运动）');
        assert.ok(!value.includes('camera speed'), 'static_locked 不应有 camera speed（无运动）');
        continue;
      }
      assert.ok(
        value.includes('motion intensity') && value.includes('camera speed'),
        `${key} 应同时包含 motion intensity 和 camera speed 控制标签`
      );
    }
  });

  it('happyhorse 运动描述不使用 "NOT X" 否定式', () => {
    for (const [key, value] of Object.entries(HAPPYHORSE_CAMERA_GRAMMAR.movement)) {
      assert.ok(!/\bNOT\b/.test(value), `${key} 不应使用 "NOT X" 否定式`);
    }
  });

  it('subjectMotion 包含 3 个级别', () => {
    const expected = ['subtle', 'moderate', 'dynamic'];
    for (const key of expected) {
      assert.ok(HAPPYHORSE_CAMERA_GRAMMAR.subjectMotion[key], `应包含 ${key}`);
      assert.equal(typeof HAPPYHORSE_CAMERA_GRAMMAR.subjectMotion[key], 'string');
    }
  });

  it('motionControl 合并运动与人物运动幅度', () => {
    const result = HAPPYHORSE_CAMERA_GRAMMAR.motionControl('slow_push', 'subtle');
    assert.ok(result.includes('motion intensity'));
    assert.ok(result.includes('micro-expressions') || result.includes('subtle'));
  });

  it('motionControl 对未知 key 使用原始值', () => {
    const result = HAPPYHORSE_CAMERA_GRAMMAR.motionControl('custom_motion', 'custom_subject');
    assert.ok(result.includes('custom_motion'));
    assert.ok(result.includes('custom_subject'));
  });

  it('motionControl 无参返回空字符串', () => {
    assert.equal(HAPPYHORSE_CAMERA_GRAMMAR.motionControl(), '');
  });
});
