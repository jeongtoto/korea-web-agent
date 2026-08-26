import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import {
  MANDATORY_FEE_STATUSES,
  SELLER_RESOLUTION_METHODS,
} from '../src/core/types.ts';
import type {
  MarketOffer,
  SellerVerificationTrace,
} from '../src/core/types.ts';
import { fetchDirectPage, type DirectPageResult } from '../src/providers/direct-page.ts';
import type { SellerCandidate } from '../src/providers/market-provider.ts';
import { verifiedSellerOfferFromPage } from '../src/providers/seller-expansion.ts';

test('seller resolution and mandatory fee contracts expose stable runtime values', () => {
  assert.deepEqual(SELLER_RESOLUTION_METHODS, [
    'static_link',
    'embedded_metadata',
    'redirect_resolution',
    'fallback_search',
  ]);
  assert.deepEqual(MANDATORY_FEE_STATUSES, [
    'required',
    'not_applicable',
    'unknown',
  ]);
});

test('seller verification trace fields remain backward-compatible optional contracts', () => {
  const trace: SellerVerificationTrace = {
    resolutionMethod: 'embedded_metadata',
    originalSellerUrl: 'https://prod.danawa.com/bridge?id=1',
    resolvedSellerUrl: 'https://seller.example/item/1',
    mandatoryFeeStatus: 'not_applicable',
    rejectionReasons: [],
    retrievedAt: '2026-08-27T00:00:00.000Z',
  };

  const candidate: SellerCandidate = {
    providerId: 'danawa',
    discoveredFrom: ['danawa'],
    sellerUrl: 'https://seller.example/item/1',
    resolutionMethod: 'embedded_metadata',
    originalSellerUrl: 'https://prod.danawa.com/bridge?id=1',
    verificationTrace: trace,
  };

  const offer: MarketOffer = {
    id: 'seller:item-1',
    market: 'seller.example',
    title: 'Exact product',
    url: 'https://seller.example/item/1',
    currency: 'KRW',
    retrievedAt: '2026-08-27T00:00:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 1,
    bundleComplete: true,
    eligible: true,
    mandatoryFeeStatus: 'not_applicable',
    verificationTrace: trace,
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
  };

  assert.equal(candidate.resolutionMethod, 'embedded_metadata');
  assert.equal(candidate.verificationTrace?.resolvedSellerUrl, 'https://seller.example/item/1');
  assert.equal(offer.mandatoryFeeStatus, 'not_applicable');
  assert.equal(offer.verificationTrace?.resolutionMethod, 'embedded_metadata');
});

const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};
const canonicalIdentity = compileCanonicalIdentity(
  target,
  '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
);
const retrievedAt = '2026-08-27T00:00:00.000Z';

function sellerPage(input: {
  price: number;
  shippingFee?: number;
  mandatoryPurchaseFee?: number;
  mandatoryFeeSignal?: boolean;
  title?: string;
}): DirectPageResult {
  return {
    url: 'https://www.11st.co.kr/products/999',
    title: input.title ?? '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      offers: {
        price: input.price,
        currency: 'KRW',
        availability: 'InStock',
        ...(input.shippingFee !== undefined ? { shippingFee: input.shippingFee } : {}),
      },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      price: input.price,
      availability: 'InStock',
      ...(input.shippingFee !== undefined ? { shippingFee: input.shippingFee } : {}),
      ...(input.mandatoryPurchaseFee !== undefined ? { mandatoryPurchaseFee: input.mandatoryPurchaseFee } : {}),
      ...(input.mandatoryFeeSignal !== undefined ? { mandatoryFeeSignal: input.mandatoryFeeSignal } : {}),
    },
    evidence: [],
  } as DirectPageResult;
}

function graduate(page: DirectPageResult, advertisedPrice = 399000) {
  return verifiedSellerOfferFromPage({
    page,
    target,
    canonicalIdentity,
    constraints: [],
    retrievedAt,
    discoveredBy: ['danawa'],
    verificationTrace: {
      comparisonSource: 'danawa',
      comparisonUrl: 'https://prod.danawa.com/info/?pcode=999',
      resolutionMethod: 'embedded_metadata',
      comparisonAdvertisedPrice: advertisedPrice,
      rejectionReasons: [],
      retrievedAt,
    },
  });
}

test('seller page price overrides cheaper comparison advertised price', () => {
  const offer = graduate(sellerPage({ price: 429000, shippingFee: 0 }), 399000);
  assert.equal(offer?.salePrice, 429000);
  assert.equal(offer?.totalCashPrice, 429000);
  assert.equal(offer?.verificationTrace?.comparisonAdvertisedPrice, 399000);
  assert.equal(offer?.verificationTrace?.sellerVerifiedPrice, 429000);
});

test('known shipping and mandatory purchase fee are included in decisive total', () => {
  const offer = graduate(sellerPage({
    price: 389000,
    shippingFee: 20000,
    mandatoryPurchaseFee: 10000,
    mandatoryFeeSignal: true,
  }));
  assert.equal(offer?.mandatoryFeeStatus, 'required');
  assert.equal(offer?.mandatoryPurchaseFee, 10000);
  assert.equal(offer?.totalCashPrice, 419000);
  assert.equal(offer?.eligible, true);
  assert.equal(offer?.verificationTrace?.mandatoryPurchaseFee, 10000);
  assert.equal(offer?.verificationTrace?.totalCashPrice, 419000);
});

test('mandatory fee signal with unknown amount blocks decisive eligibility', () => {
  const offer = graduate(sellerPage({
    price: 389000,
    shippingFee: 0,
    mandatoryFeeSignal: true,
  }));
  assert.equal(offer?.mandatoryFeeStatus, 'unknown');
  assert.equal(offer?.eligible, false);
  assert.equal(offer?.totalCashPrice, undefined);
  assert.ok(offer?.exclusionReasons.includes('mandatory_fee:unknown'));
  assert.ok(offer?.verificationTrace?.rejectionReasons.includes('mandatory_fee:unknown'));
});

test('direct page extracts one explicit mandatory fulfillment fee but ignores optional installation upsell', async () => {
  const mandatoryHtml = `<!doctype html><html><head><title>상품</title></head><body>
    <div>본 상품 구매 시 필수 설치비 10,000원 별도 부과</div>
  </body></html>`;
  const optionalHtml = `<!doctype html><html><head><title>상품</title></head><body>
    <div>선택 설치 서비스 10,000원 추가 가능</div>
  </body></html>`;
  const fetcher = (html: string) => async () => new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

  const mandatory = await fetchDirectPage('https://seller.example/item/1', fetcher(mandatoryHtml) as typeof fetch);
  const optional = await fetchDirectPage('https://seller.example/item/2', fetcher(optionalHtml) as typeof fetch);

  assert.equal(mandatory.facts?.mandatoryFeeSignal, true);
  assert.equal(mandatory.facts?.mandatoryPurchaseFee, 10000);
  assert.equal(optional.facts?.mandatoryFeeSignal, undefined);
  assert.equal(optional.facts?.mandatoryPurchaseFee, undefined);
});
