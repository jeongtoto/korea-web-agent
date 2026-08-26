import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { rankMarketOffers } from '../src/core/offer-engine.ts';
import { ssgProvider } from '../src/providers/markets/ssg.ts';
import { lotteonProvider } from '../src/providers/markets/lotteon.ts';
import { himartProvider } from '../src/providers/markets/himart.ts';
import { officialProvider } from '../src/providers/markets/official.ts';
import { isVerifiedOfficialDomain } from '../src/providers/official-domain.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import type { DiscoveryCandidate, MarketProvider, MarketProviderContext } from '../src/providers/market-provider.ts';

const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};
const canonical = compileCanonicalIdentity(target, '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지');
const now = () => new Date('2026-08-26T00:00:00.000Z');

function context(page: DirectPageResult, overrideTarget = target): MarketProviderContext {
  return {
    target: overrideTarget,
    canonicalIdentity: compileCanonicalIdentity(overrideTarget, '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지'),
    constraints: [],
    publicSearch: async () => [],
    directPage: async () => page,
    now,
  };
}

function candidate(provider: MarketProvider, url: string, title = '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지'): DiscoveryCandidate {
  return {
    providerId: provider.id,
    market: provider.market,
    title,
    url,
    snippet: '판매중',
    discoveredAt: now().toISOString(),
  };
}

function exactPage(
  url: string,
  options: {
    price?: number;
    shippingFee?: number;
    attributes?: Record<string, string | number | boolean>;
  } = {},
): DirectPageResult {
  const price = options.price ?? 399000;
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      offers: {
        price,
        currency: 'KRW',
        availability: 'InStock',
        ...(options.shippingFee !== undefined ? { shippingFee: options.shippingFee } : {}),
      },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      price,
      availability: 'InStock',
      ...(options.shippingFee !== undefined ? { shippingFee: options.shippingFee } : {}),
      ...(options.attributes ? { attributes: options.attributes } : {}),
    },
    evidence: [],
  };
}

test('SSG unresolved store pickup or delivery condition leaves total cash unresolved', async () => {
  const url = 'https://www.ssg.com/item/itemView.ssg?itemId=100001';
  const page = exactPage(url, {
    attributes: { fulfillmentCondition: 'store_or_delivery_unresolved' },
  });
  const ctx = context(page);
  const verified = await ssgProvider.verify(candidate(ssgProvider, url), ctx);
  const offer = await ssgProvider.extractOffer(verified, ctx);

  assert.equal(offer?.salePrice, 399000);
  assert.equal(offer?.totalCashPrice, undefined);
  assert.equal(offer?.eligible, false);
  assert.equal(rankMarketOffers(offer ? [offer] : []).bestOffers.cash, undefined);
});

test('LotteON known mandatory delivery fee is included in total cash', async () => {
  const url = 'https://www.lotteon.com/p/product/LO123';
  const page = exactPage(url, { shippingFee: 20000 });
  const ctx = context(page);
  const verified = await lotteonProvider.verify(candidate(lotteonProvider, url), ctx);
  const offer = await lotteonProvider.extractOffer(verified, ctx);

  assert.equal(offer?.salePrice, 399000);
  assert.equal(offer?.shippingFee, 20000);
  assert.equal(offer?.totalCashPrice, 419000);
  assert.equal(rankMarketOffers(offer ? [offer] : []).bestOffers.cash?.amount, 419000);
});

test('Hi-Mart known mandatory installation fee is included in total cash', async () => {
  const url = 'https://www.e-himart.co.kr/app/goods/goodsDetail?goodsNo=123';
  const page = exactPage(url, {
    shippingFee: 0,
    attributes: { installationRequired: true, installationFee: 30000 },
  });
  const ctx = context(page);
  const verified = await himartProvider.verify(candidate(himartProvider, url), ctx);
  const offer = await himartProvider.extractOffer(verified, ctx);

  assert.equal(offer?.installationFee, 30000);
  assert.equal(offer?.totalCashPrice, 429000);
  assert.equal(rankMarketOffers(offer ? [offer] : []).bestOffers.cash?.amount, 429000);
});

test('unknown mandatory installation fee blocks decisive cash ranking', async () => {
  const url = 'https://www.e-himart.co.kr/app/goods/goodsDetail?goodsNo=124';
  const page = exactPage(url, {
    shippingFee: 0,
    attributes: { installationRequired: true, installationFeeUnknown: true },
  });
  const ctx = context(page);
  const verified = await himartProvider.verify(candidate(himartProvider, url), ctx);
  const offer = await himartProvider.extractOffer(verified, ctx);

  assert.equal(offer?.totalCashPrice, undefined);
  assert.equal(offer?.eligible, false);
  assert.ok(offer?.exclusionReasons.includes('installation:unknown'));
  assert.equal(rankMarketOffers(offer ? [offer] : []).bestOffers.cash, undefined);
});

test('official domain verification requires a resolved official host; title text containing 공식 is not enough', async () => {
  const officialTarget = {
    ...target,
    sourceHost: 'wideview.co.kr',
    canonicalUrl: 'https://wideview.co.kr/products/qwge43ut1',
  };
  assert.equal(isVerifiedOfficialDomain('https://wideview.co.kr/store/qwge43ut1', officialTarget), true);
  assert.equal(isVerifiedOfficialDomain('https://market.example.com/wideview-official', officialTarget), false);

  const fakeUrl = 'https://market.example.com/wideview-official';
  const page = exactPage(fakeUrl, { shippingFee: 0 });
  page.title = '와이드뷰 공식 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지';
  const ctx = context(page, officialTarget);
  const verified = await officialProvider.verify(
    candidate(officialProvider, fakeUrl, page.title),
    ctx,
  );
  const offer = await officialProvider.extractOffer(verified, ctx);
  assert.equal(offer, null);
});
