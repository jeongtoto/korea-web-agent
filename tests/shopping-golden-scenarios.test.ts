import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketOffer } from '../src/core/types.ts';
import type { SearchHit } from '../src/providers/index.ts';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';
import { rankShoppingCandidates } from '../src/shopping/ranking.ts';
import { runShoppingResearch } from '../src/shopping/shopping-orchestrator.ts';
import type { ReviewEvidence } from '../src/shopping/review-intelligence.ts';
import type { ShoppingCandidate } from '../src/shopping/types.ts';

function verifiedOffer(model: string, price: number): MarketOffer {
  return {
    id: `offer-${model}`,
    market: '검증몰',
    title: `${model} 신품`,
    url: `https://seller.example/${model}`,
    currency: 'KRW',
    retrievedAt: '2026-08-26T00:00:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 0.99,
    identityVerdict: 'exact',
    bundleComplete: true,
    eligible: true,
    constraintStatus: 'eligible',
    fieldVerification: { identity: 'page_verified', price: 'page_verified', shipping: 'page_verified' },
    salePrice: price,
    shippingFee: 0,
    shipping: { status: 'free', baseFee: 0, verification: 'page_verified' },
    totalCashPrice: price,
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
  };
}

function isDeepQuery(query: string): boolean {
  return /(실사용 후기|단점 불량|장기 사용|A\/S AS)/.test(query);
}

test('TV-001: a cheaper FHD decoy cannot enter the final recommendation', async () => {
  const discovery: SearchHit[] = [
    { title: '브랜드 FHD001 43인치 FHD 이동식 TV', url: 'https://shop.example/FHD001', snippet: '가장 저렴한 199000원 이동식 스탠드' },
    ...Array.from({ length: 8 }, (_, index) => ({
      title: `브랜드 UHD${index + 100} 43인치 4K 이동식 TV`,
      url: `https://shop.example/UHD${index + 100}`,
      snippet: `UHD 4K 이동식 스탠드 ${350000 + index * 10000}원`,
    })),
  ];

  const result = await runShoppingResearch(
    '50만원 이하 43인치 4K 이동식 TV 가성비 좋은 거 추천해줘. 화질과 이동성이 중요해.',
    undefined,
    {
      publicSearch: async (query) => isDeepQuery(query)
        ? [{ title: '실사용 화질 좋고 스탠드 안정적', url: `https://review.example/${encodeURIComponent(query)}`, snippet: '장기 사용에도 튼튼하고 화면이 선명함' }]
        : discovery,
      directPage: async (url) => {
        const model = url.split('/').pop() ?? '';
        const fhd = model.startsWith('FHD');
        return {
          url,
          product: {
            model,
            attributes: {
              screenSizeInch: 43,
              resolution: fhd ? 'FHD' : '4K',
              portableStand: true,
              brightnessNits: fhd ? 250 : 350,
              smartOs: true,
              warrantyMonths: 24,
            },
          },
          evidence: [],
        };
      },
      priceVerifier: async (assessment, scope) => ({
        candidateKey: assessment.candidate.key,
        scope,
        offers: [verifiedOffer(assessment.candidate.model ?? assessment.candidate.key, assessment.candidate.model === 'FHD001' ? 199_000 : 390_000)],
        errors: [],
      }),
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    },
  );

  assert.equal(result.stage, 'COMPLETE');
  assert.equal(result.assessments.length, 5);
  assert.ok(result.assessments.every((item) => item.candidate.model !== 'FHD001'));
  assert.ok(result.assessments.every((item) => item.candidate.facts.resolution?.value === '4K'));
  assert.ok(result.assessments.every((item) => item.evidenceUrls.length > 0));
});

