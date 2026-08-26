import test from 'node:test';
import assert from 'node:assert/strict';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';
import { rankShoppingCandidates } from '../src/shopping/ranking.ts';
import type { MarketOffer } from '../src/core/types.ts';
import type { ReviewEvidence } from '../src/shopping/review-intelligence.ts';
import type { FactValue, ShoppingCandidate } from '../src/shopping/types.ts';

function fact(value: FactValue['value'], verification: FactValue['verification'] = 'page_verified', sourceUrl = 'https://spec.example/product'): FactValue {
  return { value, verification, sourceUrl };
}

function tvCandidate(key: string, model: string, overrides: Partial<ShoppingCandidate> = {}): ShoppingCandidate {
  return {
    key,
    brand: '브랜드',
    model,
    title: `브랜드 ${model} 43인치 4K 이동식 TV`,
    variant: { screenSizeInch: 43, resolution: '4K' },
    bundle: [],
    condition: 'new',
    sourceUrls: [`https://shop.example/${key}`],
    discoveryScore: 0.85,
    facts: {
      screenSizeInch: fact(43),
      resolution: fact('4K'),
      portableStand: fact(true),
      brightnessNits: fact(350),
      warrantyMonths: fact(24, 'official', `https://brand.example/${key}`),
    },
    constraintState: 'ELIGIBLE',
    ...overrides,
  };
}

function offer(candidate: ShoppingCandidate, amount: number, options: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: `offer-${candidate.key}-${amount}`,
    market: '테스트몰',
    title: `${candidate.brand ?? ''} ${candidate.model ?? candidate.title}`,
    url: `https://seller.example/${candidate.key}`,
    currency: 'KRW',
    retrievedAt: '2026-08-26T00:00:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 0.98,
    bundleComplete: true,
    eligible: true,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: 'page_verified',
    },
    salePrice: amount,
    shippingFee: 0,
    shipping: { status: 'free', baseFee: 0, verification: 'page_verified' },
    totalCashPrice: amount,
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
    ...options,
  };
}

function review(candidate: ShoppingCandidate, topic: string, polarity: ReviewEvidence['polarity'], index: number, confidence = 0.8): ReviewEvidence {
  return {
    candidateKey: candidate.key,
    topic,
    polarity,
    sourceClass: 'verified_purchase_review',
    verifiedPurchase: true,
    retrievedAt: '2026-08-26T00:00:00.000Z',
    sourceUrl: `https://reviews.example/${candidate.key}/${topic}/${index}`,
    independenceKey: `${candidate.key}:${topic}:${index}`,
    confidence,
    claim: `${topic} ${polarity}`,
  };
}

test('verified hard-constraint failure can never enter the ranking even when it is the cheapest', () => {
  const plan = planShoppingResearch('50만원 이하 43인치 4K 이동식 TV 가성비 추천해줘');
  const good = tvCandidate('good', 'GOOD43');
  const cheapFhd = tvCandidate('cheap-fhd', 'CHEAP43', {
    facts: {
      screenSizeInch: fact(43),
      resolution: fact('FHD'),
      portableStand: fact(true),
    },
    constraintState: 'EXCLUDED',
  });

  const ranked = rankShoppingCandidates({
    plan,
    candidates: [cheapFhd, good],
    reviews: [],
    offers: [offer(cheapFhd, 199_000), offer(good, 399_000)],
  });

  assert.deepEqual(ranked.map((item) => item.candidate.key), ['good']);
});

test('preliminary hard-constraint candidates never enter final recommendations', () => {
  const plan = planShoppingResearch('50만원 이하 43인치 4K 이동식 TV 가성비 추천해줘');
  const verified = tvCandidate('verified', 'VERIFIED43');
  const preliminary = tvCandidate('preliminary', 'UNKNOWN43', {
    constraintState: 'PRELIMINARY',
    facts: {
      screenSizeInch: fact(43),
      portableStand: fact(true),
    },
  });

  const ranked = rankShoppingCandidates({
    plan,
    candidates: [preliminary, verified],
    reviews: [
      review(preliminary, 'display_quality', 'positive', 1),
      review(preliminary, 'stand_stability', 'positive', 2),
    ],
    offers: [offer(preliminary, 199_000), offer(verified, 399_000)],
  });

  assert.deepEqual(ranked.map((item) => item.candidate.key), ['verified']);
  assert.deepEqual(rankShoppingCandidates({
    plan,
    candidates: [preliminary],
    reviews: [],
    offers: [offer(preliminary, 199_000)],
  }), []);
});

