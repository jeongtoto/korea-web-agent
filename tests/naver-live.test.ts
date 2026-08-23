import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasManualVerificationChallenge,
  parseNaverLiveDeal,
  selectNaverLiveProductCard,
  type NaverLiveProductCard,
} from '../src/relay/naver-live.ts';
import type { RelayProductHint } from '../src/relay/protocol.ts';

const liveUrl = 'https://view.shoppinglive.naver.com/lives/1985890';

const cards: NaverLiveProductCard[] = [
  {
    locatorIndex: 0,
    title: '와이드무빙뷰 화이트에디션 삼탠바이미V3 셋트 QLED 81cm(32인치) FHD 스마트 이동식 TV 359,000원',
    destinationUrl: 'https://product.shoppinglive.naver.com/bridge/v4/product/shopping?productId=32-v3',
  },
  {
    locatorIndex: 1,
    title: '와이드무빙뷰 화이트에디션 삼탠바이미V3 셋트 QLED 101cm(40인치) FHD 스마트 이동식 TV 419,000원',
    destinationUrl: 'https://product.shoppinglive.naver.com/bridge/v4/product/shopping?productId=40-v3',
  },
  {
    locatorIndex: 2,
    title: '와이드무빙뷰 화이트에디션 삼탠바이미V3 셋트 QLED 109cm(43인치) UHD 4K 스마트 이동식 TV 720,000원 30% 할인 499,000원 무료배송',
    destinationUrl: 'https://product.shoppinglive.naver.com/bridge/v4/product/shopping?productId=43-v3',
  },
  {
    locatorIndex: 3,
    title: '와이드무빙뷰 유무선 삼탠바이미 V3-Air 배터리 셋트 QLED 81cm(32인치) FHD 스마트 이동식 TV 399,000원',
    destinationUrl: 'https://product.shoppinglive.naver.com/bridge/v4/product/shopping?productId=32-v3-air',
  },
  {
    locatorIndex: 4,
    title: '와이드무빙뷰 화이트에디션 삼탠바이미 셋트 109cm(43인치) UHD 4K 스마트 이동식 TV 중소바이미 V1 459,000원',
    destinationUrl: 'https://product.shoppinglive.naver.com/bridge/v4/product/shopping?productId=43-v1',
  },
];

const hint: RelayProductHint = {
  brand: '와이드뷰',
  name: '와이드무빙뷰 화이트에디션 삼탠바이미V3 셋트 QLED 109cm(43인치) UHD 4K 스마트 이동식 TV',
  model: 'QWGE43UT1',
  variant: 'EKWBYME78W(V3) 43인치',
  liveId: '1985890',
};

test('selects the unique 43-inch V3 UHD card and rejects neighboring variants', () => {
  assert.deepEqual(selectNaverLiveProductCard(cards, hint), cards[2]);
});

test('refuses ambiguous duplicate candidates instead of guessing a product', () => {
  assert.equal(selectNaverLiveProductCard([...cards, { ...cards[2]!, locatorIndex: 5 }], hint), null);
});

test('refuses weak model-only hints when the model code is absent from every card', () => {
  assert.equal(selectNaverLiveProductCard(cards, { model: 'QWGE43UT1' }), null);
});

test('treats V3-Air, V1, size, and resolution disagreements as explicit conflicts', () => {
  const airOnly = cards.filter((card) => card.locatorIndex === 3);
  const v1Only = cards.filter((card) => card.locatorIndex === 4);
  const fhdOnly = cards.filter((card) => card.locatorIndex === 1);
  assert.equal(selectNaverLiveProductCard(airOnly, hint), null);
  assert.equal(selectNaverLiveProductCard(v1Only, hint), null);
  assert.equal(selectNaverLiveProductCard(fhdOnly, hint), null);
});

test('parses summary sale price and explicit total points without inventing a cash payment price', () => {
  const detailText = `
    할인 전 가격 720,000원
    30% 할인 499,000원
    최대 적립 포인트 106,650원
    라인프렌즈 카드 최대 19,960원 추가 적립(4%)
    네이버 배송 무료배송
  `;
  const result = parseNaverLiveDeal(liveUrl, `${cards[2]!.title}\n${detailText}`, {
    title: cards[2]!.title,
    sourceUrl: 'https://product.shoppinglive.naver.com/products/11458011168',
  });

  assert.deepEqual(result, {
    title: cards[2]!.title,
    listPrice: 720000,
    salePrice: 499000,
    totalExpectedPoints: 106650,
    estimatedPoints: 106650,
    shippingFee: 0,
    dealType: 'naver_shopping_live',
    liveId: '1985890',
    sourceUrl: 'https://product.shoppinglive.naver.com/products/11458011168',
  });
  assert.equal('cashPaymentPrice' in result, false);
  assert.equal('effectivePrice' in result, false);
});

test('keeps explicit checkout cash payment and points-based effective price semantics', () => {
  const result = parseNaverLiveDeal(liveUrl, `
    상품금액 720,000원
    판매자 즉시할인 -221,000원
    쿠폰할인(알림받기쿠폰) -59,880원
    카드사 결제할인(보유카드 기준) -21,960원
    최대할인가 417,160원
    최대 적립 포인트 64,200원
    무료배송
  `);

  assert.deepEqual(result, {
    listPrice: 720000,
    sellerInstantDiscount: 221000,
    couponDiscount: 59880,
    cardInstantDiscount: 21960,
    couponPrice: 439120,
    cashPaymentPrice: 417160,
    salePrice: 417160,
    totalExpectedPoints: 64200,
    estimatedPoints: 64200,
    effectivePrice: 352960,
    shippingFee: 0,
    dealType: 'naver_shopping_live',
    liveId: '1985890',
  });
});

test('detects CAPTCHA and manual-verification pages without attempting a bypass', () => {
  assert.equal(hasManualVerificationChallenge('보안문자를 입력해 주세요'), true);
  assert.equal(hasManualVerificationChallenge('자동입력 방지를 위한 CAPTCHA 확인'), true);
  assert.equal(hasManualVerificationChallenge('정상적인 네이버 쇼핑라이브 상품 페이지'), false);
});
