import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import type { DiscoveryCandidate, MarketProviderContext } from '../src/providers/market-provider.ts';
import { danawaProvider } from '../src/providers/markets/danawa.ts';
import { expandAndVerifySellers } from '../src/providers/seller-expansion.ts';
import { createVerificationCache } from '../src/providers/verification-cache.ts';

const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  variant: '43인치 V3',
  name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};
const canonicalIdentity = compileCanonicalIdentity(
  target,
  '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
);
const comparisonUrl = 'https://prod.danawa.com/info/?pcode=500';
const sellerUrl = 'https://www.11st.co.kr/products/500';
const candidate: DiscoveryCandidate = {
  providerId: 'danawa',
  market: '다나와',
  title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
  url: comparisonUrl,
  snippet: '가격비교',
  discoveredAt: '2026-08-27T00:00:00.000Z',
};

function exactComparisonPage(): DirectPageResult {
  return {
    url: comparisonUrl,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지 가격비교',
    facts: { name: 'QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지', model: 'QWGE43UT1' },
    sellerLinks: [],
    embeddedSellerRecords: [],
    evidence: [],
  };
}

function exactSellerPage(): DirectPageResult {
  return {
    url: sellerUrl,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      offers: { price: 409000, currency: 'KRW', availability: 'InStock', shippingFee: 0 },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      price: 409000,
      availability: 'InStock',
      shippingFee: 0,
    },
    evidence: [],
  };
}

test('exact fallback search enters ordinary seller-page verification only when comparison resolution yields no seller', async () => {
  let searchCalls = 0;
  let sellerFetches = 0;
  const context: MarketProviderContext = {
    target,
    canonicalIdentity,
    constraints: [],
    publicSearch: async (query) => {
      searchCalls += 1;
      assert.match(query, /QWGE43UT1/i);
      assert.match(query, /EKWBYME78W/i);
      assert.match(query, /V3/i);
      return [{
        title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 신품 패키지 365,400원',
        url: sellerUrl,
        snippet: '365,400원',
      }];
    },
    directPage: async (url) => {
      if (url === comparisonUrl) return exactComparisonPage();
      if (url === sellerUrl) {
        sellerFetches += 1;
        return exactSellerPage();
      }
      throw new Error(`unexpected URL ${url}`);
    },
    now: () => new Date('2026-08-27T00:00:00.000Z'),
  };

  const offers = await expandAndVerifySellers(
    danawaProvider,
    candidate,
    context,
    createVerificationCache<DirectPageResult>(),
  );

  assert.equal(searchCalls, 1);
  assert.equal(sellerFetches, 1);
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.salePrice, 409000);
  assert.equal(offers[0]?.totalCashPrice, 409000);
  assert.equal(offers[0]?.verificationTrace?.resolutionMethod, 'fallback_search');
  assert.equal(offers[0]?.verificationTrace?.comparisonAdvertisedPrice, undefined);
});