test('a materially better 399k product can beat a mediocre 359k product on value instead of raw lowest-price ordering', () => {
  const plan = planShoppingResearch('50만원 이하 43인치 4K 이동식 TV 가성비 좋은 거 추천해줘. 화질과 이동성이 중요해.');
  const cheap = tvCandidate('cheap', 'CHEAP43', {
    facts: {
      screenSizeInch: fact(43), resolution: fact('4K'), portableStand: fact(true),
      brightnessNits: fact(250), warrantyMonths: fact(12, 'official'),
    },
  });
  const better = tvCandidate('better', 'BETTER43', {
    facts: {
      screenSizeInch: fact(43), resolution: fact('4K'), portableStand: fact(true),
      brightnessNits: fact(500), refreshRateHz: fact(120), smartOs: fact(true), warrantyMonths: fact(24, 'official'),
    },
  });
  const reviews = [
    review(cheap, 'display_quality', 'negative', 1),
    review(cheap, 'stand_stability', 'negative', 2),
    review(better, 'display_quality', 'positive', 1),
    review(better, 'display_quality', 'positive', 2),
    review(better, 'stand_stability', 'positive', 3),
    review(better, 'durability', 'positive', 4),
  ];

  const ranked = rankShoppingCandidates({
    plan,
    candidates: [cheap, better],
    reviews,
    offers: [offer(cheap, 359_000), offer(better, 399_000)],
  });

  assert.equal(ranked[0]?.candidate.key, 'better');
  assert.ok((ranked[0]?.recommendationScore ?? 0) > (ranked[1]?.recommendationScore ?? 0));
  assert.equal(ranked[0]?.verifiedCashPrice, 399_000);
});

test('recommendation score and evidence confidence remain independent', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 화질 좋은 제품 추천해줘');
  const candidate = tvCandidate('sparse', 'SPARSE43', {
    facts: {
      screenSizeInch: fact(43), resolution: fact('4K'), portableStand: fact(true), brightnessNits: fact(500),
    },
  });
  const ranked = rankShoppingCandidates({ plan, candidates: [candidate], reviews: [], offers: [] });
  const assessment = ranked[0]!;

  assert.ok(assessment.recommendationScore >= 0.6, 'verified fit/spec can look promising');
  assert.ok(assessment.evidenceConfidence < assessment.recommendationScore, 'sparse independent evidence must stay visibly uncertain');
});

test('unknown shipping lowers only price verification confidence and never product-quality score', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const candidate = tvCandidate('shipping', 'SHIP43');
  const verified = rankShoppingCandidates({
    plan,
    candidates: [candidate],
    reviews: [review(candidate, 'display_quality', 'positive', 1)],
    offers: [offer(candidate, 399_000)],
  })[0]!;
  const unknownShipping = rankShoppingCandidates({
    plan,
    candidates: [candidate],
    reviews: [review(candidate, 'display_quality', 'positive', 1)],
    offers: [offer(candidate, 399_000, {
      eligible: false,
      totalCashPrice: undefined,
      shippingFee: undefined,
      shipping: { status: 'unknown', verification: 'page_verified' },
      exclusionReasons: ['unknown_shipping'],
    })],
  })[0]!;

  assert.equal(unknownShipping.recommendationScore, verified.recommendationScore);
  assert.ok(unknownShipping.confidenceDimensions.priceVerification < verified.confidenceDimensions.priceVerification);
  assert.equal(unknownShipping.confidenceDimensions.identity, verified.confidenceDimensions.identity);
  assert.equal(unknownShipping.confidenceDimensions.officialSpecs, verified.confidenceDimensions.officialSpecs);
});

test('personalization is an isolated confidence dimension and cannot alter public recommendation order', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const a = tvCandidate('a', 'MODEL43A');
  const b = tvCandidate('b', 'MODEL43B', { facts: { ...tvCandidate('tmp', 'TMP43').facts, brightnessNits: fact(500) } });
  const input = {
    plan,
    candidates: [a, b],
    reviews: [review(b, 'display_quality', 'positive', 1)],
    offers: [offer(a, 380_000), offer(b, 390_000)],
  };

  const publicOnly = rankShoppingCandidates(input);
  const withUnavailablePersonalization = rankShoppingCandidates({ ...input, personalizationAvailable: false });

  assert.deepEqual(withUnavailablePersonalization.map((item) => item.candidate.key), publicOnly.map((item) => item.candidate.key));
  assert.deepEqual(withUnavailablePersonalization.map((item) => item.recommendationScore), publicOnly.map((item) => item.recommendationScore));
  assert.ok(withUnavailablePersonalization.every((item) => item.confidenceDimensions.personalization === 0));
});

test('duplicate review evidence does not materially inflate rank and every Top 5 assessment retains provenance URLs', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const a = tvCandidate('a', 'MODEL43A');
  const b = tvCandidate('b', 'MODEL43B');
  const original = review(a, 'display_quality', 'positive', 1);
  const duplicate = { ...original, sourceUrl: 'https://mirror.example/duplicate', confidence: 0.79 };

  const once = rankShoppingCandidates({ plan, candidates: [a, b], reviews: [original], offers: [offer(a, 390_000), offer(b, 395_000)] });
  const duplicated = rankShoppingCandidates({ plan, candidates: [a, b], reviews: [original, duplicate], offers: [offer(a, 390_000), offer(b, 395_000)] });

  assert.ok(Math.abs((once.find((item) => item.candidate.key === 'a')?.recommendationScore ?? 0) - (duplicated.find((item) => item.candidate.key === 'a')?.recommendationScore ?? 0)) < 1e-9);
  assert.ok(duplicated.slice(0, 5).every((item) => item.evidenceUrls.length > 0));
});
