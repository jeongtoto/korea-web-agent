import test from 'node:test';
import assert from 'node:assert/strict';
import { assessValue } from '../src/shopping/value-model.ts';

test('materially better verified product can beat a modestly cheaper mediocre product on value', () => {
  const cohort = [359_000, 399_000];
  const cheap = assessValue({
    merit: 0.62,
    evidenceConfidence: 0.8,
    priceStatus: 'verified',
    price: 359_000,
    cohortPrices: cohort,
  });
  const better = assessValue({
    merit: 0.88,
    evidenceConfidence: 0.85,
    priceStatus: 'verified',
    price: 399_000,
    cohortPrices: cohort,
  });

  assert.ok(better.qualityAdjustedValue > cheap.qualityAdjustedValue);
  assert.equal(cheap.bestValueEligible, true);
  assert.equal(better.bestValueEligible, true);
});

test('indicative price informs value with a confidence penalty but cannot claim best value', () => {
  const result = assessValue({
    merit: 0.8,
    evidenceConfidence: 0.75,
    priceStatus: 'indicative',
    price: 380_000,
    cohortPrices: [360_000, 380_000, 420_000],
  });

  assert.equal(result.priceStatus, 'indicative');
  assert.equal(result.priceConfidence, 0.45);
  assert.equal(result.bestValueEligible, false);
  assert.ok(result.qualityAdjustedValue > 0);
});

test('unknown price receives no positive price bonus and is never best-value eligible', () => {
  const unknown = assessValue({
    merit: 0.82,
    evidenceConfidence: 0.8,
    priceStatus: 'unknown',
    cohortPrices: [350_000, 400_000],
  });
  const expectedMerit = 0.82 * (0.75 + 0.25 * 0.8);

  assert.equal(unknown.priceConfidence, 0);
  assert.equal(unknown.bestValueEligible, false);
  assert.ok(Math.abs(unknown.qualityAdjustedValue - expectedMerit * 0.9) < 1e-9);
  assert.equal(unknown.priceBurden, 1);
});
