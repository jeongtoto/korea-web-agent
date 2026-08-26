import test from 'node:test';
import assert from 'node:assert/strict';
import { runShoppingResearch } from '../src/shopping/shopping-orchestrator.ts';
import type { MarketOffer } from '../src/core/types.ts';
import type { ShoppingPriceVerificationScope } from '../src/shopping/price-verification-adapter.ts';

function marketOffer(model: string, key: string, amount: number): MarketOffer {
  return {
    id: `offer-${key}`,
    market: '테스트몰',
    title: `브랜드 ${model}`,
    url: `https://seller.example/${key}`,
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
    salePrice: amount,
    shippingFee: 0,
    shipping: { status: 'free', baseFee: 0, verification: 'page_verified' },
    totalCashPrice: amount,
    conditions: [], riskFlags: [], exclusionReasons: [],
  };
}

function isDeepQuery(query: string): boolean {
  return /(실사용|리뷰|단점|불량|고장|결함|장기 사용|내구성|A\/S|AS 보증|서비스 후기)/i.test(query);
}

test('precision orchestrator discovers broadly, deep-researches Top 5, and never exact-price-verifies the whole market', async () => {
  const verificationCalls: Array<{ key: string; scope: ShoppingPriceVerificationScope }> = [];
  const candidates = Array.from({ length: 24 }, (_, index) => ({
    title: `브랜드 MODEL${1000 + index} 43인치 4K 이동식 TV`,
    url: `https://shop.example/${index}`,
    snippet: '43인치 UHD 4K 이동형 스마트 TV',
  }));

  const result = await runShoppingResearch(
    '50만원 이하 43인치 4K 이동식 TV 가성비 좋은 거 추천해줘. 화질과 이동성이 중요해.',
    undefined,
    {
      publicSearch: async (query) => isDeepQuery(query)
        ? [{ title: '실사용 후기', url: `https://review.example/${encodeURIComponent(query)}`, snippet: '화질이 선명하고 스탠드가 안정적이며 장기 사용에도 튼튼하다.' }]
        : candidates,
      directPage: async (url) => {
        const index = Number(url.split('/').at(-1));
        return {
          url,
          title: `verified ${index}`,
          facts: {
            attributes: {
              screenSizeInch: 43,
              resolution: '4K',
              portableStand: true,
              brightnessNits: Math.max(250, 620 - index * 14),
              refreshRateHz: index < 3 ? 120 : 60,
              smartOs: index < 10,
              warrantyMonths: index < 5 ? 24 : 12,
            },
          },
          evidence: [],
        };
      },
      priceVerifier: async (assessment, scope) => {
        verificationCalls.push({ key: assessment.candidate.key, scope });
        const index = Number(assessment.candidate.model?.replace(/\D/g, '') ?? '1000') - 1000;
        return {
          candidateKey: assessment.candidate.key,
          scope,
          offers: [marketOffer(assessment.candidate.model ?? assessment.candidate.title, `${assessment.candidate.key}-${scope}`, 360_000 + Math.max(0, index) * 4_000)],
          errors: [],
        };
      },
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    },
  );

  assert.equal(result.stage, 'COMPLETE');
  assert.deepEqual(result.stageHistory, ['PLANNING', 'DISCOVERY', 'NORMALIZATION', 'LIGHT_ENRICHMENT', 'DEEP_RESEARCH', 'PRICE_VERIFICATION', 'RANKING', 'COMPLETE']);
  assert.equal(result.progress.rawHits, 24);
  assert.equal(result.progress.normalizedCandidates, 24);
  assert.ok(result.progress.eligibleCandidates >= 10);
  assert.equal(result.progress.deepResearchTotal, 5);
  assert.equal(result.progress.deepResearchCompleted, 5);
  assert.equal(new Set(verificationCalls.map((call) => call.key)).size, 5, 'only finalists may enter exact price verification');
  assert.equal(verificationCalls.filter((call) => call.scope === 'targeted').length, 5);
  assert.ok(verificationCalls.filter((call) => call.scope === 'full').length >= 3);
  assert.ok(verificationCalls.filter((call) => call.scope === 'full').length <= 5);
  assert.equal(result.assessments.length, 5);
  assert.ok(result.assessments.every((item) => item.candidate.constraintState === 'ELIGIBLE'));
  assert.ok(result.assessments.every((item) => item.evidenceUrls.length > 0));
});

