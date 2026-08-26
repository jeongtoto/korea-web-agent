import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketOffer } from '../src/core/types.ts';
import { deepResearchCandidates } from '../src/shopping/deep-research.ts';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';
import { rankShoppingCandidates } from '../src/shopping/ranking.ts';
import { aggregateReviewConsensus, type ReviewEvidence } from '../src/shopping/review-intelligence.ts';
import { scoreReviewTrust } from '../src/shopping/review-trust.ts';
import type { FactValue, ShoppingCandidate } from '../src/shopping/types.ts';

const NOW = new Date('2026-08-27T00:00:00.000Z');

function fact(value: FactValue['value'], verification: FactValue['verification'] = 'page_verified'): FactValue {
  return { value, verification, sourceUrl: 'https://evidence.example/fact' };
}

function tv(key: string, model: string, facts: Record<string, FactValue>): ShoppingCandidate {
  return {
    key,
    brand: '브랜드',
    model,
    title: `브랜드 ${model} 43인치 4K 이동식 TV`,
    variant: { screenSizeInch: 43, resolution: '4K' },
    bundle: [],
    condition: 'new',
    sourceUrls: [`https://shop.example/${key}`, `https://brand.example/${key}`],
    discoveryScore: 0.8,
    facts,
    constraintState: 'ELIGIBLE',
  };
}

