import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { rankMarketOffers } from '../src/core/offer-engine.ts';
import { normalizePromotion } from '../src/providers/promotion.ts';
import { kakaoTalkDealProvider } from '../src/providers/markets/kakaotalkdeal.ts';
import { tossShoppingProvider } from '../src/providers/markets/toss-shopping.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import type { DiscoveryCandidate, MarketProvider, MarketProviderContext } from '../src/providers/market-provider.ts';

const observedAt = '2026-08-26T00:00:00.000Z';
const now = () => new Date(observedAt);
const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};
const canonical = compileCanonicalIdentity(target, '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지');

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
    snippet: '공개 판매 페이지',
    discoveredAt: observedAt,
  };
}

function exactPage(url: string, price: number, promotion?: DirectPageResult['promotion']): DirectPageResult {
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      offers: { price, currency: 'KRW', availability: 'InStock', shippingFee: 0 },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      price,
      availability: 'InStock',
      shippingFee: 0,
    },
    ...(promotion ? { promotion } : {}),
    evidence: [],
  };
}

async function extract(provider: MarketProvider, page: DirectPageResult) {
  const ctx = context(page);
  const verified = await provider.verify(candidate(provider, page.url), ctx);
  return provider.extractOffer(verified, ctx);
}

test('active unconditional Kakao TalkDeal exact 379000 with free shipping is public cash', async () => {
  const page = exactPage(
    'https://store.kakao.com/wideview/products/777',
    379000,
    normalizePromotion({
      type: 'time_deal',
      startsAt: '2026-08-25T00:00:00.000Z',
      endsAt: '2026-08-27T00:00:00.000Z',
      accountRequired: false,
    }, observedAt),
  );
  const offer = await extract(kakaoTalkDealProvider, page);
  const ranked = rankMarketOffers(offer ? [offer] : []);

  assert.equal(offer?.market, '카카오 톡딜');
  assert.equal(offer?.promotion?.active, true);
  assert.equal(offer?.salePrice, 379000);
  assert.equal(offer?.totalCashPrice, 379000);
  assert.equal(ranked.bestOffers.cash?.amount, 379000);
});

test('expired Kakao TalkDeal remains visible but cannot become a current winner', async () => {
  const page = exactPage(
    'https://store.kakao.com/wideview/products/778',
    379000,
    normalizePromotion({
      type: 'time_deal',
      startsAt: '2026-08-23T00:00:00.000Z',
      endsAt: '2026-08-24T00:00:00.000Z',
      accountRequired: false,
    }, observedAt),
  );
  const offer = await extract(kakaoTalkDealProvider, page);
  const ranked = rankMarketOffers(offer ? [offer] : []);

  assert.equal(offer?.promotion?.active, false);
  assert.equal(offer?.eligible, false);
  assert.equal(ranked.bestOffers.cash, undefined);
  assert.equal(ranked.bestOffers.publicConditional, undefined);
});

test('Kakao public payment condition is publicConditional while friend/account-only deal is neither', async () => {
  const publicPage = exactPage(
    'https://store.kakao.com/wideview/products/779',
    399000,
    normalizePromotion({
      type: 'instant_discount',
      startsAt: '2026-08-25T00:00:00.000Z',
      endsAt: '2026-08-27T00:00:00.000Z',
      condition: '카카오페이 결제 시 379,000원',
      accountRequired: false,
    }, observedAt),
  );
  const publicOffer = await extract(kakaoTalkDealProvider, publicPage);
  const publicRanked = rankMarketOffers(publicOffer ? [publicOffer] : []);
  assert.equal(publicRanked.bestOffers.cash?.amount, 399000);
  assert.equal(publicRanked.bestOffers.publicConditional?.amount, 379000);

  const privatePage = exactPage(
    'https://store.kakao.com/wideview/products/780',
    369000,
    normalizePromotion({
      type: 'instant_discount',
      startsAt: '2026-08-25T00:00:00.000Z',
      endsAt: '2026-08-27T00:00:00.000Z',
      condition: '친구 추가 또는 로그인 계정 전용 369,000원',
      accountRequired: true,
    }, observedAt),
  );
  const privateOffer = await extract(kakaoTalkDealProvider, privatePage);
  const privateRanked = rankMarketOffers(privateOffer ? [privateOffer] : []);
  assert.equal(privateOffer?.eligible, false);
  assert.ok(privateOffer?.exclusionReasons.includes('promotion:account_required'));
  assert.equal(privateRanked.bestOffers.cash, undefined);
  assert.equal(privateRanked.bestOffers.publicConditional, undefined);
});

test('Toss public shareable unconditional exact price is cash and public payment condition is publicConditional', async () => {
  const cashPage = exactPage(
    'https://toss.im/shopping/products/777',
    389000,
    normalizePromotion({ type: 'none' }, observedAt),
  );
  const cashOffer = await extract(tossShoppingProvider, cashPage);
  assert.equal(rankMarketOffers(cashOffer ? [cashOffer] : []).bestOffers.cash?.amount, 389000);

  const paymentPage = exactPage(
    'https://toss.im/shopping/products/778',
    399000,
    normalizePromotion({
      type: 'instant_discount',
      startsAt: '2026-08-25T00:00:00.000Z',
      endsAt: '2026-08-27T00:00:00.000Z',
      condition: '토스페이 결제 시 379,000원',
      accountRequired: false,
    }, observedAt),
  );
  const paymentOffer = await extract(tossShoppingProvider, paymentPage);
  const ranked = rankMarketOffers(paymentOffer ? [paymentOffer] : []);
  assert.equal(ranked.bestOffers.cash?.amount, 399000);
  assert.equal(ranked.bestOffers.publicConditional?.amount, 379000);
});

test('Toss login app or account-state 369000 stays found-unverified economics with no public winner', async () => {
  const page = exactPage(
    'https://toss.im/shopping/products/779',
    369000,
    normalizePromotion({
      type: 'instant_discount',
      startsAt: '2026-08-25T00:00:00.000Z',
      endsAt: '2026-08-27T00:00:00.000Z',
      condition: '토스 앱 로그인 및 계정 상태에 따른 369,000원',
      accountRequired: true,
    }, observedAt),
  );
  const offer = await extract(tossShoppingProvider, page);
  const ranked = rankMarketOffers(offer ? [offer] : []);

  assert.equal(offer?.eligible, false);
  assert.ok(offer?.exclusionReasons.includes('promotion:account_required'));
  assert.equal(ranked.bestOffers.cash, undefined);
  assert.equal(ranked.bestOffers.publicConditional, undefined);
});
