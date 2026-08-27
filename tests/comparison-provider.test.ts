import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { rankMarketOffers } from '../src/core/offer-engine.ts';
import { createVerificationCache } from '../src/providers/verification-cache.ts';
import { expandAndVerifySellers } from '../src/providers/seller-expansion.ts';
import { danawaProvider } from '../src/providers/markets/danawa.ts';
import { enuriProvider } from '../src/providers/markets/enuri.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import type { DiscoveryCandidate, MarketProviderContext } from '../src/providers/market-provider.ts';

const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};
const canonical = compileCanonicalIdentity(target, '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지');
const now = () => new Date('2026-08-26T00:00:00.000Z');

function comparisonCandidate(providerId: 'danawa' | 'enuri', url: string): DiscoveryCandidate {
  return {
    providerId,
    market: providerId === 'danawa' ? '다나와' : '에누리',
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    url,
    snippet: '가격비교',
    discoveredAt: now().toISOString(),
  };
}

function comparisonPage(url: string, sellerUrl: string, advertisedPrice: number): DirectPageResult {
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지 가격비교',
    facts: { name: 'QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지', model: 'QWGE43UT1' },
    sellerLinks: [{ url: sellerUrl, sellerName: '판매자A', productId: 'seller-1', advertisedPrice }],
    evidence: [],
  };
}

function sellerPage(url: string, price: number, shippingFee?: number): DirectPageResult {
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      offers: { price, currency: 'KRW', availability: 'InStock', ...(shippingFee !== undefined ? { shippingFee } : {}) },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰', model: 'QWGE43UT1', price, availability: 'InStock',
      ...(shippingFee !== undefined ? { shippingFee } : {}),
    },
    evidence: [],
  };
}

function context(directPage: MarketProviderContext['directPage']): MarketProviderContext {
  return {
    target,
    canonicalIdentity: canonical,
    constraints: [],
    publicSearch: async () => [],
    directPage,
    now,
  };
}

test('Danawa advertised 449000 becomes decisive only after downstream exact seller verifies free shipping', async () => {
  const comparisonUrl = 'https://prod.danawa.com/info/?pcode=123';
  const sellerUrl = 'https://www.11st.co.kr/products/1?option=V3';
  const ctx = context(async (url) => url.includes('danawa.com')
    ? comparisonPage(comparisonUrl, sellerUrl, 449000)
    : sellerPage(sellerUrl, 449000, 0));

  const offers = await expandAndVerifySellers(
    danawaProvider,
    comparisonCandidate('danawa', comparisonUrl),
    ctx,
    createVerificationCache<DirectPageResult>(),
  );

  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.market, '11번가');
  assert.equal(offers[0]?.salePrice, 449000);
  assert.equal(offers[0]?.shippingFee, 0);
  assert.equal(offers[0]?.totalCashPrice, 449000);
  assert.deepEqual(offers[0]?.sellerInfo?.discoveredBy, ['danawa']);
  assert.equal(rankMarketOffers(offers).bestOffers.cash?.amount, 449000);
});

test('Danawa advertised 439000 never becomes decisive when downstream seller shipping is unknown', async () => {
  const comparisonUrl = 'https://prod.danawa.com/info/?pcode=124';
  const sellerUrl = 'https://www.11st.co.kr/products/2?option=V3';
  const ctx = context(async (url) => url.includes('danawa.com')
    ? comparisonPage(comparisonUrl, sellerUrl, 439000)
    : sellerPage(sellerUrl, 439000));

  const offers = await expandAndVerifySellers(
    danawaProvider,
    comparisonCandidate('danawa', comparisonUrl),
    ctx,
    createVerificationCache<DirectPageResult>(),
  );

  assert.equal(offers[0]?.salePrice, 439000);
  assert.equal(offers[0]?.shippingFee, undefined);
  assert.equal(offers[0]?.totalCashPrice, undefined);
  assert.equal(offers[0]?.eligible, false);
  assert.equal(rankMarketOffers(offers).bestOffers.cash, undefined);
});

test('Danawa and Enuri expansion to the same downstream seller shares one request-scoped verification fetch', async () => {
  const sellerUrl = 'https://www.11st.co.kr/products/3?option=V3';
  let sellerFetches = 0;
  const directPage = async (url: string): Promise<DirectPageResult> => {
    if (url.includes('danawa.com')) return comparisonPage(url, sellerUrl, 449000);
    if (url.includes('enuri.com')) return comparisonPage(url, sellerUrl, 449000);
    sellerFetches += 1;
    return sellerPage(sellerUrl, 449000, 0);
  };
  const ctx = context(directPage);
  const cache = createVerificationCache<DirectPageResult>();

  const [danawaOffers, enuriOffers] = await Promise.all([
    expandAndVerifySellers(danawaProvider, comparisonCandidate('danawa', 'https://prod.danawa.com/info/?pcode=125'), ctx, cache),
    expandAndVerifySellers(enuriProvider, comparisonCandidate('enuri', 'https://www.enuri.com/detail.jsp?modelno=125'), ctx, cache),
  ]);

  assert.equal(sellerFetches, 1);
  assert.equal(danawaOffers[0]?.salePrice, 449000);
  assert.equal(enuriOffers[0]?.salePrice, 449000);
});

