import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { rankMarketOffers } from '../src/core/offer-engine.ts';
import { providerFailureKind } from '../src/core/provider-attempt.ts';
import { naverShoppingProvider } from '../src/providers/markets/naver.ts';
import { coupangProvider } from '../src/providers/markets/coupang.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import type { DiscoveryCandidate, MarketProviderContext, SellerCandidate } from '../src/providers/market-provider.ts';

const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};
const canonical = compileCanonicalIdentity(target, '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지');
const now = () => new Date('2026-08-26T00:00:00.000Z');

function ctx(directPage: MarketProviderContext['directPage'], publicSearch: MarketProviderContext['publicSearch'] = async () => []): MarketProviderContext {
  return {
    target,
    canonicalIdentity: canonical,
    constraints: [],
    publicSearch,
    directPage,
    now,
  };
}

function exactSellerPage(url: string, price: number, shippingFee: number): DirectPageResult {
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      offers: { price, currency: 'KRW', availability: 'InStock', shippingFee },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰', model: 'QWGE43UT1', price, availability: 'InStock', shippingFee,
    },
    evidence: [],
  };
}

function discovery(providerId: 'naver-shopping' | 'coupang', market: string, url: string, snippet = ''): DiscoveryCandidate {
  return {
    providerId,
    market,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    url,
    snippet,
    discoveredAt: now().toISOString(),
  };
}

test('Naver Shopping portal expands an exact comparison listing to the downstream seller and ignores the lower portal snippet price', async () => {
  const portalUrl = 'https://shopping.naver.com/catalog/12345';
  const sellerUrl = 'https://smartstore.naver.com/wideview/products/777?option=V3';
  const context = ctx(async (url) => {
    if (url === portalUrl) {
      return {
        url: portalUrl,
        title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
        facts: { name: 'QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지', model: 'QWGE43UT1' },
        sellerLinks: [{ url: sellerUrl, sellerName: '와이드뷰 공식스토어', productId: '777', advertisedPrice: 399000 }],
        evidence: [],
      };
    }
    return exactSellerPage(sellerUrl, 449000, 0);
  });

  const portal = discovery('naver-shopping', '네이버쇼핑', portalUrl, '포털 최저가 399,000원');
  const sellers = await naverShoppingProvider.expandSellers?.(portal, context);
  assert.equal(sellers?.length, 1);
  assert.equal(sellers?.[0]?.advertisedPrice, 399000);

  const verified = await naverShoppingProvider.verify(sellers?.[0] as SellerCandidate, context);
  const offer = await naverShoppingProvider.extractOffer(verified, context);
  assert.equal(offer?.salePrice, 449000);
  assert.equal(offer?.totalCashPrice, 449000);
  assert.equal(rankMarketOffers(offer ? [offer] : []).bestOffers.cash?.amount, 449000);
});

test('Naver comparison bridge resolves to the final seller before page verification', async () => {
  const portalUrl = 'https://shopping.naver.com/catalog/22345';
  const bridgeUrl = 'https://shopping.naver.com/bridge?id=888';
  const sellerUrl = 'https://smartstore.naver.com/wideview/products/888?option=V3';
  let bridgeFetches = 0;
  let sellerFetches = 0;
  const base = ctx(async (url) => {
    if (url === portalUrl) {
      return {
        url: portalUrl,
        title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
        facts: { name: 'QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지', model: 'QWGE43UT1' },
        sellerLinks: [{ url: bridgeUrl, sellerName: '와이드뷰 공식스토어', productId: '888', advertisedPrice: 399000 }],
        evidence: [],
      };
    }
    if (url === bridgeUrl) {
      bridgeFetches += 1;
      return { url, title: 'bridge', evidence: [] };
    }
    if (url === sellerUrl) {
      sellerFetches += 1;
      return exactSellerPage(sellerUrl, 449000, 0);
    }
    throw new Error(`unexpected URL ${url}`);
  });
  const context: MarketProviderContext = {
    ...base,
    resolveSellerRedirect: async (url) => ({
      originalUrl: url,
      resolvedUrl: sellerUrl,
      hops: [url, sellerUrl],
      status: 'resolved',
    }),
  };

  const portal = discovery('naver-shopping', '네이버쇼핑', portalUrl);
  const sellers = await naverShoppingProvider.expandSellers?.(portal, context);
  assert.equal(sellers?.length, 1);
  assert.equal(sellers?.[0]?.sellerUrl, sellerUrl);
  assert.equal(sellers?.[0]?.resolutionMethod, 'redirect_resolution');
  assert.equal(sellers?.[0]?.verificationTrace?.originalSellerUrl, bridgeUrl);

  const verified = await naverShoppingProvider.verify(sellers?.[0] as SellerCandidate, context);
  const offer = await naverShoppingProvider.extractOffer(verified, context);
  assert.equal(bridgeFetches, 0);
  assert.equal(sellerFetches, 1);
  assert.equal(offer?.salePrice, 449000);
  assert.equal(offer?.verificationTrace?.resolvedSellerUrl, sellerUrl);
});

