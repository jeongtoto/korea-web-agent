import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { researchProviderSource } from '../src/orchestrator/provider-pipeline.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import type { SourceQuery } from '../src/providers/source-plan.ts';

const source: SourceQuery = {
  id: 'naver-shopping',
  query: 'QWGE43UT1 EKWBYME78W V3 네이버 쇼핑',
  sourceType: 'naver_shopping',
  evidenceClass: 'retailer_listing',
  specificity: 'exact_product',
  maxHits: 5,
  market: '네이버',
};

const canonical = compileCanonicalIdentity(
  { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1' },
  '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
);

const now = () => new Date('2026-08-25T06:30:00.000Z');

function page(overrides: Partial<DirectPageResult> = {}): DirectPageResult {
  return {
    url: 'https://brand.naver.com/widevu/products/1',
    title: 'QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지 신품',
    product: {
      name: 'QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지 신품',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      offers: { price: 389550, currency: 'KRW', availability: 'InStock', shippingFee: 0 },
    },
    evidence: [],
    ...overrides,
  };
}

test('body-only discovery cannot become an eligible V3 bundle offer', async () => {
  const result = await researchProviderSource({
    source,
    target: { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1' },
    canonicalIdentity: canonical,
    constraints: [],
    publicSearch: async () => [{
      title: '와이드뷰 QWGE43UT1 43인치 TV 본체만 349,000원',
      url: 'https://brand.naver.com/widevu/products/body',
      snippet: 'QWGE43UT1 신품 본체 단품',
    }],
    directPage: async () => page({
      url: 'https://brand.naver.com/widevu/products/body',
      title: '와이드뷰 QWGE43UT1 43인치 신품 본체만',
      product: { name: '와이드뷰 QWGE43UT1 43인치 신품 본체만', sku: 'QWGE43UT1', offers: { price: 349000, currency: 'KRW', shippingFee: 0 } },
    }),
    now,
  });

  assert.equal(result.offers.some((offer) => offer.eligible), false);
  assert.equal(result.attempt.identity.uncertain, 1);
  assert.equal(result.attempt.status, 'found_unverified');
});

test('exact bundle candidate is direct-fetched and exact page creates page_verified eligible offer', async () => {
  let fetched = 0;
  const result = await researchProviderSource({
    source,
    target: { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1' },
    canonicalIdentity: canonical,
    constraints: [],
    publicSearch: async () => [{
      title: 'QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지 389,550원',
      url: 'https://brand.naver.com/widevu/products/1',
      snippet: '무료배송',
    }],
    directPage: async () => { fetched += 1; return page(); },
    now,
  });

  assert.equal(fetched, 1);
  const verified = result.offers.find((offer) => offer.verification === 'page_verified');
  assert.ok(verified);
  assert.equal(verified?.eligible, true);
  assert.equal(verified?.shippingFee, 0);
  assert.equal(verified?.totalCashPrice, 389550);
  assert.equal(result.attempt.verification.succeeded, 1);
  assert.equal(result.attempt.status, 'verified');
});

test('search snippet price is retained as preliminary market data and never a decisive offer', async () => {
  const result = await researchProviderSource({
    source,
    target: { kind: 'product', model: 'QWGE43UT1', name: 'QWGE43UT1 EKWBYME78W V3 43인치 패키지' },
    canonicalIdentity: canonical,
    constraints: [],
    publicSearch: async () => [{
      title: 'QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지 299,000원',
      url: 'https://example.com/deal',
      snippet: '판매가 299,000원 무료배송',
    }],
    directPage: async () => { throw new Error('403 bot blocked by site policy'); },
    now,
  });

  const preliminary = result.offers.find((offer) => offer.verification === 'search_metadata');
  assert.ok(preliminary);
  assert.equal(preliminary?.salePrice, 299000);
  assert.equal(preliminary?.shippingFee, 0);
  assert.equal(preliminary?.eligible, false);
  assert.ok(preliminary?.exclusionReasons.includes('search_metadata_requires_page_verification'));
  assert.ok(result.evidence.some((item) => item.acquisitionMethod === 'search_metadata'));
  assert.equal(result.attempt.verification.failed, 1);
  assert.equal(result.attempt.failureKind, 'blocked_by_site');
  assert.equal(result.attempt.status, 'failed');
});