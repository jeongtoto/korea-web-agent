import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, withRetry } from '../src/core/retry.ts';

test('classifies transient provider failures for bounded retry', () => {
  assert.equal(classifyFailure(new Error('ETIMEDOUT while fetching')), 'timeout');
  assert.equal(classifyFailure(new Error('429 Too Many Requests')), 'rate_limited');
  assert.equal(classifyFailure(new Error('ECONNRESET socket hang up')), 'network');
  assert.equal(classifyFailure(new Error('503 Service Unavailable')), 'server_error');
});

test('classifies authentication and captcha failures as user-action failures', () => {
  assert.equal(classifyFailure(new Error('401 Unauthorized')), 'authentication');
  assert.equal(classifyFailure(new Error('manual_verification_required captcha')), 'captcha');
});

test('retries timeout failures until the third attempt and returns attempt count', async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('ETIMEDOUT');
    return 'ok';
  }, { sleep: async (ms) => { sleeps.push(ms); } });

  assert.equal(result.value, 'ok');
  assert.equal(result.attempts, 3);
  assert.equal(attempts, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1]! >= sleeps[0]!);
});

test('does not retry authentication or captcha failures', async () => {
  for (const message of ['401 Unauthorized', 'captcha challenge']) {
    let attempts = 0;
    await assert.rejects(
      withRetry(async () => {
        attempts += 1;
        throw new Error(message);
      }, { sleep: async () => {} }),
    );
    assert.equal(attempts, 1);
  }
});