test('Naver exact portal exposes explicit fallback seller discovery without trusting fallback snippet price', async () => {
  const portalUrl = 'https://shopping.naver.com/catalog/32345';
  const sellerUrl = 'https://smartstore.naver.com/wideview/products/999?option=V3';
  let searchCalls = 0;
  const context = ctx(
    async (url) => {
      if (url === portalUrl) {
        return {
          url: portalUrl,
          title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
          facts: { name: 'QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지', model: 'QWGE43UT1' },
          sellerLinks: [],
          embeddedSellerRecords: [],
          evidence: [],
        };
      }
      return exactSellerPage(sellerUrl, 429000, 0);
    },
    async (query) => {
      searchCalls += 1;
      assert.match(query, /QWGE43UT1/i);
      assert.match(query, /EKWBYME78W/i);
      assert.match(query, /V3/i);
      return [{
        title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 365,400원',
        url: sellerUrl,
        snippet: '무료배송 365,400원',
      }];
    },
  );

  const portal = discovery('naver-shopping', '네이버쇼핑', portalUrl, '최저가 365,400원');
  const expanded = await naverShoppingProvider.expandSellers?.(portal, context);
  assert.equal(expanded?.length, 0);
  assert.equal(searchCalls, 0, 'ordinary comparison expansion must not perform fallback discovery');

  const sellers = await naverShoppingProvider.fallbackSellers?.(portal, context);
  assert.equal(searchCalls, 1);
  assert.equal(sellers?.length, 1);
  assert.equal(sellers?.[0]?.resolutionMethod, 'fallback_search');
  assert.equal(sellers?.[0]?.advertisedPrice, undefined);

  const verified = await naverShoppingProvider.verify(sellers?.[0] as SellerCandidate, context);
  const offer = await naverShoppingProvider.extractOffer(verified, context);
  assert.equal(offer?.salePrice, 429000);
  assert.equal(offer?.totalCashPrice, 429000);
  assert.notEqual(offer?.salePrice, 365400);
});

test('Naver Brand and SmartStore exact product pages may verify directly without a comparison hop', async () => {
  for (const url of [
    'https://brand.naver.com/wideview/products/777?option=V3',
    'https://smartstore.naver.com/wideview/products/777?option=V3',
  ]) {
    const context = ctx(async () => exactSellerPage(url, 449000, 0));
    const candidate = discovery('naver-shopping', '네이버쇼핑', url);
    const verified = await naverShoppingProvider.verify(candidate, context);
    const offer = await naverShoppingProvider.extractOffer(verified, context);
    assert.equal(verified.identity.verdict, 'exact');
    assert.equal(offer?.eligible, true);
    assert.equal(offer?.market, '네이버쇼핑');
    assert.equal(offer?.totalCashPrice, 449000);
  }
});

test('Coupang exact public option with known shipping is decisive while account-only WOW economics stay out of the public cash offer', async () => {
  const url = 'https://www.coupang.com/vp/products/777?itemId=888&vendorItemId=999';
  const page = exactSellerPage(url, 449000, 0);
  page.promotion = {
    type: 'instant_discount',
    active: true,
    accountRequired: true,
    condition: 'WOW 회원 전용 399,000원',
  };
  const context = ctx(async () => page);
  const candidate = discovery('coupang', '쿠팡', url, '와우 회원가 399,000원 / 일반 판매가 449,000원');
  const verified = await coupangProvider.verify(candidate, context);
  const offer = await coupangProvider.extractOffer(verified, context);

  assert.equal(offer?.salePrice, 449000);
  assert.equal(offer?.totalCashPrice, 449000);
  assert.equal(offer?.promotion, undefined);
  assert.equal(rankMarketOffers(offer ? [offer] : []).bestOffers.cash?.amount, 449000);
});

test('Coupang HTTP 403 remains a provider-local blocked_by_site failure', async () => {
  const url = 'https://www.coupang.com/vp/products/777';
  const context = ctx(async () => { throw new Error('Page fetch failed with HTTP 403'); });
  const candidate = discovery('coupang', '쿠팡', url);

  let caught: unknown;
  try {
    await coupangProvider.verify(candidate, context);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(providerFailureKind(caught), 'blocked_by_site');
});