test('BEDDING-001: non-queen and winter-only decoys cannot win over verified queen all-season bedding', async () => {
  const discovery: SearchHit[] = [
    { title: '브랜드 BEDS01 싱글 겨울 차렵이불', url: 'https://shop.example/BEDS01', snippet: 'S 싱글 겨울 전용 59000원' },
    { title: '브랜드 BEDQ01 퀸 겨울 차렵이불', url: 'https://shop.example/BEDQ01', snippet: 'Q 퀸 겨울 전용 69000원' },
    { title: '브랜드 BEDQ02 퀸 사계절 차렵이불', url: 'https://shop.example/BEDQ02', snippet: 'Q 퀸 사계절 차렵 89000원' },
    { title: '브랜드 BEDQ03 퀸 사계절 모달 차렵이불', url: 'https://shop.example/BEDQ03', snippet: 'Q 퀸 사계절 모달 149000원' },
    { title: '브랜드 BEDQ04 퀸 사계절 고밀도 순면 차렵이불', url: 'https://shop.example/BEDQ04', snippet: 'Q 퀸 사계절 고밀도 순면 179000원' },
    { title: '브랜드 BEDQ05 퀸 사계절 호텔 차렵이불', url: 'https://shop.example/BEDQ05', snippet: 'Q 퀸 사계절 호텔형 199000원' },
    { title: '브랜드 BEDQ06 퀸 사계절 알러지케어 차렵이불', url: 'https://shop.example/BEDQ06', snippet: 'Q 퀸 사계절 알러지케어 219000원' },
  ];

  const result = await runShoppingResearch(
    '퀸 사이즈 사계절 차렵이불, 고급스러운 디자인이고 세탁 편한 제품을 30만원 이하로 추천해줘.',
    undefined,
    {
      publicSearch: async (query) => {
        if (!isDeepQuery(query)) return discovery;
        const premium = /BEDQ0[3-6]/.test(query);
        return [{
          title: premium ? '구매 후기 부드럽고 세탁 후에도 형태 유지' : '광고 협찬 가성비 이불 소개',
          url: premium ? `https://coupang.com/review/${encodeURIComponent(query)}` : `https://blog.example/sponsored/${encodeURIComponent(query)}`,
          snippet: premium ? '촉감이 부드럽고 세탁 내구성이 좋음' : '제품을 제공받아 작성한 광고 후기',
        }];
      },
      directPage: async (url) => {
        const model = url.split('/').pop() ?? '';
        return {
          url,
          product: {
            model,
            attributes: {
              bedSize: model === 'BEDS01' ? 'SINGLE' : 'QUEEN',
              allSeason: !['BEDS01', 'BEDQ01'].includes(model),
              beddingType: 'comforter',
              fabric: /BEDQ0[3-6]/.test(model) ? 'premium_fabric' : 'polyester',
              machineWashable: true,
              warrantyMonths: 12,
            },
          },
          evidence: [],
        };
      },
      priceVerifier: async (assessment, scope) => {
        const model = assessment.candidate.model ?? assessment.candidate.key;
        const prices: Record<string, number> = { BEDQ02: 89_000, BEDQ03: 149_000, BEDQ04: 179_000, BEDQ05: 199_000, BEDQ06: 219_000 };
        return { candidateKey: assessment.candidate.key, scope, offers: [verifiedOffer(model, prices[model] ?? 250_000)], errors: [] };
      },
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    },
  );

  assert.equal(result.stage, 'COMPLETE');
  assert.ok(result.assessments.length >= 3);
  assert.ok(result.assessments.every((item) => item.candidate.facts.bedSize?.value === 'QUEEN'));
  assert.ok(result.assessments.every((item) => item.candidate.facts.allSeason?.value === true));
  assert.ok(!result.assessments.some((item) => ['BEDS01', 'BEDQ01'].includes(item.candidate.model ?? '')));
  assert.ok(result.assessments[0]!.candidate.model !== 'BEDQ02', 'sponsored-only cheapest option must not automatically win');
});

test('Relay isolation: availability alone never changes public ranking or fabricates personalization confidence', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 가성비 추천');
  const candidates: ShoppingCandidate[] = ['TVA100', 'TVB200'].map((model, index) => ({
    key: model,
    brand: '브랜드',
    model,
    variant: { screenSizeInch: 43, resolution: '4K' },
    bundle: [],
    condition: 'new',
    title: `${model} 43인치 4K 이동식 TV`,
    sourceUrls: [`https://shop.example/${model}`],
    discoveryScore: 0.9 - index * 0.05,
    facts: {
      screenSizeInch: { value: 43, verification: 'official', sourceUrl: `https://official.example/${model}` },
      resolution: { value: '4K', verification: 'official', sourceUrl: `https://official.example/${model}` },
      portableStand: { value: true, verification: 'page_verified', sourceUrl: `https://shop.example/${model}` },
      brightnessNits: { value: 350 - index * 30, verification: 'official', sourceUrl: `https://official.example/${model}` },
    },
    constraintState: 'ELIGIBLE',
  }));
  const reviews: ReviewEvidence[] = candidates.map((candidate) => ({
    candidateKey: candidate.key,
    topic: 'display_quality',
    polarity: 'positive',
    claim: '화질이 좋음',
    sourceClass: 'verified_purchase_review',
    sourceUrl: `https://review.example/${candidate.key}`,
    retrievedAt: '2026-08-26T00:00:00.000Z',
    independenceKey: `review:${candidate.key}`,
    sponsored: false,
    verifiedPurchase: true,
    confidence: 0.8,
  }));
  const offers = [verifiedOffer('TVA100', 390_000), verifiedOffer('TVB200', 370_000)];

  const offline = rankShoppingCandidates({ plan, candidates, reviews, offers, personalizationAvailable: false });
  const online = rankShoppingCandidates({ plan, candidates, reviews, offers, personalizationAvailable: true });

  assert.deepEqual(online.map((item) => item.candidate.key), offline.map((item) => item.candidate.key));
  assert.deepEqual(online.map((item) => item.recommendationScore), offline.map((item) => item.recommendationScore));
  assert.ok(offline.every((item) => item.confidenceDimensions.personalization === 0));
  assert.ok(online.every((item) => item.confidenceDimensions.personalization === 0));
});