test('candidate-local and price-verification failures degrade partially without discarding healthy recommendations', async () => {
  let priceCalls = 0;
  const result = await runShoppingResearch('43인치 4K 이동식 TV 추천해줘', undefined, {
    publicSearch: async (query) => isDeepQuery(query)
      ? [{ title: '후기', url: `https://reviews.example/${encodeURIComponent(query)}`, snippet: '화질이 좋고 만족스럽다.' }]
      : Array.from({ length: 8 }, (_, index) => ({
          title: `브랜드 TEST${100 + index} 43인치 4K 이동식 TV`,
          url: `https://shop.example/${index}`,
          snippet: '4K 이동식 TV',
        })),
    directPage: async (url) => {
      if (url.endsWith('/2')) throw new Error('one page blocked');
      return { url, facts: { attributes: { screenSizeInch: 43, resolution: '4K', portableStand: true, brightnessNits: 350 } }, evidence: [] };
    },
    priceVerifier: async (assessment, scope) => {
      priceCalls += 1;
      if (assessment.candidate.key.includes('TEST101') && scope === 'targeted') throw new Error('one finalist price blocked');
      return { candidateKey: assessment.candidate.key, scope, offers: [marketOffer(assessment.candidate.model ?? assessment.candidate.title, `${priceCalls}`, 399_000)], errors: [] };
    },
    now: () => new Date('2026-08-26T00:00:00.000Z'),
  });

  assert.equal(result.stage, 'COMPLETE');
  assert.ok(result.assessments.length >= 3);
  assert.ok(result.errors.length >= 1);
  assert.ok(result.assessments.some((item) => item.verifiedCashPrice === 399_000));
});

test('personalization availability never changes the public recommendation score or order', async () => {
  const baseDeps = {
    publicSearch: async (query: string) => isDeepQuery(query)
      ? [{ title: '후기', url: `https://review.example/${encodeURIComponent(query)}`, snippet: '화질이 선명하고 스탠드가 안정적이다.' }]
      : Array.from({ length: 6 }, (_, index) => ({ title: `브랜드 ISO${100 + index} 43인치 4K 이동식 TV`, url: `https://shop.example/${index}`, snippet: '4K 이동식 TV' })),
    directPage: async (url: string) => ({ url, facts: { attributes: { screenSizeInch: 43, resolution: '4K', portableStand: true, brightnessNits: 350 } }, evidence: [] }),
    priceVerifier: async (assessment: any, scope: ShoppingPriceVerificationScope) => ({ candidateKey: assessment.candidate.key, scope, offers: [marketOffer(assessment.candidate.model ?? assessment.candidate.title, `${assessment.candidate.key}-${scope}`, 399_000)], errors: [] }),
    now: () => new Date('2026-08-26T00:00:00.000Z'),
  };

  const offline = await runShoppingResearch('43인치 4K 이동식 TV 추천해줘', undefined, { ...baseDeps, personalizationAvailable: false });
  const online = await runShoppingResearch('43인치 4K 이동식 TV 추천해줘', undefined, { ...baseDeps, personalizationAvailable: true });

  assert.deepEqual(online.assessments.map((item) => item.candidate.key), offline.assessments.map((item) => item.candidate.key));
  assert.deepEqual(online.assessments.map((item) => item.recommendationScore), offline.assessments.map((item) => item.recommendationScore));
  assert.ok(offline.assessments.every((item) => item.confidenceDimensions.personalization === 0));
  assert.ok(online.assessments.every((item) => item.confidenceDimensions.personalization > 0));
});
