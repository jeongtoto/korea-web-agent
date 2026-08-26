import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { rankMarketOffers } from '../src/core/offer-engine.ts';
import { elevenstProvider } from '../src/providers/markets/elevenst.ts';
import { gmarketProvider } from '../src/providers/markets/gmarket.ts';
import { auctionProvider } from '../src/providers/markets/auction.ts';
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

const cases: Array<{ provider: MarketProvider; url: string; market: string }> = [
  { provider: elevenstProvider, url: 'https://www.11st.co.kr/products/777?option=V3', market: '11번가' },
  { provider: gmarketProvider, url: 'https://item.gmarket.co.kr/Item?goodscode=777&option=V3', market: 'G마켓' },
  { provider: auctionProvider, url: 'https://itempage3.auction.co.kr/DetailView.aspx?itemno=777&option=V3', market: '옥션' },
];

function context(page: DirectPageResult): MarketProviderContext {
  return {
    target,
    canonicalIdentity: canonical,
    constraints: [],
    publicSearch: async () => [],
    directPage: async () => page,
    now,
  };
}

function candidate(provider: MarketProvider, url: string): DiscoveryCandidate {
  return {
    providerId: provider.id,
    market: provider.market,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    url,
    snippet: '판매가 399,000원 무료배송 재고있음',
    discoveredAt: now().toISOString(),
  };
}

function exactPage(url: string): DirectPageResult {
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      offers: { price: 399000, currency: 'KRW', availability: 'InStock', shippingFee: 0 },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      price: 399000,
      availability: 'InStock',
      shippingFee: 0,
    },
    sellerInfo: { name: '공식 판매자', productId: '777', canonicalUrl: url },
    evidence: [],
  };
}

test('11st Gmarket and Auction verify exact seller SKU, public cash, shipping and availability independently', async () => {
  for (const entry of cases) {
    const page = exactPage(entry.url);
    const ctx = context(page);
    const verified = await entry.provider.verify(candidate(entry.provider, entry.url), ctx);
    const offer = await entry.provider.extractOffer(verified, ctx);

    assert.equal(verified.identity.verdict, 'exact');
    assert.equal(offer?.market, entry.market);
    assert.equal(offer?.sellerInfo?.name, '공식 판매자');
    assert.equal(offer?.sellerInfo?.productId, '777');
    assert.equal(offer?.salePrice, 399000);
    assert.equal(offer?.shippingFee, 0);
    assert.equal(offer?.availability, 'InStock');
    assert.equal(offer?.eligible, true);
    assert.equal(rankMarketOffers(offer ? [offer] : []).bestOffers.cash?.amount, 399000);
  }
});

test('public payment condition stays separate from unconditional 399000 cash price', async () => {
  const entry = cases[0]!;
  const page = exactPage(entry.url);
  page.promotion = {
    type: 'instant_discount',
    active: true,
    accountRequired: false,
    condition: '토스페이 결제 시 379,000원',
  };
  const ctx = context(page);
  const verified = await entry.provider.verify(candidate(entry.provider, entry.url), ctx);
  const offer = await entry.provider.extractOffer(verified, ctx);
  const ranked = rankMarketOffers(offer ? [offer] : []);

  assert.equal(offer?.salePrice, 399000);
  assert.equal(offer?.paymentPrice, 379000);
  assert.equal(offer?.paymentMethod, '토스페이');
  assert.equal(offer?.promotion?.accountRequired, false);
  assert.equal(ranked.bestOffers.cash?.amount, 399000);
  assert.equal(ranked.bestOffers.publicConditional?.amount, 379000);
});

test('account-only coupon is excluded from public economics while base cash remains usable', async () => {
  const entry = cases[1]!;
  const page = exactPage(entry.url);
  page.promotion = {
    type: 'public_coupon',
    active: true,
    accountRequired: true,
    condition: '로그인 후 쿠폰가 359,000원',
  };
  const ctx = context(page);
  const verified = await entry.provider.verify(candidate(entry.provider, entry.url), ctx);
  const offer = await entry.provider.extractOffer(verified, ctx);
  const ranked = rankMarketOffers(offer ? [offer] : []);

  assert.equal(offer?.salePrice, 399000);
  assert.equal(offer?.couponPrice, undefined);
  assert.equal(offer?.promotion, undefined);
  assert.equal(ranked.bestOffers.cash?.amount, 399000);
  assert.equal(ranked.bestOffers.publicConditional, undefined);
});
