import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeSellerUrl, deduplicateSellerOffers } from '../src/providers/offer-dedupe.ts';
import type { MarketOffer } from '../src/core/types.ts';

function offer(overrides: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: '11st:item-1',
    market: '11번가',
    title: 'QWGE43UT1 + EKWBYME78W(V3) 신품',
    url: 'https://www.11st.co.kr/products/1?option=V3&utm_source=danawa',
    currency: 'KRW',
    retrievedAt: '2026-08-26T00:00:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 1,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    bundleComplete: true,
    eligible: true,
    salePrice: 399000,
    shippingFee: 0,
    totalCashPrice: 399000,
    sellerInfo: {
      name: '판매자A',
      productId: '1',
      canonicalUrl: 'https://www.11st.co.kr/products/1?option=V3',
      discoveredBy: ['danawa'],
    },
    fieldVerification: { identity: 'page_verified', price: 'page_verified', shipping: 'page_verified' },
    conditions: [], riskFlags: [], exclusionReasons: [],
    ...overrides,
  };
}

test('canonical seller URL removes fragments and known trackers but preserves product option parameters', () => {
  assert.equal(
    canonicalizeSellerUrl('https://www.11st.co.kr/products/1?option=V3&utm_source=x&NaPm=y&n_rank=1#reviews'),
    'https://www.11st.co.kr/products/1?option=V3',
  );
});

test('same seller product discovered by Naver Danawa and Enuri becomes one economic offer', () => {
  const values = [
    offer({ sellerInfo: { name: '판매자A', productId: '1', canonicalUrl: 'https://www.11st.co.kr/products/1?option=V3', discoveredBy: ['naver-shopping'] } }),
    offer({ id: 'danawa-copy', url: 'https://www.11st.co.kr/products/1?option=V3&utm_source=danawa', sellerInfo: { name: '판매자A', productId: '1', canonicalUrl: 'https://www.11st.co.kr/products/1?option=V3&utm_source=danawa', discoveredBy: ['danawa'] } }),
    offer({ id: 'enuri-copy', url: 'https://www.11st.co.kr/products/1?option=V3&n_query=x', sellerInfo: { name: '판매자A', productId: '1', canonicalUrl: 'https://www.11st.co.kr/products/1?option=V3&n_query=x', discoveredBy: ['enuri'] } }),
  ];
  const result = deduplicateSellerOffers(values);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]?.sellerInfo?.discoveredBy?.sort(), ['danawa', 'enuri', 'naver-shopping']);
});

test('different seller product id or condition remains separate', () => {
  const result = deduplicateSellerOffers([
    offer(),
    offer({ id: 'item-2', sellerInfo: { name: '판매자A', productId: '2', canonicalUrl: 'https://www.11st.co.kr/products/2?option=V3', discoveredBy: ['naver-shopping'] }, url: 'https://www.11st.co.kr/products/2?option=V3' }),
    offer({ id: 'open-box', condition: 'open_box', identityVerdict: 'same_except_condition', eligible: false }),
  ]);
  assert.equal(result.length, 3);
});

test('weaker duplicate may add provenance but cannot overwrite stronger verified economics', () => {
  const strong = offer();
  const weak = offer({
    id: 'weak',
    verification: 'search_metadata',
    identityVerdict: 'uncertain',
    eligible: false,
    salePrice: 350000,
    shippingFee: undefined,
    totalCashPrice: undefined,
    fieldVerification: { identity: 'search_metadata', price: 'search_metadata', shipping: 'unverified' },
    sellerInfo: { name: '판매자A', productId: '1', canonicalUrl: 'https://www.11st.co.kr/products/1?option=V3', discoveredBy: ['enuri'] },
  });
  const [merged] = deduplicateSellerOffers([strong, weak]);
  assert.equal(merged?.verification, 'page_verified');
  assert.equal(merged?.identityVerdict, 'exact');
  assert.equal(merged?.salePrice, 399000);
  assert.equal(merged?.shippingFee, 0);
  assert.deepEqual(merged?.sellerInfo?.discoveredBy?.sort(), ['danawa', 'enuri']);
});
