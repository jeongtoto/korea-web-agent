import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from '../src/orchestrator/research.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';

const exactUrl = 'https://www.compuzone.co.kr/product/product_detail.htm?ProductNo=1333822';
const question = '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반 새상품 현재 가격과 배송비 포함 실결제가를 검증해줘';

function exactPage(): DirectPageResult {
  return {
    url: exactUrl,
    title: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반',
    product: {
      name: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반 새상품',
      brand: '크로스오버',
      sku: '27QAW99',
      model: '27QAW99',
      offers: {
        price: 198000,
        currency: 'KRW',
        availability: 'InStock',
        shippingFee: 0,
      },
    },
    facts: {
      name: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반 새상품',
      brand: '크로스오버',
      sku: '27QAW99',
      model: '27QAW99',
      price: 198000,
      shippingFee: 0,
      availability: 'InStock',
    },
    evidence: [],
  };
}

function titleOnlyExactPage(): DirectPageResult {
  return {
    url: exactUrl,
    title: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반',
    product: {
      name: '크로스오버 27QAW99',
      brand: '크로스오버',
      sku: '27QAW99',
      model: '27QAW99',
      offers: {
        price: 198000,
        currency: 'KRW',
        availability: 'InStock',
        shippingFee: 0,
      },
    },
    facts: {
      name: '크로스오버 27QAW99',
      brand: '크로스오버',
      sku: '27QAW99',
      model: '27QAW99',
      price: 198000,
      shippingFee: 0,
      availability: 'InStock',
    },
    evidence: [],
  };
}

async function research(page: DirectPageResult) {
  return runResearch({
    question,
    url: exactUrl,
    category: 'product',
    includeLocalRelay: false,
  }, {
    directPage: async () => page,
    publicSearch: async () => [],
    relayClient: null,
    now: () => new Date('2026-09-06T04:10:00.000Z'),
    idFactory: () => 'direct-seller-regression',
  }, {
    resolvedTarget: {
      kind: 'product',
      brand: '크로스오버',
      model: '27QAW99',
      name: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반',
      canonicalUrl: exactUrl,
    },
    identityConfidence: 0.95,
    resolutionAmbiguous: false,
  });
}

test('direct exact seller page preserves shipping and graduates verified cash offer', async () => {
  const job = await research(exactPage());
  const cash = job.report?.bestOffers?.cash;

  assert.ok(cash, 'exact direct seller page should produce a decisive cash offer');
  assert.equal(cash.amount, 198000);
  assert.equal(cash.offer.totalCashPrice, 198000);
  assert.equal(cash.offer.shippingFee, 0);
  assert.equal(cash.offer.fieldVerification?.identity, 'page_verified');
  assert.equal(cash.offer.fieldVerification?.price, 'page_verified');
  assert.equal(cash.offer.fieldVerification?.shipping, 'page_verified');
});

test('exact page title alone cannot graduate a generic price-scoped structured product', async () => {
  const job = await research(titleOnlyExactPage());

  assert.equal(job.report?.bestOffers?.cash, undefined);
  const directOffer = job.report?.offers?.find((offer) => offer.url === exactUrl);
  if (directOffer) {
    assert.notEqual(directOffer.identityVerdict, 'exact');
    assert.notEqual(directOffer.fieldVerification?.price, 'page_verified');
  }
});
