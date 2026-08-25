import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgentResearchInput } from '../src/agent/research.ts';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { runResearch, type ResearchDependencies } from '../src/orchestrator/research.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';

const URL = 'https://brand.naver.com/example/products/1234567890';

function page(): DirectPageResult {
  return {
    url: URL,
    title: '테스트 QWGE43UT1 제품',
    product: { name: '테스트 QWGE43UT1 제품', brand: '테스트', sku: 'QWGE43UT1' },
    evidence: [{
      claim: '상품명 테스트 QWGE43UT1 제품',
      sourceUrl: URL,
      sourceType: 'json_ld_product',
      retrievedAt: '2026-08-24T09:00:00.000Z',
      acquisitionMethod: 'structured_data',
      evidenceClass: 'retailer_listing',
      independenceKey: 'test-product',
      confidence: 0.8,
      specificity: 'exact_product',
    }],
  };
}

test('agent input accepts request-scoped wallet names without creating a persistent profile', () => {
  const input = validateAgentResearchInput({
    query: '이 상품 할인 조사',
    purchaseContext: {
      paymentMethods: ['토스페이', '카카오페이', '네이버페이'],
      memberships: ['네이버플러스'],
    },
  });

  assert.deepEqual(input.purchaseContext?.paymentMethods, ['토스페이', '카카오페이', '네이버페이']);
  assert.deepEqual(input.purchaseContext?.memberships, ['네이버플러스']);
});

test('agent input rejects number-like sensitive data in paymentMethods', () => {
  assert.throws(() => validateAgentResearchInput({
    query: '할인 조사',
    purchaseContext: { paymentMethods: ['토스페이 4111 1111 1111 1111'] },
  }), /paymentMethods|numbers|names/i);
});

test('runResearch retries a transient direct-page timeout and preserves the successful provider result', async () => {
  let directAttempts = 0;
  const deps: ResearchDependencies = {
    directPage: async () => {
      directAttempts += 1;
      if (directAttempts < 3) throw new Error('ETIMEDOUT');
      return page();
    },
    publicSearch: async () => [],
    academicSearch: async () => [],
    relayClient: null,
    now: () => new Date('2026-08-24T09:00:00.000Z'),
    idFactory: () => 'retry-integrated',
  };

  const job = await runResearch({ question: '테스트 QWGE43UT1 어때?', url: URL, category: 'product' }, deps);

  assert.equal(directAttempts, 3);
  assert.ok(job.sourceResults.some((source) => source.source === 'direct_page' && source.success));
  assert.equal(job.errors.some((error) => /ETIMEDOUT/.test(error)), false);
});

test('runResearch does not retry authentication failures', async () => {
  let directAttempts = 0;
  const deps: ResearchDependencies = {
    directPage: async () => {
      directAttempts += 1;
      throw new Error('401 Unauthorized');
    },
    publicSearch: async () => [],
    academicSearch: async () => [],
    relayClient: null,
    now: () => new Date('2026-08-24T09:00:00.000Z'),
    idFactory: () => 'auth-no-retry',
  };

  const job = await runResearch({ question: '테스트 QWGE43UT1 어때?', url: URL, category: 'product' }, deps);

  assert.equal(directAttempts, 1);
  assert.ok(job.errors.some((error) => /401 Unauthorized/.test(error)));
});

test('body-only 350000 listing cannot beat page-verified exact V3 bundle at 399000', async () => {
  const bodyUrl = 'https://www.coupang.com/vp/products/35000001';
  const bundleUrl = 'https://brand.naver.com/widevu/products/39900001';
  const question = '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 이동형 패키지 현재 최저가';
  const target = {
    kind: 'product' as const,
    brand: '와이드뷰',
    name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
    model: 'QWGE43UT1',
    variant: 'EKWBYME78W(V3) 43인치',
  };
  const canonicalIdentity = compileCanonicalIdentity(target, question);

  const bodyPage: DirectPageResult = {
    url: bodyUrl,
    title: '와이드뷰 QWGE43UT1 43인치 TV 본체만',
    facts: {
      name: '와이드뷰 QWGE43UT1 43인치 TV 본체만',
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      price: 350000,
      shippingFee: 0,
      availability: 'in_stock',
    },
    product: {
      name: '와이드뷰 QWGE43UT1 43인치 TV 본체만',
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      offers: { price: 350000, currency: 'KRW', shippingFee: 0, availability: 'in_stock' },
    },
    evidence: [],
  };
  const bundlePage: DirectPageResult = {
    url: bundleUrl,
    title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
    facts: {
      name: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      description: 'EKWBYME78W V3 이동형 스탠드 포함 신품 세트',
      price: 399000,
      shippingFee: 0,
      availability: 'in_stock',
    },
    product: {
      name: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      description: 'EKWBYME78W V3 이동형 스탠드 포함',
      offers: { price: 399000, currency: 'KRW', shippingFee: 0, availability: 'in_stock' },
    },
    evidence: [],
  };

  const job = await runResearch({ question, category: 'product' }, {
    directPage: async (requestedUrl) => requestedUrl === bodyUrl ? bodyPage : bundlePage,
    publicSearch: async () => [
      {
        title: '와이드뷰 QWGE43UT1 43인치 TV 본체만 350,000원',
        url: bodyUrl,
        snippet: '본체 단품 350,000원 무료배송',
      },
      {
        title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지 399,000원',
        url: bundleUrl,
        snippet: 'V3 스탠드 포함 신품 세트 399,000원 무료배송',
      },
    ],
    academicSearch: async () => [],
    relayClient: null,
    now: () => new Date('2026-08-25T07:00:00.000Z'),
    idFactory: () => 'exact-v3-bundle-regression',
  }, {
    resolvedTarget: target,
    canonicalIdentity,
    identityConfidence: 0.99,
    intent: {
      productResearch: true,
      purchaseDecision: true,
      priceSensitive: true,
      personalizedPriceUseful: true,
      specOnly: false,
    },
  });

  assert.equal(job.report?.bestOffers?.cash?.amount, 399000);
  const bodyOffer = job.report?.offers?.find((offer) => offer.url === bodyUrl && offer.verification === 'page_verified');
  assert.ok(bodyOffer);
  assert.notEqual(bodyOffer.identityVerdict, 'exact');
  assert.equal(bodyOffer.eligible, false);
  const bundleOffer = job.report?.offers?.find((offer) => offer.url === bundleUrl && offer.verification === 'page_verified');
  assert.equal(bundleOffer?.identityVerdict, 'exact');
  assert.equal(bundleOffer?.eligible, true);
  assert.ok((job.report?.marketCoverage ?? []).reduce((sum, item) => sum + item.verified, 0) >= 1);
});