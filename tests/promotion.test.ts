import test from 'node:test';
import assert from 'node:assert/strict';
import { isCurrentPublicPromotion, normalizePromotion } from '../src/providers/promotion.ts';

const observedAt = '2026-08-26T00:00:00.000Z';

test('promotion normalization distinguishes active, future, expired and unknown validity', () => {
  assert.equal(normalizePromotion({ type: 'time_deal', startsAt: '2026-08-25T00:00:00.000Z', endsAt: '2026-08-27T00:00:00.000Z' }, observedAt).active, true);
  assert.equal(normalizePromotion({ type: 'time_deal', startsAt: '2026-08-27T00:00:00.000Z' }, observedAt).active, false);
  assert.equal(normalizePromotion({ type: 'time_deal', endsAt: '2026-08-25T23:59:59.000Z' }, observedAt).active, false);
  assert.equal(normalizePromotion({ type: 'time_deal' }, observedAt).active, 'unknown');
});

test('current public promotion excludes account-required and unknown validity', () => {
  assert.equal(isCurrentPublicPromotion(normalizePromotion({ type: 'time_deal', startsAt: '2026-08-25T00:00:00.000Z', endsAt: '2026-08-27T00:00:00.000Z' }, observedAt)), true);
  assert.equal(isCurrentPublicPromotion(normalizePromotion({ type: 'public_coupon', startsAt: '2026-08-25T00:00:00.000Z', endsAt: '2026-08-27T00:00:00.000Z', accountRequired: true }, observedAt)), false);
  assert.equal(isCurrentPublicPromotion(normalizePromotion({ type: 'public_coupon' }, observedAt)), false);
});

test('non-promotional offer is current without requiring timestamps', () => {
  const promotion = normalizePromotion({ type: 'none' }, observedAt);
  assert.equal(promotion.active, true);
  assert.equal(isCurrentPublicPromotion(promotion), true);
});