function bedding(key: string, model: string, facts: Record<string, FactValue>): ShoppingCandidate {
  return {
    key,
    brand: '베딩',
    model,
    title: `베딩 ${model} 퀸 사계절 차렵이불`,
    variant: { bedSize: 'Q' },
    bundle: [],
    condition: 'new',
    sourceUrls: [`https://shop.example/${key}`, `https://brand.example/${key}`],
    discoveryScore: 0.8,
    facts,
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
    retrievedAt: NOW.toISOString(),
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

function trustedReview(
  candidateKey: string,
  topic: string,
  polarity: ReviewEvidence['polarity'],
  sourceUrl: string,
  independenceKey: string,
  publishedAt: string,
  claim: string,
  sponsored = false,
): ReviewEvidence {
  const base: ReviewEvidence = {
    candidateKey,
    topic,
    polarity,
    sourceClass: sponsored ? 'sponsored_content' : 'community_report',
    acquisitionMethod: 'static_html',
    identityRelevance: 1,
    verifiedPurchaseConfidence: 0,
    sponsored,
    publishedAt,
    retrievedAt: NOW.toISOString(),
    sourceUrl,
    independenceKey,
    confidence: 0.85,
    claim,
  };
  const trust = scoreReviewTrust(base, NOW);
  return { ...base, effectiveWeight: trust.effectiveWeight };
}

test('QUALITY-GOLDEN sponsored volume cannot overpower fewer independent organic defect reports', () => {
  const sponsored = Array.from({ length: 5 }, (_, index) => trustedReview(
    'tv',
    'durability',
    'positive',
    `https://sponsor${index}.example/post`,
    `sponsor-${index}`,
    '2026-08-01',
    'MODEL43 내구성이 좋고 오래 사용해도 문제 없음',
    true,
  ));
  const organic = [1, 2].map((index) => trustedReview(
    'tv',
    'durability',
    'negative',
    `https://community${index}.example/post`,
    `owner-${index}`,
    '2026-08-15',
    'MODEL43 장기 사용 중 고장 문제가 반복됨',
  ));

  const consensus = aggregateReviewConsensus([...sponsored, ...organic]).find((item) => item.topic === 'durability');
  assert.ok(consensus);
  assert.ok((consensus?.negativeWeight ?? 0) > (consensus?.positiveWeight ?? 0));
});

test('QUALITY-GOLDEN recent repeated defects outweigh much older positive reports of comparable source quality', () => {
  const oldPositive = [1, 2].map((index) => trustedReview(
    'tv', 'durability', 'positive', `https://old${index}.example/p`, `old-${index}`, '2023-05-01',
    'MODEL43 오래 사용해도 내구성이 좋고 문제 없음',
  ));
  const recentNegative = [1, 2].map((index) => trustedReview(
    'tv', 'durability', 'negative', `https://recent${index}.example/p`, `recent-${index}`, '2026-08-01',
    'MODEL43 장기 사용 후 고장 문제가 반복됨',
  ));

  const consensus = aggregateReviewConsensus([...oldPositive, ...recentNegative]).find((item) => item.topic === 'durability');
  assert.ok((consensus?.negativeWeight ?? 0) > (consensus?.positiveWeight ?? 0));
});

test('QUALITY-GOLDEN unknown price can rank on product merit but can never receive best-value eligibility', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 가성비 좋은 제품 추천해줘');
  const item = tv('unknown-price', 'MODEL43U', {
    screenSizeInch: fact(43, 'official'),
    resolution: fact('4K', 'official'),
    portableStand: fact(true),
    brightnessNits: fact(500, 'official'),
    warrantyMonths: fact(24, 'official'),
  });

  const ranked = rankShoppingCandidates({ plan, candidates: [item], reviews: [], offers: [] });
  assert.equal(ranked[0]?.rationale.priceStatus, 'unknown');
  assert.equal(ranked[0]?.rationale.bestValueEligible, false);
  assert.notEqual(ranked[0]?.recommendationTier, 'STRONG_RECOMMENDATION');
});

test('QUALITY-GOLDEN stronger bedding material, care, and durability evidence can beat a cheaper weak alternative', () => {
  const plan = planShoppingResearch('퀸 사계절 차렵이불 30만원 이하 가성비 좋은 제품 추천. 촉감 세탁 내구성 중요');
  const cheap = bedding('cheap', 'BEDQ1', {
    bedSize: fact(['Q', 'QUEEN']),
    allSeason: fact(true),
    beddingType: fact('comforter'),
    fabric: fact('polyester'),
    machineWashable: fact(true),
  });
  const better = bedding('better', 'BEDQ2', {
    bedSize: fact(['Q', 'QUEEN']),
    allSeason: fact(true),
    beddingType: fact('comforter'),
    fabric: fact('modal cotton high density', 'official'),
    fillMaterial: fact('modal cotton', 'official'),
    fillWeightG: fact(1200, 'official'),
    machineWashable: fact(true, 'official'),
    allergyFriendly: fact(true, 'official'),
  });
  const reviews: ReviewEvidence[] = [
    trustedReview('cheap', 'fabric_softness', 'negative', 'https://c1.example/r', 'cheap-1', '2026-08-01', 'BEDQ1 이불 촉감이 까슬하고 불편함'),
    trustedReview('cheap', 'washing_durability', 'negative', 'https://c2.example/r', 'cheap-2', '2026-08-01', 'BEDQ1 세탁 후 보풀과 뭉침 손상'),
    trustedReview('better', 'fabric_softness', 'positive', 'https://b1.example/r', 'better-1', '2026-08-01', 'BEDQ2 이불 촉감이 부드럽고 포근해서 만족'),
    trustedReview('better', 'washing_durability', 'positive', 'https://b2.example/r', 'better-2', '2026-08-01', 'BEDQ2 세탁 후에도 변형 없고 멀쩡하게 유지'),
    trustedReview('better', 'durability', 'positive', 'https://b3.example/r', 'better-3', '2026-08-01', 'BEDQ2 장기 사용 내구성이 좋고 문제 없음'),
  ];

  const ranked = rankShoppingCandidates({
    plan,
    candidates: [cheap, better],
    reviews,
    offers: [offer(cheap, 110_000), offer(better, 145_000)],
  });

  assert.equal(ranked[0]?.candidate.key, 'better');
});

test('QUALITY-GOLDEN commerce search snippet is retailer metadata, never verified-purchase evidence', async () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const item = tv('snippet', 'MODEL43S', {
    screenSizeInch: fact(43), resolution: fact('4K'), portableStand: fact(true),
  });
  const result = await deepResearchCandidates(plan, [item], {
    now: () => NOW,
    publicSearch: async () => [{
      title: 'MODEL43S 실사용 후기 화질 화면이 선명하고 좋음',
      url: 'https://www.coupang.com/vp/products/123',
      snippet: '구매 후기라고 표시된 검색 결과',
      source: 'duckduckgo',
    }],
  });

  assert.ok(result.reviewEvidence.length > 0);
  assert.ok(result.reviewEvidence.every((review) => review.sourceClass === 'retailer_listing'));
  assert.ok(result.reviewEvidence.every((review) => review.acquisitionMethod === 'search_metadata'));
  assert.ok(result.reviewEvidence.every((review) => review.verifiedPurchaseConfidence === 0));
});
