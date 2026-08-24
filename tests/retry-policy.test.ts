import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, retryPolicyFor, withRetry } from '../src/core/retry-policy.ts';

test('classifies retryable and terminal shopping failures', () => {
  assert.equal(classifyFailure(new Error('ETIMEDOUT while fetching')), 'transient_network');
  assert.equal(classifyFailure(new Error('HTTP 503 Service Unavailable')), 'server_5xx');
  assert.equal(classifyFailure(new Error('HTTP 429 Too Many Requests')), 'rate_limit');
  assert.equal(classifyFailure(new Error('CAPTCHA required')), 'captcha');
  assert.equal(classifyFailure(new Error('401 login required')), 'auth_required');
  assert.equal(classifyFailure(new Error('SKU mismatch V2 vs V3')), 'sku_mismatch');
});

test('never retries CAPTCHA auth SKU mismatch or bad request', () => {
  for (const failure of ['captcha', 'auth_required', 'sku_mismatch', 'bad_request', 'policy_block'] as const) {
    assert.equal(retryPolicyFor(failure).maxAttempts, 1);
  }
});

test('bounds transient retries and eventually succeeds', async () => {
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('ETIMEDOUT');
    return 'ok';
  }, { sleep: async () => undefined });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});
