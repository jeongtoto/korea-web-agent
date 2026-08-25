import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMarketOffer,
  isAlternativeConditionOffer,
  isDecisiveCashOffer,
  rankMarketOffers,
} from '../src/core/offer-engine.ts';
import type { MarketOffer, NormalizedTarget, PurchaseContext } from '../src/core/types.ts';

const target: NormalizedTarget = {
  kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', variant: '43인치',
  name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지',
};
const at = '2026-08-24T00:00:00.000Z';

function reliableOffer(overrides: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: 'verified:https://example.com/product',
    market: '검증몰',
    title: `${target.name} 신품`,
    url: 'https://example.com/product',
    currency: 'KRW',
    retrievedAt: at,
    verification: 'page_verified',
    condition: 'new',
    identityScore: 1,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    bundleComplete: true,
    eligible: true,
    salePrice: 407200,
    shippingFee: 0,
    totalCashPrice: 407200,
    availability: 'in_stock',
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: 'page_verified',
    },
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
    ...overrides,
  };
}

function markPageVerified(offer: MarketOffer): MarketOffer {
  return {
    ...offer,
    verification: 'page_verified',
    identityVerdict: offer.condition === 'new' || offer.condition === 'unknown' ? 'exact' : 'same_except_condition',
    constraintStatus: 'eligible',
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: 'page_verified',
    },
  };
}

test('normalizes KREAM card price without confusing it with unconditional cash', () => {
  const offer = buildMarketOffer({
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 세트',
    url: 'https://kream.co.kr/products/123',
    snippet: '구매가 407,200원 삼성카드 결제 시 390,000원 무료배송',
  }, target, at);

  assert.ok(offer);
  assert.equal(offer.market, 'KREAM');
  assert.equal(offer.salePrice, 407200);
  assert.equal(offer.cardPrice, 390000);
  assert.equal(offer.cardName, '삼성카드');
  assert.equal(offer.totalCashPrice, 407200);
  assert.ok(offer.conditions.some((value) => value.includes('삼성카드')));
});

test('keeps Naver points-adjusted value separate from cash paid', () => {
  const offer = buildMarketOffer({
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지',
    url: 'https://view.shoppinglive.naver.com/lives/1985890',
    snippet: '판매가 499,000원 최대 적립 106,650원 무료배송',
  }, target, at);

  assert.ok(offer);
  assert.equal(offer.salePrice, 499000);
  assert.equal(offer.points, 106650);
  assert.equal(offer.totalCashPrice, 499000);
  assert.equal(offer.effectivePrice, 392350);
});

test('ranks verified cash, owned card, points and alternative condition independently', () => {
  const context: PurchaseContext = { ownedCards: ['삼성카드'] };
  const raw = [
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://search.shopping.naver.com/catalog/1', snippet: '최저가 449,000원 무료배송' }, target, at),
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://kream.co.kr/products/1', snippet: '구매가 407,200원 삼성카드 결제 시 390,000원 무료배송' }, target, at),
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://view.shoppinglive.naver.com/lives/1', snippet: '판매가 499,000원 최대 적립 106,650원 무료배송' }, target, at),
    buildMarketOffer({ title: `${target.name} 반품`, url: 'https://www.coupang.com/vp/products/2', snippet: '반품 상품 296,140원 무료배송' }, target, at),
  ].filter((value): value is MarketOffer => Boolean(value));
  const offers = raw.map(markPageVerified);

  const result = rankMarketOffers(offers, context);
  assert.equal(result.bestOffers.cash?.offer.market, 'KREAM');
  assert.equal(result.bestOffers.cash?.amount, 407200);
  assert.equal(result.bestOffers.ownedCard?.amount, 390000);
  assert.equal(result.bestOffers.effective?.amount, 392350);
  assert.equal(result.bestOffers.alternativeCondition?.amount, 296140);
});

test('does not let a non-owned card or incomplete bundle win primary rankings', () => {
  const offers = [
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://kream.co.kr/products/1', snippet: '구매가 407,200원 신한카드 결제 시 350,000원 무료배송' }, target, at),
    buildMarketOffer({ title: '와이드뷰 QWGE43UT1 TV 단품', url: 'https://widevu.co.kr/product/1', snippet: 'TV 단품 399,000원 배송비 20,000원' }, target, at),
  ].filter((value): value is MarketOffer => Boolean(value)).map(markPageVerified);

  const result = rankMarketOffers(offers, { ownedCards: ['삼성카드'] });
  assert.equal(result.bestOffers.ownedCard, undefined);
  assert.equal(offers[1]?.bundleComplete, false);
  assert.equal(offers[1]?.eligible, false);
});

test('search-metadata-only price cannot become a decisive cash winner', () => {
  const offer = reliableOffer({
    verification: 'search_metadata',
    fieldVerification: {
      identity: 'search_metadata',
      price: 'search_metadata',
      shipping: 'search_metadata',
    },
  });
  assert.equal(isDecisiveCashOffer(offer), false);
  assert.equal(rankMarketOffers([offer]).bestOffers.cash, undefined);
});

test('missing required bundle identity, unknown shipping, failed hard constraint and out-of-stock offers cannot win cash', () => {
  const traps: MarketOffer[] = [
    reliableOffer({ id: 'body-only', identityVerdict: 'uncertain', bundleComplete: false }),
    reliableOffer({ id: 'shipping-unknown', shippingFee: undefined, totalCashPrice: undefined, fieldVerification: { identity: 'page_verified', price: 'page_verified', shipping: 'unverified' } }),
    reliableOffer({ id: 'constraint-failed', constraintStatus: 'excluded' }),
    reliableOffer({ id: 'stock-ended', availability: 'out_of_stock' }),
  ];

  assert.ok(traps.every((offer) => isDecisiveCashOffer(offer) === false));
  assert.equal(rankMarketOffers(traps).bestOffers.cash, undefined);
});

test('same-except-condition refurbished offer is allowed only as a verified alternative', () => {
  const refurb = reliableOffer({
    condition: 'refurbished',
    identityVerdict: 'same_except_condition',
    salePrice: 296140,
    totalCashPrice: 296140,
    eligible: false,
  });

  assert.equal(isDecisiveCashOffer(refurb), false);
  assert.equal(isAlternativeConditionOffer(refurb), true);
  const result = rankMarketOffers([refurb]);
  assert.equal(result.bestOffers.cash, undefined);
  assert.equal(result.bestOffers.alternativeCondition?.amount, 296140);
});

test('search-metadata return/refurb offer cannot enter alternativeCondition', () => {
  const returnOffer = reliableOffer({
    condition: 'open_box',
    identityVerdict: 'same_except_condition',
    verification: 'search_metadata',
    totalCashPrice: 296140,
    eligible: false,
    fieldVerification: {
      identity: 'search_metadata',
      price: 'search_metadata',
      shipping: 'search_metadata',
    },
  });

  assert.equal(isAlternativeConditionOffer(returnOffer), false);
  assert.equal(rankMarketOffers([returnOffer]).bestOffers.alternativeCondition, undefined);
});