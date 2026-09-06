import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductReport } from '../src/report/product-report.ts';
import { enrichShoppingReport } from '../src/report/shopping-intelligence-report.ts';
import { buildShoppingPresentation } from '../src/report/shopping-presentation.ts';
import type {
  EvidenceItem,
  MarketOffer,
  NormalizedTarget,
  ProductReport,
  ResearchIntent,
} from '../src/core/types.ts';

const target: NormalizedTarget = {
  kind: 'product',
  brand: '테스트',
  name: '테스트 모니터',
  model: 'TEST27QHD',
};

const purchaseIntent: ResearchIntent = {
  productResearch: true,
  purchaseDecision: true,
  priceSensitive: true,
  personalizedPriceUseful: true,
  specOnly: false,
};

function review(sourceUrl: string, independenceKey: string): EvidenceItem {
  return {
    claim: '정확 SKU 실사용 평가가 긍정적임',
    sourceUrl,
    sourceType: 'review',
    retrievedAt: '2026-09-06T04:30:00.000Z',
    acquisitionMethod: 'static_html',
    evidenceClass: 'verified_purchase_review',
    independenceKey,
    confidence: 0.9,
    specificity: 'exact_product',
    data: { sentiment: 0.8 },
  };
}

function verifiedOffer(overrides: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: 'seller:test',
    market: '판매자몰',
    title: '테스트 TEST27QHD 화이트 신품',
    url: 'https://seller.example.com/products/test27qhd',
    currency: 'KRW',
    retrievedAt: '2026-09-06T04:30:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 1,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    bundleComplete: true,
    eligible: true,
    salePrice: 399000,
    shippingFee: 0,
    totalCashPrice: 399000,
    availability: 'InStock',
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: 'page_verified',
    },
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
    ...overrides,
  };
}

function baseReport(): ProductReport {
  const cash = verifiedOffer();
  const card = verifiedOffer({
    id: 'seller:test-card',
    cardName: '삼성카드',
    cardPrice: 340000,
    conditions: ['삼성카드 할인 이벤트'],
  });
  return {
    decision: 'BUY',
    confidence: 0.9,
    confidenceDimensions: {
      identity: 1,
      price: 0.95,
      officialSpecs: 0.8,
      reviews: 0.8,
      negativeSignals: 0.7,
      personalizedPrice: 0.95,
    },
    title: '테스트 TEST27QHD',
    summary: '공개 가격 기준 구매 후보',
    reasons: [],
    strengths: [],
    weaknesses: [],
    missingInformation: [],
    evidence: [],
    sourceCount: 2,
    price: {
      currency: 'KRW',
      salePrice: 399000,
      sourceUrl: cash.url,
    },
    personalizedPrice: {
      currency: 'KRW',
      cashPaymentPrice: 350000,
      cardInstantDiscount: 10000,
      membershipPoints: 20000,
      sourceUrl: card.url,
    },
    offers: [cash, card],
    bestOffers: {
      cash: { basis: 'cash', rank: 1, amount: 399000, offer: cash, reasons: [] },
      ownedCard: { basis: 'owned_card', rank: 1, amount: 340000, offer: card, reasons: [] },
      effective: { basis: 'effective', rank: 1, amount: 330000, offer: card, reasons: [] },
    },
  };
}

test('personalized price alone never satisfies a price-sensitive purchase decision', () => {
  const report = buildProductReport({
    target,
    intent: purchaseIntent,
    identityConfidence: 0.96,
    evidence: [
      review('https://review.example.com/1', 'review-1'),
      review('https://review.example.com/2', 'review-2'),
    ],
    personalizedPrice: {
      currency: 'KRW',
      membershipPrice: 329000,
      sourceUrl: 'https://seller.example.com/account-price',
    },
  });

  assert.equal(report.decision, 'INSUFFICIENT');
  assert.equal(report.confidenceDimensions.price, 0);
  assert.ok(report.missingInformation.some((item) => /가격/.test(item)));
});

test('shopping report keeps public seller cash as the standard price and does not publish personalized card or membership amounts', () => {
  const report = enrichShoppingReport(baseReport(), '2026-09-06T04:30:00.000Z');
  const rows = report.standardPriceRows ?? [];

  assert.equal(rows.find((row) => row.key === 'cash')?.amount, 399000);
  assert.equal(rows.find((row) => row.key === 'card')?.amount, undefined);
  assert.equal(rows.find((row) => row.key === 'effective_without_membership')?.amount, undefined);
  assert.equal(rows.find((row) => row.key === 'effective_with_membership')?.amount, undefined);
  assert.equal(report.membershipScenarios, undefined);
});

test('presentation treats card and membership economics as benefit hints with a seller link, not verified personalized prices', () => {
  const report = enrichShoppingReport(baseReport(), '2026-09-06T04:30:00.000Z');
  const presentation = buildShoppingPresentation(report, {
    fallbackName: '테스트 TEST27QHD',
    relay: { available: false, used: false, mode: 'public_only' },
  }).markdown;

  assert.match(presentation, /현금 결제[^\n]*399,000원/);
  assert.match(presentation, /삼성카드/);
  assert.match(presentation, /판매페이지에서 확인|직접 확인/);
  assert.match(presentation, /https:\/\/seller\.example\.com\/products\/test27qhd/);
  assert.doesNotMatch(presentation, /340,000원|330,000원|350,000원/);
});
