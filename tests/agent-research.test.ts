import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentResearch, shapeAgentResearchJob, type AgentResearchDependencies } from '../src/agent/research.ts';
import type { ResearchContext, ResearchJob, ResearchRequest } from '../src/core/types.ts';

const discoveryHits = [
  {
    title: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드',
    url: 'https://brand.naver.com/widevu/products/11458011168',
    snippet: '와이드뷰 V3 43인치 UHD 4K 스탠드',
  },
  {
    title: '와이드뷰 V3 43인치 UHD 4K 이동식 TV 후기',
    url: 'https://blog.naver.com/reviewer/223000000000',
    snippet: '와이드뷰 V3 43인치 실사용 후기',
  },
];

function fakeJob(request: ResearchRequest, context: ResearchContext): ResearchJob {
  const target = context.resolvedTarget ?? { kind: 'unknown' as const };
  return {
    id: 'agent-job-1',
    status: request.includeLocalRelay ? 'running' : 'completed',
    request,
    createdAt: '2026-08-18T11:00:00.000Z',
    updatedAt: '2026-08-18T11:00:01.000Z',
    target,
    researchContext: context,
    sourceResults: [
      { source: 'naver-shopping', success: true, attemptedAt: '2026-08-18T11:00:00.000Z', completedAt: '2026-08-18T11:00:01.000Z', evidence: [] },
    ],
    evidence: [],
    relay: request.includeLocalRelay
      ? { available: true, used: false, mode: 'public_only', message: 'waiting' }
      : { available: false, used: false, mode: 'public_only', message: 'public only' },
    errors: [],
    report: {
      decision: 'INSUFFICIENT',
      confidence: 0.58,
      confidenceDimensions: { identity: context.identityConfidence ?? 0, price: 0, officialSpecs: 0.5, reviews: 0.4, negativeSignals: 0.2, personalizedPrice: 0 },
      title: target.name ?? '제품 분석',
      summary: '가격 확인 대기',
      reasons: [],
      strengths: [],
      weaknesses: [],
      missingInformation: ['현재 가격 확인 필요'],
      evidence: [],
      sourceCount: 1,
    },
  };
}

function dependencies(observed: Array<{ request: ResearchRequest; context: ResearchContext }>): AgentResearchDependencies {
  return {
    publicSearch: async () => discoveryHits,
    cloudResearch: async (request, context) => {
      observed.push({ request, context });
      return fakeJob(request, context);
    },
  };
}

test('query-only purchase evaluation resolves the product and automatically requests eligible local relay', async () => {
  const observed: Array<{ request: ResearchRequest; context: ResearchContext }> = [];
  const result = await runAgentResearch({ query: '와이드뷰 43인치 4K V3 스탠드 어때?' }, dependencies(observed));

  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.request.includeLocalRelay, true);
  assert.match(observed[0]?.request.url ?? '', /naver\.com/);
  assert.equal(observed[0]?.context.intent?.purchaseDecision, true);
  assert.ok((observed[0]?.context.identityConfidence ?? 0) >= 0.7);
  assert.match(observed[0]?.context.resolvedTarget?.name ?? '', /와이드뷰.*V3|V3.*와이드뷰/i);

  assert.equal(result.status, 'running');
  assert.equal(result.jobId, 'agent-job-1');
  assert.equal(result.pollUrl, '/api/agent/job?jobId=agent-job-1');
  assert.equal(result.product.ambiguous, false);
  assert.equal(result.relay.requested, true);
});

test('purchase evaluation finds a relay-eligible seller when the resolved canonical URL is not relay eligible', async () => {
  const observed: Array<{ request: ResearchRequest; context: ResearchContext }> = [];
  const searchQueries: string[] = [];
  const result = await runAgentResearch({
    query: '와이드뷰 QWGE43UT1 43인치 이동형 패키지 지금 사도 되는지 가격 쿠폰 멤버십까지 조사해줘',
  }, {
    publicSearch: async (query) => {
      searchQueries.push(query);
      if (searchQueries.length === 1) {
        return [{
          title: '와이드뷰 QWGE43UT1 43인치 V3 이동형 패키지',
          url: 'https://item.gmarket.co.kr/Item?goodsCode=4521501632',
          snippet: 'QWGE43UT1 EKWBYME78W V3 43인치',
        }];
      }
      return [{
        title: '와이드뷰 QWGE43UT1 43인치 V3 이동형 패키지',
        url: 'https://www.coupang.com/vp/products/1234567890',
        snippet: 'QWGE43UT1 EKWBYME78W V3 43인치',
      }];
    },
    cloudResearch: async (request, context) => {
      observed.push({ request, context });
      return fakeJob(request, context);
    },
  });

  assert.ok(searchQueries.length >= 2);
  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.request.includeLocalRelay, true);
  assert.match(observed[0]?.request.url ?? '', /coupang\.com/);
  assert.equal(result.relay.requested, true);
});

test('spec-only product question resolves product but does not request PC relay', async () => {
  const observed: Array<{ request: ResearchRequest; context: ResearchContext }> = [];
  const result = await runAgentResearch({ query: '와이드뷰 V3 43인치 패널 스펙 알려줘' }, dependencies(observed));

  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.request.includeLocalRelay, false);
  assert.equal(observed[0]?.context.intent?.specOnly, true);
  assert.equal(result.relay.requested, false);
  assert.equal(result.status, 'completed');
});

test('ambiguous query refuses broad exact-product research and returns INSUFFICIENT immediately', async () => {
  let cloudCalls = 0;
  const result = await runAgentResearch({ query: '43인치 4K 스마트모니터 어때?' }, {
    publicSearch: async () => [
      { title: '삼성 M7 43인치 4K 스마트모니터', url: 'https://example.com/m7', snippet: '43인치 4K' },
      { title: 'LG MyView 43인치 4K 스마트모니터', url: 'https://example.com/myview', snippet: '43인치 4K' },
    ],
    cloudResearch: async () => { cloudCalls += 1; throw new Error('must not run'); },
  });

  assert.equal(cloudCalls, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.decision, 'INSUFFICIENT');
  assert.equal(result.product.ambiguous, true);
  assert.ok(result.product.candidates.length >= 2);
});

test('shapeAgentResearchJob exposes a compact source-attributed result without secret-bearing fields', () => {
  const context: ResearchContext = {
    intent: { productResearch: true, purchaseDecision: true, priceSensitive: true, personalizedPriceUseful: true, specOnly: false },
    identityConfidence: 0.93,
    resolvedTarget: {
      kind: 'product', brand: '와이드뷰', name: '와이드뷰 43인치 4K V3 스탠드', model: 'V3', variant: '43인치',
      canonicalUrl: 'https://brand.naver.com/widevu/products/11458011168', productId: '11458011168', sourceHost: 'brand.naver.com',
    },
  };
  const shaped = shapeAgentResearchJob(fakeJob({
    question: '와이드뷰 43인치 4K V3 스탠드 어때?',
    url: context.resolvedTarget?.canonicalUrl,
    category: 'product',
    includeLocalRelay: true,
  }, context));

  const serialized = JSON.stringify(shaped).toLowerCase();
  assert.equal(serialized.includes('relay_secret'), false);
  assert.equal(serialized.includes('cookie'), false);
  assert.equal(serialized.includes('password'), false);
  assert.equal(shaped.product.identityConfidence, 0.93);
  assert.equal(shaped.decision, 'INSUFFICIENT');
  assert.ok('sourceCoverage' in shaped);
});
