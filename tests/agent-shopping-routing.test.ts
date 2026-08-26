import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentResearch } from '../src/agent/research.ts';
import type { ResearchJob } from '../src/core/types.ts';
import type { ShoppingResearchResult } from '../src/shopping/shopping-orchestrator.ts';

function shoppingResult(): ShoppingResearchResult {
  return {
    plan: {
      mode: 'RECOMMENDATION',
      categoryId: 'portable_display',
      hardConstraints: [],
      preferences: [],
      dimensionWeights: { fit: 1 },
      discoveryQueries: [],
      limits: {
        rawHits: 80,
        normalizedCandidates: 50,
        lightEnrichment: 20,
        shortlist: 10,
        deepResearch: 5,
        fullPriceVerification: 3,
      },
    },
    stage: 'COMPLETE',
    stageHistory: ['PLANNING', 'DISCOVERY', 'NORMALIZATION', 'LIGHT_ENRICHMENT', 'DEEP_RESEARCH', 'PRICE_VERIFICATION', 'RANKING', 'COMPLETE'],
    progress: {
      rawHits: 30,
      normalizedCandidates: 24,
      eligibleCandidates: 12,
      lightEnrichmentTotal: 20,
      deepResearchCompleted: 5,
      deepResearchTotal: 5,
      priceVerificationCompleted: 5,
      priceVerificationTotal: 5,
    },
    candidates: [],
    assessments: [],
    errors: [],
    partial: false,
  };
}

function exactJob(question: string): ResearchJob {
  return {
    id: 'exact-job',
    status: 'completed',
    request: { question, category: 'product' },
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:01.000Z',
    completedAt: '2026-08-26T00:00:01.000Z',
    target: { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', variant: '43인치' },
    sourceResults: [],
    evidence: [],
    relay: { available: false, used: false, mode: 'public_only' },
    errors: [],
    report: {
      decision: 'INSUFFICIENT',
      confidence: 0.4,
      confidenceDimensions: {
        identity: 0.9,
        price: 0,
        officialSpecs: 0,
        reviews: 0,
        negativeSignals: 0,
        personalizedPrice: 0,
      },
      title: '와이드뷰 QWGE43UT1',
      summary: '가격 검증 필요',
      reasons: [],
      strengths: [],
      weaknesses: [],
      missingInformation: ['가격'],
      evidence: [],
      sourceCount: 0,
    },
  };
}

test('category recommendation enters Shopping Intelligence before exact-product resolution', async () => {
  let shoppingCalls = 0;
  let cloudCalls = 0;
  const result = await runAgentResearch({ query: '50만원 이하 43인치 4K 이동식 TV 가성비 추천해줘' }, {
    publicSearch: async () => { throw new Error('legacy resolver must not run'); },
    cloudResearch: async () => {
      cloudCalls += 1;
      throw new Error('legacy exact research must not run');
    },
    shoppingResearch: async () => {
      shoppingCalls += 1;
      return shoppingResult();
    },
  });

  assert.equal(shoppingCalls, 1);
  assert.equal(cloudCalls, 0);
  assert.equal(result.shopping?.stage, 'COMPLETE');
  assert.equal(result.shopping?.progress.normalizedCandidates, 24);
  assert.equal(result.product.ambiguous, false);
});

test('exact model price request preserves the legacy exact-product path', async () => {
  let shoppingCalls = 0;
  let cloudCalls = 0;
  const query = '와이드뷰 QWGE43UT1 + EKWBYME78W(V3)의 현재 가격을 조사해줘';
  const result = await runAgentResearch({ query }, {
    publicSearch: async () => [{
      title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동식 TV',
      url: 'https://example.com/qwge43ut1-v3',
      snippet: '정확 모델',
    }],
    cloudResearch: async () => {
      cloudCalls += 1;
      return exactJob(query);
    },
    shoppingResearch: async () => {
      shoppingCalls += 1;
      return shoppingResult();
    },
  });

  assert.equal(cloudCalls, 1);
  assert.equal(shoppingCalls, 0);
  assert.equal(result.jobId, 'exact-job');
  assert.equal(result.shopping, undefined);
});

test('an explicit URL always preserves exact-product verification', async () => {
  let shoppingCalls = 0;
  let cloudCalls = 0;
  const query = '이 43인치 이동식 TV 추천할 만한지 조사해줘';
  await runAgentResearch({ query, url: 'https://example.com/product/123' }, {
    publicSearch: async () => [{ title: '브랜드 MODEL123 이동식 TV', url: 'https://example.com/product/123', snippet: 'MODEL123' }],
    cloudResearch: async () => {
      cloudCalls += 1;
      return exactJob(query);
    },
    shoppingResearch: async () => {
      shoppingCalls += 1;
      return shoppingResult();
    },
  });

  assert.equal(cloudCalls, 1);
  assert.equal(shoppingCalls, 0);
});
