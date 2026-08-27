import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import type { DiscoveryCandidate, MarketProviderContext, SellerCandidate } from '../src/providers/market-provider.ts';
import { danawaProvider } from '../src/providers/markets/danawa.ts';

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

  const expanded = await danawaProvider.expandSellers?.(candidate, context);
  assert.equal(expanded?.length, 0);
  assert.equal(searchCalls, 0, 'comparison expansion must not hide fallback discovery inside itself');

  const fallback = await danawaProvider.fallbackSellers?.(candidate, context);
  assert.equal(searchCalls, 1);
  assert.equal(fallback?.length, 1);
  assert.equal(fallback?.[0]?.resolutionMethod, 'fallback_search');
  assert.equal(fallback?.[0]?.advertisedPrice, undefined, 'search snippet price must stay discovery-only');

  const verified = await danawaProvider.verify(fallback?.[0] as SellerCandidate, context);
  const offer = await danawaProvider.extractOffer(verified, context);

  assert.equal(sellerFetches, 1);
  assert.equal(offer?.salePrice, 409000);
  assert.equal(offer?.totalCashPrice, 409000);
  assert.equal(offer?.verificationTrace?.resolutionMethod, 'fallback_search');
  assert.equal(offer?.verificationTrace?.comparisonAdvertisedPrice, undefined);
});
