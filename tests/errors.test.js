import test from 'node:test';
import assert from 'node:assert/strict';

import { friendlyError, formatRunError } from '../src/utils/errors.js';

// ── friendlyError ──────────────────────────────────────────────

test('friendlyError detects HTTP 401 as auth error', () => {
  const result = friendlyError('Request failed with status code 401');
  assert.equal(result.category, 'auth');
  assert.ok(result.friendly.includes('密钥') || result.friendly.includes('无效'));
  assert.ok(result.hint.length > 0);
});

test('friendlyError detects HTTP 403 as auth error', () => {
  const result = friendlyError('status code 403 Forbidden');
  assert.equal(result.category, 'auth');
  assert.ok(result.friendly.includes('拒绝'));
});

test('friendlyError detects HTTP 404 as config error', () => {
  const result = friendlyError('status code 404 Not Found');
  assert.equal(result.category, 'config');
  assert.ok(result.friendly.includes('接口') || result.friendly.includes('不存在'));
});

test('friendlyError detects HTTP 429 as rate_limit', () => {
  const result = friendlyError('status code 429 Too Many Requests');
  assert.equal(result.category, 'rate_limit');
  assert.ok(result.friendly.includes('频繁'));
});

test('friendlyError detects HTTP 500 as server error', () => {
  const result = friendlyError('status code 500 Internal Server Error');
  assert.equal(result.category, 'server');
  assert.ok(result.friendly.includes('不可用') || result.friendly.includes('500'));
});

test('friendlyError detects ECONNREFUSED as network error', () => {
  const result = friendlyError('connect ECONNREFUSED 127.0.0.1:8080');
  assert.equal(result.category, 'network');
  assert.ok(result.friendly.includes('无法连接'));
});

test('friendlyError detects ETIMEDOUT as network error', () => {
  const result = friendlyError('ETIMEDOUT: connection timeout');
  assert.equal(result.category, 'network');
  assert.ok(result.friendly.includes('超时'));
});

test('friendlyError detects ENOTFOUND as network error', () => {
  const result = friendlyError('getaddrinfo ENOTFOUND api.example.com');
  assert.equal(result.category, 'network');
  assert.ok(result.friendly.includes('域名') || result.friendly.includes('无法解析'));
});

test('friendlyError detects quota/balance as billing error', () => {
  const result = friendlyError('insufficient quota, balance is 0');
  assert.equal(result.category, 'billing');
  assert.ok(result.friendly.includes('额度') || result.friendly.includes('不足'));
});

test('friendlyError detects model not found as config error', () => {
  const result = friendlyError('model not found: gpt-999');
  assert.equal(result.category, 'config');
  assert.ok(result.friendly.includes('模型'));
});

test('friendlyError detects TypeError as bug', () => {
  const result = friendlyError("TypeError: Cannot read properties of undefined (reading 'id')");
  assert.equal(result.category, 'bug');
});

test('friendlyError detects Episode not found as data error', () => {
  const result = friendlyError('Episode not found: episode-123');
  assert.equal(result.category, 'data');
  assert.ok(result.friendly.includes('找不到'));
});

test('friendlyError handles generic short message as-is', () => {
  const result = friendlyError('Something went wrong');
  assert.equal(result.category, 'unknown');
  assert.equal(result.friendly, 'Something went wrong');
});

test('friendlyError truncates long unknown messages', () => {
  const long = 'A'.repeat(200);
  const result = friendlyError(long);
  assert.equal(result.category, 'unknown');
  assert.equal(result.friendly, '运行过程中出现错误');
});

// ── formatRunError ────────────────────────────────────────────

test('formatRunError combines friendly, hint, and raw message', () => {
  const formatted = formatRunError('status code 401 Unauthorized');
  assert.ok(formatted.includes('技术详情'));
  assert.ok(formatted.includes('💡'));
  assert.ok(formatted.includes('status code 401'));
});

test('formatRunError output is single unified string', () => {
  const formatted = formatRunError('connect ECONNREFUSED');
  assert.equal(typeof formatted, 'string');
  assert.ok(formatted.length > 0);
});
