import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketOffer, rankMarketOffers } from '../src/core/offer-engine.ts';
import type { NormalizedTarget, PurchaseContext } from '../src/core/types.ts';

const target: NormalizedTarget = {
  kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', variant: '43인치',
  name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지',
};
const at = '2026-08-24T00:00:00.000Z';

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

test('ranks cash, owned card, points and alternative condition independently', () => {
  const context: PurchaseContext = { ownedCards: ['삼성카드'] };
  const offers = [
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://search.shopping.naver.com/catalog/1', snippet: '최저가 449,000원 무료배송' }, target, at),
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://kream.co.kr/products/1', snippet: '구매가 407,200원 삼성카드 결제 시 390,000원 무료배송' }, target, at),
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://view.shoppinglive.naver.com/lives/1', snippet: '판매가 499,000원 최대 적립 106,650원 무료배송' }, target, at),
    buildMarketOffer({ title: `${target.name} 반품`, url: 'https://www.coupang.com/vp/products/2', snippet: '반품 상품 296,140원 무료배송' }, target, at),
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));

  const result = rankMarketOffers(offers, context);
  assert.equal(result.bestOffers.cash?.offer.market, 'KREAM');
  assert.equal(result.bestOffers.cash?.amount, 407200);
  assert.equal(result.bestOffers.ownedCard?.amount, 390000);
  assert.equal(result.bestOffers.effective?.amount, 392350);
  assert.equal(result.bestOffers.alternativeCondition?.amount, 296140);
});

test('does not let a non-owned card or incomplete bundle win primary rankings', () => {
  const offers = [
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://kream.co.kr/products/1', snippet: '구매가 407,200원 신한카드 결제 시 350,000원' }, target, at),
    buildMarketOffer({ title: '와이드뷰 QWGE43UT1 TV 단품', url: 'https://widevu.co.kr/product/1', snippet: 'TV 단품 399,000원 배송비 20,000원' }, target, at),
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));

  const result = rankMarketOffers(offers, { ownedCards: ['삼성카드'] });
  assert.equal(result.bestOffers.ownedCard, undefined);
  assert.equal(offers[1]?.bundleComplete, false);
  assert.equal(offers[1]?.eligible, false);
});

test('exposes advertised card and pay promotions without claiming ownership', () => {
  const offers = [
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://kream.co.kr/products/10', snippet: '구매가 450,000원 토스페이 결제 시 425,000원 무료배송' }, target, at),
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://search.shopping.naver.com/catalog/10', snippet: '판매가 455,000원 카카오페이 결제 시 430,000원 무료배송' }, target, at),
    buildMarketOffer({ title: `${target.name} 신품`, url: 'https://brand.naver.com/widevu/products/10', snippet: '판매가 460,000원 네이버페이 결제 시 435,000원 무료배송' }, target, at),
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));

  const result = rankMarketOffers(offers, {});
  assert.equal(result.bestOffers.ownedCard, undefined);
  assert.equal(result.bestOffers.advertisedPayment?.amount, 425000);
  assert.equal(result.bestOffers.advertisedPayment?.offer.paymentMethod, '토스페이');
  assert.deepEqual(result.paymentPromotions.map((item) => item.method), ['토스페이', '카카오페이', '네이버페이']);
});

test('returns separate member and non-member effective scenarios only from explicit evidence', () => {
  const offer = buildMarketOffer({
    title: `${target.name} 신품`,
    url: 'https://brand.naver.com/widevu/products/20',
    snippet: '비회원 판매가 499,000원 기본 적립 5,000원 네이버플러스 회원가 479,000원 회원 적립 20,000원 무료배송',
  }, target, at);
  assert.ok(offer);
  const result = rankMarketOffers([offer], {});
  const member = result.membershipScenarios.find((item) => item.member === true);
  const nonMember = result.membershipScenarios.find((item) => item.member === false);
  assert.equal(member?.membership, '네이버플러스');
  assert.equal(member?.paymentPrice, 479000);
  assert.equal(member?.expectedPoints, 20000);
  assert.equal(member?.effectivePrice, 459000);
  assert.equal(nonMember?.paymentPrice, 499000);
  assert.equal(nonMember?.expectedPoints, 5000);
  assert.equal(nonMember?.effectivePrice, 494000);
});

test('captures explicitly stated promotion period without inventing missing dates', () => {
  const offer = buildMarketOffer({
    title: `${target.name} 신품`,
    url: 'https://brand.naver.com/widevu/products/30',
    snippet: '8월 23일 00:00부터 8월 25일 23:59까지 토스페이 결제 시 430,000원 판매가 450,000원 무료배송',
  }, target, at, new Date('2026-08-24T06:00:00.000Z'));
  assert.ok(offer);
  assert.equal(offer.validityStatus, 'active');
  assert.match(offer.startsAt ?? '', /^2026-08-23/);
  assert.match(offer.endsAt ?? '', /^2026-08-25/);
});

test('does not rank expired or upcoming payment promotions as a current best payment method', () => {
  const expired = buildMarketOffer({
    title: `${target.name} 신품`,
    url: 'https://brand.naver.com/widevu/products/31',
    snippet: '8월 20일 00:00부터 8월 23일 23:59까지 토스페이 결제 시 350,000원 판매가 450,000원 무료배송',
  }, target, at, new Date('2026-08-24T06:00:00.000Z'));
  const upcoming = buildMarketOffer({
    title: `${target.name} 신품`,
    url: 'https://brand.naver.com/widevu/products/32',
    snippet: '8월 25일 00:00부터 8월 26일 23:59까지 카카오페이 결제 시 340,000원 판매가 450,000원 무료배송',
  }, target, at, new Date('2026-08-24T06:00:00.000Z'));
  const active = buildMarketOffer({
    title: `${target.name} 신품`,
    url: 'https://brand.naver.com/widevu/products/33',
    snippet: '8월 23일 00:00부터 8월 25일 23:59까지 네이버페이 결제 시 425,000원 판매가 450,000원 무료배송',
  }, target, at, new Date('2026-08-24T06:00:00.000Z'));
  const offers = [expired, upcoming, active].filter((value): value is NonNullable<typeof value> => Boolean(value));
  const result = rankMarketOffers(offers, {});
  assert.equal(expired?.validityStatus, 'expired');
  assert.equal(upcoming?.validityStatus, 'upcoming');
  assert.equal(result.bestOffers.advertisedPayment?.offer.paymentMethod, '네이버페이');
  assert.equal(result.bestOffers.advertisedPayment?.amount, 425000);
});
