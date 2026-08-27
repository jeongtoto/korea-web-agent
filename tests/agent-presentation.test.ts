import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { shapeAgentResearchJob } from '../src/agent/research.ts';
import type { MarketOffer, ResearchJob } from '../src/core/types.ts';

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

function verifiedOffer(overrides: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: 'danawa:seller:1',
    market: '판매자몰',
    title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
    url: 'https://seller.example.com/products/1',
    currency: 'KRW',
    retrievedAt: '2026-08-25T07:00:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 1,
    bundleComplete: true,
    eligible: true,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: 'page_verified',
    },
    salePrice: 399000,
    shippingFee: 0,
    shipping: { status: 'free', verification: 'page_verified' },
    totalCashPrice: 399000,
    availability: 'InStock',
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
    ...overrides,
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

test('presentation renders unconditional cash and current public conditional price separately', () => {
  const value = job();
  const cash = verifiedOffer();
  const conditional = verifiedOffer({
    id: 'danawa:seller:conditional',
    couponPrice: 379000,
    promotion: {
      type: 'public_coupon',
      active: true,
      accountRequired: false,
      condition: '누구나 다운로드 가능한 공개 쿠폰',
    },
  });
  value.report!.decision = 'BUY';
  value.report!.summary = '현금가와 공개 조건가를 분리해 확인했습니다.';
  value.report!.offers = [cash, conditional];
  value.report!.bestOffers = {
    cash: { basis: 'cash', rank: 1, amount: 399000, offer: cash, reasons: [] },
    publicConditional: {
      basis: 'public_conditional',
      rank: 1,
      amount: 379000,
      offer: conditional,
      reasons: ['공개 쿠폰 조건'],
    },
  };
  value.report!.marketCoverage = [{
    providerId: 'danawa',
    market: '다나와',
    attempted: true,
    found: 2,
    verified: 1,
    status: 'verified',
    comparisonPages: 2,
    expandedSellers: 4,
    exactOffers: 1,
    eligibleSellers: 1,
  }];

  const shaped = shapeAgentResearchJob(value) as any;
  const markdown = shaped.presentation?.markdown ?? '';
  assert.match(markdown, /현금 결제[^\n]*399,000원/);
  assert.match(markdown, /공개 조건가[^\n]*379,000원/);
  assert.match(markdown, /다나와/);
  assert.match(markdown, /판매자 확장\s*4|확장\s*4/);
  assert.doesNotMatch(markdown, /모든 시장|전체 시장|all markets/i);
  assert.equal(shaped.bestOffers?.publicConditional?.basis, 'public_conditional');
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

test('verification gap surfaces shipping_unknown with a concrete explanation', () => {
  const value = job();
  value.report!.offers = [verifiedOffer({
    eligible: false,
    shippingFee: undefined,
    shipping: { status: 'unknown', verification: 'unverified' },
    totalCashPrice: undefined,
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: 'unverified',
    },
    verificationTrace: {
      resolutionMethod: 'redirect_resolution',
      originalSellerUrl: 'https://search.danawa.com/bridge/1',
      resolvedSellerUrl: 'https://seller.example.com/products/1',
      identityVerdict: 'exact',
      bundleVerdict: 'complete',
      priceStatus: 'page_verified',
      shippingStatus: 'unknown',
      availabilityStatus: 'available',
      mandatoryFeeStatus: 'not_applicable',
      rejectionReasons: ['shipping:unknown'],
      retrievedAt: '2026-08-25T07:00:00.000Z',
    },
    exclusionReasons: ['shipping:unknown'],
  })];

  const shaped = shapeAgentResearchJob(value) as any;
  assert.equal(shaped.verificationGap, 'shipping_unknown');
  assert.ok(shaped.missingInformation.some((item: string) => /배송비/.test(item)));
});

test('verification gap surfaces seller_resolution_failed when comparison pages cannot resolve sellers', () => {
  const value = job();
  value.report!.offers = [];
  value.report!.marketCoverage = [{
    providerId: 'danawa',
    market: '다나와',
    attempted: true,
    found: 1,
    verified: 0,
    status: 'found_unverified',
    comparisonPages: 1,
    expandedSellers: 0,
    exactOffers: 0,
    eligibleSellers: 0,
    failureKind: 'parse_failed',
    message: 'raw fetch payload: <html>INTERNAL_SECRET_PAYLOAD</html>',
  }];

  const shaped = shapeAgentResearchJob(value) as any;
  assert.equal(shaped.verificationGap, 'seller_resolution_failed');
  assert.ok(shaped.missingInformation.some((item: string) => /판매자|판매처/.test(item)));
  assert.doesNotMatch(JSON.stringify(shaped), /INTERNAL_SECRET_PAYLOAD|raw fetch payload/i);
});

test('verification gap precedence prefers identity mismatch over fee and shipping uncertainty', () => {
  const value = job();
  value.report!.offers = [verifiedOffer({
    eligible: false,
    identityVerdict: 'different',
    mandatoryFeeStatus: 'unknown',
    shipping: { status: 'unknown', verification: 'unverified' },
    shippingFee: undefined,
    totalCashPrice: undefined,
    verificationTrace: {
      resolutionMethod: 'fallback_search',
      originalSellerUrl: 'https://seller.example.com/products/wrong',
      resolvedSellerUrl: 'https://seller.example.com/products/wrong',
      identityVerdict: 'different',
      bundleVerdict: 'unknown',
      priceStatus: 'page_verified',
      shippingStatus: 'unknown',
      availabilityStatus: 'unknown',
      mandatoryFeeStatus: 'unknown',
      rejectionReasons: ['identity:different', 'mandatory_fee:unknown', 'shipping:unknown'],
      retrievedAt: '2026-08-25T07:00:00.000Z',
    },
    exclusionReasons: ['identity:different', 'mandatory_fee:unknown', 'shipping:unknown'],
  })];

  const shaped = shapeAgentResearchJob(value) as any;
  assert.equal(shaped.verificationGap, 'seller_identity_mismatch');
});

test('verification gap surfaces mandatory_fee_unknown before shipping when identity is exact', () => {
  const value = job();
  value.report!.offers = [verifiedOffer({
    eligible: false,
    mandatoryFeeStatus: 'unknown',
    shipping: { status: 'unknown', verification: 'unverified' },
    shippingFee: undefined,
    totalCashPrice: undefined,
    verificationTrace: {
      resolutionMethod: 'embedded_metadata',
      originalSellerUrl: 'https://seller.example.com/products/1',
      resolvedSellerUrl: 'https://seller.example.com/products/1',
      identityVerdict: 'exact',
      bundleVerdict: 'complete',
      priceStatus: 'page_verified',
      shippingStatus: 'unknown',
      availabilityStatus: 'available',
      mandatoryFeeStatus: 'unknown',
      rejectionReasons: ['mandatory_fee:unknown', 'shipping:unknown'],
      retrievedAt: '2026-08-25T07:00:00.000Z',
    },
    exclusionReasons: ['mandatory_fee:unknown', 'shipping:unknown'],
  })];

  const shaped = shapeAgentResearchJob(value) as any;
  assert.equal(shaped.verificationGap, 'mandatory_fee_unknown');
});