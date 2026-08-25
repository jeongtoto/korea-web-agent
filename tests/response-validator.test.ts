import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProductReportValidation, validateProductReport } from '../src/core/response-validator.ts';
import type { MarketOffer, ProductReport, ResearchRequest } from '../src/core/types.ts';

function offer(overrides: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: 'naver:1',
    market: '네이버',
    title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
    url: 'https://brand.naver.com/widevu/products/11458011168',
    currency: 'KRW',
    retrievedAt: '2026-08-25T06:30:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 1,
    bundleComplete: true,
    eligible: true,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    salePrice: 389000,
    shippingFee: 0,
    totalCashPrice: 389000,
    availability: 'InStock',
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
    ...overrides,
  };
}

function report(): ProductReport {
  return {
    decision: 'BUY',
    confidence: 0.86,
    confidenceDimensions: {
      identity: 0.98,
      price: 0.9,
      officialSpecs: 0.7,
      reviews: 0.7,
      negativeSignals: 0.6,
      personalizedPrice: 0,
    },
    title: '와이드뷰 V3 패키지',
    summary: 'verified',
    reasons: [],
    strengths: [],
    weaknesses: [],
    missingInformation: [],
    evidence: [],
    sourceCount: 1,
  };
}

function request(overrides: Partial<ResearchRequest> = {}): ResearchRequest {
  return {
    question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 현재 가격',
    category: 'product',
    ...overrides,
  };
}

function codes(value: ReturnType<typeof validateProductReport>): string[] {
  return value.map((issue) => issue.code);
}

test('valid page-verified exact cash winner produces no blocker', () => {
  const winner = offer();
  const value = report();
  value.offers = [winner];
  value.bestOffers = {
    cash: { basis: 'cash', rank: 1, amount: 389000, offer: winner, reasons: [] },
  };
  assert.equal(validateProductReport(value, request()).some((issue) => issue.severity === 'blocker'), false);
});

test('search metadata cannot be presented as a decisive cash winner', () => {
  const winner = offer({ verification: 'search_metadata' });
  const value = report();
  value.bestOffers = {
    cash: { basis: 'cash', rank: 1, amount: 389000, offer: winner, reasons: [] },
  };
  assert.ok(codes(validateProductReport(value, request())).includes('SEARCH_METADATA_AS_DECISIVE'));
});

test('cash winner with unknown shipping is blocked', () => {
  const winner = offer({ shippingFee: undefined, totalCashPrice: 389000 });
  const value = report();
  value.bestOffers = {
    cash: { basis: 'cash', rank: 1, amount: 389000, offer: winner, reasons: [] },
  };
  assert.ok(codes(validateProductReport(value, request())).includes('UNKNOWN_SHIPPING_IN_WINNER'));
});

test('alternative-condition winner must be same-except-condition identity', () => {
  const alternate = offer({
    condition: 'refurbished',
    identityVerdict: 'exact',
    totalCashPrice: 329000,
  });
  const value = report();
  value.bestOffers = {
    alternativeCondition: { basis: 'alternative_condition', rank: 1, amount: 329000, offer: alternate, reasons: [] },
  };
  assert.ok(codes(validateProductReport(value, request())).includes('ALTERNATIVE_SKU_MISMATCH'));
});

test('owned-card winner must refer to a card present in request-scoped context', () => {
  const cardOffer = offer({ cardName: '삼성 iD SELECT ALL 카드', cardPrice: 369000 });
  const value = report();
  value.bestOffers = {
    ownedCard: { basis: 'owned_card', rank: 1, amount: 369000, offer: cardOffer, reasons: [] },
  };
  const issues = validateProductReport(value, request({ purchaseContext: { ownedCards: ['신한 ANNIVERSE'] } }));
  assert.ok(codes(issues).includes('UNOWNED_CARD_IN_OWNED_RANKING'));
});

test('purchaseContextApplied cannot invent or restore user-specific context absent from this request', () => {
  const value = report() as ProductReport & {
    purchaseContextApplied?: {
      ownedCards: string[];
      paymentMethods: string[];
      memberships: string[];
      budget?: number;
      region?: string;
      preferences: string[];
    };
  };
  value.purchaseContextApplied = {
    ownedCards: ['삼성 iD SELECT ALL'],
    paymentMethods: ['네이버페이'],
    memberships: ['네이버플러스'],
    preferences: [],
  };
  const issues = validateProductReport(value, request());
  assert.ok(codes(issues).includes('PURCHASE_CONTEXT_NOT_APPLIED'));
});

test('applying validation downgrades unsafe BUY while preserving preliminary offers and evidence', () => {
  const unsafe = offer({ verification: 'search_metadata', eligible: false });
  const value = report();
  value.evidence = [{
    claim: '검색 결과에 389,000원으로 표시됨',
    sourceUrl: unsafe.url,
    sourceType: 'naver_shopping',
    retrievedAt: unsafe.retrievedAt,
    acquisitionMethod: 'search_metadata',
    evidenceClass: 'retailer_listing',
    independenceKey: 'search:naver',
    confidence: 0.5,
  }];
  value.offers = [unsafe];
  value.bestOffers = {
    cash: { basis: 'cash', rank: 1, amount: 389000, offer: unsafe, reasons: [] },
  };

  const finalized = applyProductReportValidation(value, request());

  assert.equal(finalized.decision, 'INSUFFICIENT');
  assert.ok(finalized.confidence <= 0.49);
  assert.deepEqual(finalized.offers, [unsafe]);
  assert.equal(finalized.evidence.length, 1);
  assert.ok((finalized as any).validationWarnings?.some((item: any) => item.code === 'SEARCH_METADATA_AS_DECISIVE'));
  assert.ok(finalized.missingInformation.some((item) => /검증|validation|확인/i.test(item)));
});
