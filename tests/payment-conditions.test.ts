import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketOffer, rankMarketOffers } from '../src/core/offer-engine.ts';
import type { MarketOffer, NormalizedTarget } from '../src/core/types.ts';

const target: NormalizedTarget = {
  kind: 'product',
  brand: '와이드뷰',
  name: '와이드뷰 QWGE43UT1 이동형 패키지',
  model: 'QWGE43UT1',
};

function offer(snippet: string): MarketOffer {
  const built = buildMarketOffer({
    title: '와이드뷰 QWGE43UT1 이동형 패키지 새상품',
    url: 'https://brand.naver.com/example/products/1',
    snippet,
  }, target, '2026-08-24T09:00:00.000Z');
  assert.ok(built);
  built.shippingFee ??= 0;
  if (built.totalCashPrice === undefined && built.salePrice !== undefined) built.totalCashPrice = built.salePrice;
  return built;
}

function verifiedPaymentOffer(snippet: string): MarketOffer {
  const built = offer(snippet);
  return {
    ...built,
    verification: 'page_verified',
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    eligible: true,
    bundleComplete: true,
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: 'page_verified',
      payment: 'page_verified',
    },
  };
}

test('extracts wallet payment services as conditional payment methods', () => {
  const cases = [
    ['토스페이 결제 혜택가 369,000원 판매가 389,000원 무료배송', '토스페이'],
    ['카카오페이 결제 시 371,000원 판매가 389,000원 무료배송', '카카오페이'],
    ['네이버페이 결제 적용가 374,000원 판매가 389,000원 무료배송', '네이버페이'],
  ] as const;

  for (const [snippet, method] of cases) {
    const built = offer(snippet);
    assert.equal(built.paymentMethod, method);
    assert.ok(typeof built.paymentPrice === 'number');
    assert.equal(built.verification, 'search_metadata');
  }
});

test('ranks the best verified conditional payment even without a saved user card profile', () => {
  const toss = verifiedPaymentOffer('토스페이 결제 혜택가 369,000원 판매가 389,000원 무료배송');
  const kakao = verifiedPaymentOffer('카카오페이 결제 혜택가 375,000원 판매가 389,000원 무료배송');
  const ranked = rankMarketOffers([kakao, toss], {});

  assert.equal(ranked.bestOffers.conditionalPayment?.amount, 369000);
  assert.equal(ranked.bestOffers.conditionalPayment?.offer.paymentMethod, '토스페이');
});