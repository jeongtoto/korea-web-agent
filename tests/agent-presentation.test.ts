import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { shapeAgentResearchJob } from '../src/agent/research.ts';
import type { ResearchJob } from '../src/core/types.ts';

function job(): ResearchJob {
  const target = {
    kind: 'product' as const,
    brand: '와이드뷰',
    name: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
    model: 'QWGE43UT1',
    variant: 'EKWBYME78W(V3) 43인치',
  };
  const canonicalIdentity = compileCanonicalIdentity(
    target,
    '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
  );
  return {
    id: 'agent-presentation-job',
    status: 'completed',
    request: {
      question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 현재 가격',
      category: 'product',
      includeLocalRelay: true,
      purchaseContext: { ownedCards: ['삼성 iD SELECT ALL'] },
    },
    createdAt: '2026-08-25T07:00:00.000Z',
    updatedAt: '2026-08-25T07:00:01.000Z',
    completedAt: '2026-08-25T07:00:01.000Z',
    target,
    researchContext: {
      identityConfidence: 0.97,
      resolvedTarget: target,
      canonicalIdentity,
      resolutionAmbiguous: false,
    },
    sourceResults: [],
    evidence: [],
    relay: { available: false, used: false, mode: 'public_only', message: 'PC relay is offline.' },
    report: {
      decision: 'INSUFFICIENT',
      confidence: 0.48,
      confidenceDimensions: {
        identity: 0.97,
        price: 0.3,
        officialSpecs: 0.5,
        reviews: 0.4,
        negativeSignals: 0.5,
        personalizedPrice: 0,
      },
      title: '와이드뷰 V3 패키지',
      summary: '검증된 decisive offer가 없습니다.',
      reasons: [],
      strengths: [],
      weaknesses: [],
      missingInformation: ['직접 상품 페이지의 최종 결제·배송 조건 확인 필요'],
      evidence: [],
      sourceCount: 0,
      offers: [],
      bestOffers: {},
      marketCoverage: [{ market: '네이버', attempted: true, found: 1, verified: 0, status: 'found_unverified' }],
      standardPriceRows: [],
      purchaseContextApplied: {
        ownedCards: ['삼성 iD SELECT ALL'],
        paymentMethods: [],
        memberships: [],
        preferences: [],
      },
      validationWarnings: [{
        code: 'UNKNOWN_SHIPPING_IN_WINNER',
        severity: 'blocker',
        message: 'Example validation warning',
      }],
    },
    errors: [],
  };
}

test('terminal Action result preserves existing fields and exposes validated presentation metadata', () => {
  const shaped = shapeAgentResearchJob(job()) as any;

  assert.equal(shaped.status, 'completed');
  assert.equal(shaped.jobId, 'agent-presentation-job');
  assert.ok(shaped.relay);
  assert.deepEqual(shaped.offers, []);
  assert.deepEqual(shaped.bestOffers, {});
  assert.deepEqual(shaped.standardPriceRows, []);
  assert.deepEqual(shaped.purchaseContextApplied, {
    ownedCards: ['삼성 iD SELECT ALL'],
    paymentMethods: [],
    memberships: [],
    preferences: [],
  });
  assert.equal(shaped.validationWarnings?.[0]?.code, 'UNKNOWN_SHIPPING_IN_WINNER');
  assert.match(shaped.presentation?.markdown ?? '', /INSUFFICIENT/);
  assert.match(shaped.presentation?.markdown ?? '', /QWGE43UT1/);
  assert.match(shaped.presentation?.markdown ?? '', /Relay|릴레이|PC/);
  assert.equal(shaped.canonicalIdentity?.primary?.model, 'QWGE43UT1');
  assert.ok(shaped.canonicalIdentity?.requiredComponents?.some((item: any) => item.model === 'EKWBYME78W'));
});

test('queued/running Action shape remains pollable without requiring presentation fields', () => {
  const value = job();
  value.status = 'running';
  value.report = undefined;
  const shaped = shapeAgentResearchJob(value) as any;

  assert.equal(shaped.status, 'running');
  assert.equal(shaped.jobId, value.id);
  assert.match(shaped.pollUrl, /jobId=/);
  assert.equal(shaped.presentation, undefined);
});
