import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketOffer } from '../src/core/types.ts';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';
import {
  classifyRecommendationTier,
  rankShoppingCandidates,
} from '../src/shopping/ranking.ts';
import type { ReviewEvidence } from '../src/shopping/review-intelligence.ts';
import type { ShoppingCandidate } from '../src/shopping/types.ts';

function candidate(key: string, model: string): ShoppingCandidate {
  return {
    key,
    brand: '브랜드',
    model,
    title: `브랜드 ${model} 43인치 4K 이동식 TV`,
    variant: { screenSizeInch: 43, resolution: '4K' },
    bundle: [],
    condition: 'new',
    sourceUrls: [`https://shop.example/${key}`, `https://brand.example/${key}`],
    discoveryScore: 0.85,
    facts: {
      screenSizeInch: { value: 43, verification: 'official', sourceUrl: `https://brand.example/${key}` },
      resolution: { value: '4K', verification: 'official', sourceUrl: `https://brand.example/${key}` },
      portableStand: { value: true, verification: 'page_verified', sourceUrl: `https://shop.example/${key}` },
      brightnessNits: { value: 500, verification: 'official', sourceUrl: `https://brand.example/${key}` },
      warrantyMonths: { value: 24, verification: 'official', sourceUrl: `https://brand.example/${key}` },
    },
    constraintState: 'ELIGIBLE',
  };
}

function offer(item: ShoppingCandidate, amount: number): MarketOffer {
  return {
    id: `offer-${item.key}`,
    market: '테스트몰',
    title: `${item.brand} ${item.model}`,
    url: `https://seller.example/${item.key}`,
    currency: 'KRW',
    retrievedAt: '2026-08-27T00:00:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 0.98,
    bundleComplete: true,
    eligible: true,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    fieldVerification: { identity: 'page_verified', price: 'page_verified', shipping: 'page_verified' },
    salePrice: amount,
    shippingFee: 0,
    shipping: { status: 'free', baseFee: 0, verification: 'page_verified' },
    totalCashPrice: amount,
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
  };
}

function review(item: ShoppingCandidate, index: number): ReviewEvidence {
  return {
    candidateKey: item.key,
    topic: 'display_quality',
    polarity: 'positive',
    sourceClass: 'verified_purchase_review',
    acquisitionMethod: 'static_html',
    identityRelevance: 1,
    verifiedPurchaseConfidence: 1,
    verifiedPurchase: true,
    retrievedAt: '2026-08-27T00:00:00.000Z',
    publishedAt: '2026-08-01',
    sourceUrl: `https://reviews${index}.example/${item.key}`,
    independenceKey: `${item.key}:reviewer:${index}`,
    confidence: 0.9,
    claim: `${item.model} 화질 화면이 선명하고 좋음`,
  };
}

test('recommendation tier thresholds are deterministic at the specified boundaries', () => {
  assert.equal(classifyRecommendationTier({ recommendationScore: 0.78, evidenceConfidence: 0.72, priceStatus: 'verified', valueLed: false, materialRepeatedNegative: false }), 'STRONG_RECOMMENDATION');
  assert.equal(classifyRecommendationTier({ recommendationScore: 0.77, evidenceConfidence: 0.72, priceStatus: 'verified', valueLed: false, materialRepeatedNegative: false }), 'RECOMMENDED');
  assert.equal(classifyRecommendationTier({ recommendationScore: 0.70, evidenceConfidence: 0.54, priceStatus: 'verified', valueLed: false, materialRepeatedNegative: false }), 'PROMISING_NEEDS_VERIFICATION');
  assert.equal(classifyRecommendationTier({ recommendationScore: 0.67, evidenceConfidence: 0.9, priceStatus: 'verified', valueLed: false, materialRepeatedNegative: false }), 'CAUTION');
});

test('material repeated negatives cap the recommendation tier at CAUTION', () => {
  assert.equal(classifyRecommendationTier({ recommendationScore: 0.9, evidenceConfidence: 0.9, priceStatus: 'verified', valueLed: false, materialRepeatedNegative: true }), 'CAUTION');
});

test('value-led query cannot receive STRONG recommendation without a verified decisive price', () => {
  assert.equal(classifyRecommendationTier({ recommendationScore: 0.9, evidenceConfidence: 0.9, priceStatus: 'indicative', valueLed: true, materialRepeatedNegative: false }), 'PROMISING_NEEDS_VERIFICATION');
  assert.equal(classifyRecommendationTier({ recommendationScore: 0.9, evidenceConfidence: 0.9, priceStatus: 'unknown', valueLed: true, materialRepeatedNegative: false }), 'PROMISING_NEEDS_VERIFICATION');
});

test('Relay availability cannot change public order, score, tier, or best-value eligibility', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 가성비 좋은 제품 추천해줘');
  const a = candidate('a', 'MODEL43A');
  const b = candidate('b', 'MODEL43B');
  const input = {
    plan,
    candidates: [a, b],
    reviews: [review(a, 1), review(a, 2), review(b, 3)],
    offers: [offer(a, 390_000), offer(b, 380_000)],
  };

  const offline = rankShoppingCandidates({ ...input, personalizationAvailable: false });
  const online = rankShoppingCandidates({ ...input, personalizationAvailable: true });

  assert.deepEqual(online.map((item) => item.candidate.key), offline.map((item) => item.candidate.key));
  assert.deepEqual(online.map((item) => item.recommendationScore), offline.map((item) => item.recommendationScore));
  assert.deepEqual(online.map((item) => item.recommendationTier), offline.map((item) => item.recommendationTier));
  assert.deepEqual(online.map((item) => item.rationale.bestValueEligible), offline.map((item) => item.rationale.bestValueEligible));
});
