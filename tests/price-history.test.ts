import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePriceHistory } from '../src/core/price-history.ts';

const now = new Date('2026-08-24T06:00:00.000Z');

test('refuses six-month-low claims when observed history is sparse', () => {
  const summary = summarizePriceHistory([
    { observedAt: '2026-08-20T00:00:00.000Z', amount: 420000, currency: 'KRW' },
  ], 400000, now);
  assert.equal(summary.position, 'insufficient_history');
  assert.equal(summary.coverage, 'observed_only');
  assert.equal(summary.currentPrice, 400000);
});

test('summarizes 180-day observations and compares with previous price', () => {
  const observations = [
    { observedAt: '2026-03-01T00:00:00.000Z', amount: 500000, currency: 'KRW' },
    { observedAt: '2026-04-01T00:00:00.000Z', amount: 470000, currency: 'KRW' },
    { observedAt: '2026-05-01T00:00:00.000Z', amount: 450000, currency: 'KRW' },
    { observedAt: '2026-06-01T00:00:00.000Z', amount: 430000, currency: 'KRW' },
    { observedAt: '2026-07-01T00:00:00.000Z', amount: 420000, currency: 'KRW' },
    { observedAt: '2026-08-10T00:00:00.000Z', amount: 410000, currency: 'KRW' },
  ];
  const summary = summarizePriceHistory(observations, 400000, now);
  assert.equal(summary.observationCount, 6);
  assert.equal(summary.previousPrice, 410000);
  assert.equal(summary.changeFromPrevious, -10000);
  assert.equal(summary.minimum, 400000);
  assert.equal(summary.maximum, 500000);
  assert.equal(summary.position, 'new_low');
  assert.ok((summary.mean ?? 0) > 400000);
  assert.ok((summary.median ?? 0) > 400000);
});