test('comparison page with non-exact canonical identity does not expand downstream sellers', async () => {
  const comparisonUrl = 'https://prod.danawa.com/info/?pcode=126';
  const sellerUrl = 'https://www.11st.co.kr/products/4?option=V3';
  let sellerFetches = 0;
  const ctx = context(async (url) => {
    if (url.includes('danawa.com')) {
      return {
        url: comparisonUrl,
        title: '와이드뷰 QWGE43UT1 43인치 TV 본체 단품 가격비교',
        facts: { name: 'QWGE43UT1 43인치 TV 본체 단품', model: 'QWGE43UT1' },
        sellerLinks: [{ url: sellerUrl, sellerName: '판매자A', productId: 'seller-4', advertisedPrice: 399000 }],
        evidence: [],
      };
    }
    sellerFetches += 1;
    return sellerPage(sellerUrl, 399000, 0);
  });

  const offers = await expandAndVerifySellers(
    danawaProvider,
    comparisonCandidate('danawa', comparisonUrl),
    ctx,
    createVerificationCache<DirectPageResult>(),
  );

  assert.equal(sellerFetches, 0);
  assert.deepEqual(offers, []);
});

test('embedded-only Danawa seller enters downstream exact seller verification', async () => {
  const comparisonUrl = 'https://prod.danawa.com/info/?pcode=127';
  const sellerUrl = 'https://www.11st.co.kr/products/5?option=V3';
  let sellerFetches = 0;
  const ctx = context(async (url) => {
    if (url.includes('danawa.com')) {
      return {
        url: comparisonUrl,
        title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지 가격비교',
        facts: { name: 'QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지', model: 'QWGE43UT1' },
        sellerLinks: [],
        embeddedSellerRecords: [{
          url: sellerUrl,
          sellerName: '판매자B',
          productId: 'seller-5',
          advertisedPrice: 409000,
        }],
        evidence: [],
      };
    }
    sellerFetches += 1;
    return sellerPage(sellerUrl, 409000, 0);
  });

  const offers = await expandAndVerifySellers(
    danawaProvider,
    comparisonCandidate('danawa', comparisonUrl),
    ctx,
    createVerificationCache<DirectPageResult>(),
  );

  assert.equal(sellerFetches, 1);
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.salePrice, 409000);
  assert.equal(offers[0]?.totalCashPrice, 409000);
  assert.equal(offers[0]?.verificationTrace?.resolutionMethod, 'embedded_metadata');
  assert.equal(offers[0]?.verificationTrace?.comparisonAdvertisedPrice, 409000);
});

test('comparison bridge URL is resolved to the final seller before direct verification', async () => {
  const comparisonUrl = 'https://prod.danawa.com/info/?pcode=128';
  const bridgeUrl = 'https://prod.danawa.com/bridge?id=seller-6';
  const sellerUrl = 'https://www.11st.co.kr/products/6?option=V3';
  let bridgePageFetches = 0;
  let sellerPageFetches = 0;
  const base = context(async (url) => {
    if (url === comparisonUrl) return comparisonPage(comparisonUrl, bridgeUrl, 399000);
    if (url === bridgeUrl) {
      bridgePageFetches += 1;
      return { url, title: 'bridge', evidence: [] };
    }
    if (url === sellerUrl) {
      sellerPageFetches += 1;
      return sellerPage(sellerUrl, 399000, 0);
    }
    throw new Error(`unexpected URL ${url}`);
  });
  const ctx = {
    ...base,
    resolveSellerRedirect: async (url: string) => ({
      originalUrl: url,
      resolvedUrl: sellerUrl,
      hops: [url, sellerUrl],
      status: 'resolved' as const,
    }),
  };

  const offers = await expandAndVerifySellers(
    danawaProvider,
    comparisonCandidate('danawa', comparisonUrl),
    ctx,
    createVerificationCache<DirectPageResult>(),
  );

  assert.equal(bridgePageFetches, 0);
  assert.equal(sellerPageFetches, 1);
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.url, sellerUrl);
  assert.equal(offers[0]?.verificationTrace?.resolutionMethod, 'redirect_resolution');
  assert.equal(offers[0]?.verificationTrace?.originalSellerUrl, bridgeUrl);
  assert.equal(offers[0]?.verificationTrace?.resolvedSellerUrl, sellerUrl);
});

test('comparison bridge that does not redirect is never verified as a seller page', async () => {
  const comparisonUrl = 'https://prod.danawa.com/info/?pcode=129';
  const bridgeUrl = 'https://prod.danawa.com/bridge?id=seller-7';
  let bridgePageFetches = 0;
  const base = context(async (url) => {
    if (url === comparisonUrl) return comparisonPage(comparisonUrl, bridgeUrl, 365400);
    if (url === bridgeUrl) {
      bridgePageFetches += 1;
      return sellerPage(bridgeUrl, 365400, 0);
    }
    throw new Error(`unexpected URL ${url}`);
  });
  const ctx = {
    ...base,
    resolveSellerRedirect: async (url: string) => ({
      originalUrl: url,
      hops: [url],
      status: 'not_redirect' as const,
    }),
  };

  const offers = await expandAndVerifySellers(
    danawaProvider,
    comparisonCandidate('danawa', comparisonUrl),
    ctx,
    createVerificationCache<DirectPageResult>(),
  );

  assert.equal(bridgePageFetches, 0, 'comparison-domain bridge must not be fetched as a seller after not_redirect');
  assert.deepEqual(offers, []);
  assert.equal(rankMarketOffers(offers).bestOffers.cash, undefined);
});