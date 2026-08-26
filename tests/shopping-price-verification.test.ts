import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFinalistPrices } from '../src/shopping/price-verification-adapter.ts';
import type { CandidateAssessment } from '../src/shopping/ranking.ts';
import type { ShoppingCandidate } from '../src/shopping/types.ts';

function candidate(key: string): ShoppingCandidate {
  return {
    key,
    title: key,
    model: key.toUpperCase(),
    variant: {},
    bundle: [],
    condition: 'new',
    sourceUrls: [`https://shop.example/${key}`],
    discoveryScore: 0.8,
    facts: {},
    constraintState: 'ELIGIBLE',
  };
}

function assessment(key: string, score: number, verifiedCashPrice?: number): CandidateAssessment {
  return {
    candidate: candidate(key),
    dimensionScores: { fit: 1, value: 0.7 },
    recommendationScore: score,
    evidenceConfidence: 0.7,
    confidenceDimensions: {
      identity: 0.9,
      hardConstraints: 1,
      officialSpecs: 0.7,
      reviewConsensus: 0.7,
      negativeCoverage: 0.6,
      priceVerification: verifiedCashPrice ? 1 : 0,
      durability: 0.5,
      serviceWarranty: 0.7,
      personalization: 0,
    },
    strengths: [],
    tradeoffs: [],
    negativeSignals: [],
    evidenceUrls: [`https://evidence.example/${key}`],
    ...(verifiedCashPrice ? { verifiedCashPrice } : {}),
  };
}

test('targets five finalists but runs full market verification for only the Top 3 by default', async () => {
  const calls: Array<{ key: string; scope: string }> = [];
  const finalists = [
    assessment('a', 0.90, 390_000),
    assessment('b', 0.84, 410_000),
    assessment('c', 0.78, 430_000),
    assessment('d', 0.65, 450_000),
    assessment('e', 0.58, 470_000),
  ];

  const result = await verifyFinalistPrices(finalists, async (item, scope) => {
    calls.push({ key: item.candidate.key, scope });
    return { candidateKey: item.candidate.key, scope, offers: [], errors: [] };
  });

  assert.deepEqual(calls.filter((call) => call.scope === 'targeted').map((call) => call.key), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(calls.filter((call) => call.scope === 'full').map((call) => call.key), ['a', 'b', 'c']);
  assert.equal(result.length, 5);
});

test('escalates positions four and five when the score margin is within five percentage points', async () => {
  const full: string[] = [];
  const finalists = [
    assessment('a', 0.90, 390_000),
    assessment('b', 0.86, 400_000),
    assessment('c', 0.82, 410_000),
    assessment('d', 0.79, 420_000),
    assessment('e', 0.78, 430_000),
  ];

  await verifyFinalistPrices(finalists, async (item, scope) => {
    if (scope === 'full') full.push(item.candidate.key);
    return { candidateKey: item.candidate.key, scope, offers: [], errors: [] };
  });

  assert.deepEqual(full, ['a', 'b', 'c', 'd', 'e']);
});

test('isolates one finalist failure and keeps the remaining verification results', async () => {
  const finalists = [assessment('a', 0.9), assessment('b', 0.8), assessment('c', 0.7)];
  const result = await verifyFinalistPrices(finalists, async (item, scope) => {
    if (item.candidate.key === 'b' && scope === 'targeted') throw new Error('blocked');
    return { candidateKey: item.candidate.key, scope, offers: [], errors: [] };
  });

  assert.equal(result.length, 3);
  assert.ok(result.find((item) => item.candidateKey === 'b')?.errors.some((error) => error.includes('blocked')));
  assert.ok(result.find((item) => item.candidateKey === 'a'));
  assert.ok(result.find((item) => item.candidateKey === 'c'));
});
