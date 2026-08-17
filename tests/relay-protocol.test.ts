import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signRelayJob,
  verifyRelayJob,
  validateRelayRequest,
  sanitizeRelayResult,
  type UnsignedRelayJob,
} from '../src/relay/protocol.ts';

const secret = 'test-secret-at-least-32-bytes-long-123456';
const now = Date.parse('2026-08-17T00:00:00.000Z');

function validJob(overrides: Partial<UnsignedRelayJob> = {}): UnsignedRelayJob {
  return {
    id: 'job-1',
    url: 'https://brand.naver.com/mildo/products/7322162980',
    requestedFields: ['title', 'price', 'couponPrice', 'shippingEta'],
    issuedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    nonce: 'nonce-1234567890',
    ...overrides,
  };
}

test('relay job signature verifies only with the same canonical payload and secret', async () => {
  const unsigned = validJob();
  const signature = await signRelayJob(unsigned, secret);
  assert.equal(await verifyRelayJob({ ...unsigned, signature }, secret, now), true);
  assert.equal(await verifyRelayJob({ ...unsigned, url: 'https://www.coupang.com/vp/products/1', signature }, secret, now), false);
  assert.equal(await verifyRelayJob({ ...unsigned, signature }, `${secret}-wrong`, now), false);
});

test('relay request rejects expired, missing nonce, non-allowlisted domains and mutation fields', () => {
  assert.throws(() => validateRelayRequest(validJob({ expiresAt: new Date(now - 1).toISOString() }), now), /expired/i);
  assert.throws(() => validateRelayRequest(validJob({ nonce: '' }), now), /nonce/i);
  assert.throws(() => validateRelayRequest(validJob({ url: 'https://example.com/product' }), now), /domain/i);
  assert.throws(() => validateRelayRequest(validJob({ requestedFields: ['price', 'purchase'] as never[] }), now), /read-only|field/i);
});

test('sanitizeRelayResult rejects secret-bearing keys at any nesting level', () => {
  assert.throws(() => sanitizeRelayResult({ price: 100, nested: { cookie: 'SID=secret' } }), /secret|cookie/i);
  assert.throws(() => sanitizeRelayResult({ token: 'abc' }), /secret|token/i);
  assert.throws(() => sanitizeRelayResult({ localStorage: { a: 1 } }), /secret|localstorage/i);
  assert.throws(() => sanitizeRelayResult({ session: 'abc' }), /secret|session/i);
});

test('sanitizeRelayResult keeps only JSON-safe normalized read-only values', () => {
  const output = sanitizeRelayResult({
    title: '침대',
    price: 439000,
    shippingEta: '2026-08-20',
    nested: { available: true, notes: null },
  });
  assert.deepEqual(output, {
    title: '침대',
    price: 439000,
    shippingEta: '2026-08-20',
    nested: { available: true, notes: null },
  });
});
