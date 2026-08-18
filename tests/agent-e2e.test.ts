import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentResearch } from '../src/agent/research.ts';
import { runResearch, createDefaultResearchDependencies } from '../src/orchestrator/research.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';

const PRODUCT_URL = 'https://brand.naver.com/widevu/products/11458011168';

const discovery = [
  {
    title: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드 11458011168',
    url: PRODUCT_URL,
    snippet: '와이드뷰 V3 43인치 UHD 4K 스탠드',
  },
  {
    title: '와이드뷰 V3 43인치 UHD 4K 이동식 TV 후기 11458011168',
    url: 'https://blog.naver.com/reviewer/wideview-v3-11458011168',
    snippet: '와이드뷰 V3 43인치 실사용 후기',
  },
];

function directPage(): DirectPageResult {
  return {
    url: PRODUCT_URL,
    title: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드',
    product: {
      name: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드',
      brand: '와이드뷰',
      sku: 'V3',
      offers: { price: 439120, currency: 'KRW' },
    },
    evidence: [{
      claim: '와이드뷰 43인치 4K V3 / 현재 판매가 439,120원',
      sourceUrl: PRODUCT_URL,
      sourceType: 'json_ld_product',
      retrievedAt: '2026-08-18T11:00:00.000Z',
      acquisitionMethod: 'structured_data',
      evidenceClass: 'retailer_listing',
      independenceKey: 'wideview-direct',
      confidence: 0.82,
      specificity: 'exact_product',
      data: { product: { name: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드', brand: '와이드뷰', offers: { price: 439120, currency: 'KRW' } } },
    }],
  };
}

function search(query: string) {
  if (query.includes('site:blog.naver.com')) return [{
    title: '와이드뷰 V3 43인치 11458011168 장기 사용 만족 추천',
    url: 'https://blog.naver.com/reviewer/positive-wideview-11458011168',
    snippet: '화면이 선명하고 이동이 편리해서 만족한다는 장기 사용 후기',
  }];
  if (query.includes('site:youtube.com')) return [{
    title: '와이드뷰 V3 43인치 11458011168 실사용 리뷰',
    url: 'https://youtube.com/watch?v=wideview11458011168',
    snippet: '가성비가 좋고 사용이 편리해 추천한다는 장기 리뷰',
  }];
  if (query.includes('site:danawa.com')) return [{
    title: '와이드뷰 V3 43인치 11458011168 439,120원 특가',
    url: 'https://prod.danawa.com/info/?pcode=11458011168',
    snippet: '현재 439,120원 할인 특가',
  }];
  if (query.includes('KCL') || query.includes('KC 생활용품')) return [{
    title: 'KCL 안전인증 KC 생활용품',
    url: 'https://www.kcl.re.kr/kc',
    snippet: '일반 제품 안전성 시험검사 안내',
  }];
  if (!query.includes('site:')) return discovery;
  return [];
}

test('WideView purchase question resolves exact product, uses authenticated relay, rejects unrelated evidence and reaches BUY with explicit price/review signals', async () => {
  let relayExtractCalls = 0;
  const result = await runAgentResearch({ query: '와이드뷰 43인치 4K V3 스탠드 어때?' }, {
    publicSearch: async (query) => search(query),
    cloudResearch: async (request, context) => runResearch(request, createDefaultResearchDependencies({
      directPage: async () => directPage(),
      publicSearch: async (query) => search(query),
      academicSearch: async () => [],
      relayClient: {
        isAvailable: async () => true,
        extract: async () => {
          relayExtractCalls += 1;
          return {
            currency: 'KRW',
            salePrice: 439120,
            couponPrice: 399000,
            membershipPrice: 409000,
            estimatedPoints: 12000,
            shippingFee: 0,
            shippingEta: '2026-08-20',
          };
        },
      },
      now: () => new Date('2026-08-18T11:00:00.000Z'),
      idFactory: () => 'wideview-e2e',
    }), context),
  });

  assert.equal(result.product.ambiguous, false);
  assert.equal(result.product.productId, '11458011168');
  assert.equal(result.product.model?.toUpperCase(), 'V3');
  assert.match(result.product.variant ?? '', /43/);
  assert.equal(result.relay.requested, true);
  assert.equal(result.relay.used, true);
  assert.equal(relayExtractCalls, 1);
  assert.equal(result.personalizedPrice?.couponPrice, 399000);
  assert.equal(result.decision, 'BUY');
  assert.ok(result.confidence < 0.97);
  assert.equal(result.evidence.some((item) => item.sourceUrl.includes('kcl.re.kr')), false);
});

test('WideView specification-only question resolves the same product without opening authenticated relay', async () => {
  let relayExtractCalls = 0;
  const result = await runAgentResearch({ query: '와이드뷰 V3 43인치 패널 스펙 알려줘' }, {
    publicSearch: async (query) => search(query),
    cloudResearch: async (request, context) => runResearch(request, createDefaultResearchDependencies({
      directPage: async () => directPage(),
      publicSearch: async (query) => search(query),
      academicSearch: async () => [],
      relayClient: {
        isAvailable: async () => true,
        extract: async () => { relayExtractCalls += 1; return { currency: 'KRW', membershipPrice: 409000 }; },
      },
      now: () => new Date('2026-08-18T11:00:00.000Z'),
      idFactory: () => 'wideview-spec-e2e',
    }), context),
  });

  assert.equal(result.product.ambiguous, false);
  assert.equal(result.intent.specOnly, true);
  assert.equal(result.relay.requested, false);
  assert.equal(result.relay.used, false);
  assert.equal(relayExtractCalls, 0);
});
