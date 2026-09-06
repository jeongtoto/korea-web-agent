import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import type { NormalizedTarget } from '../src/core/types.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import { verifyDirectSellerCandidate } from '../src/shopping/direct-seller-verifier.ts';

const exactUrl = 'https://www.compuzone.co.kr/product/product_detail.htm?ProductNo=1333822';
const question = '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반 새상품 현재 가격과 배송비 포함 실결제가를 검증해줘';
const target: NormalizedTarget = {
  kind: 'product',
  brand: '크로스오버',
  model: '27QAW99',
  name: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반',
  canonicalUrl: exactUrl,
};
const canonicalIdentity = compileCanonicalIdentity(target, question);

function exactPage(): DirectPageResult {
  return {
    url: exactUrl,
    title: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반',
    product: {
      name: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반 새상품',
      brand: '크로스오버',
      sku: '27QAW99',
      model: '27QAW99',
      offers: {
        price: 198000,
        currency: 'KRW',
        availability: 'InStock',
        shippingFee: 0,
      },
    },
    facts: {
      name: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반 새상품',
      brand: '크로스오버',
      sku: '27QAW99',
      model: '27QAW99',
      price: 198000,
      shippingFee: 0,
      availability: 'InStock',
    },
    evidence: [],
  };
}

function titleOnlyExactPage(): DirectPageResult {
  return {
    url: exactUrl,
    title: '크로스오버 27QAW99 Fast-iPS 200 WQHD 화이트 Ai게이밍 일반',
    product: {
      name: '크로스오버 27QAW99',
      brand: '크로스오버',
      sku: '27QAW99',
      model: '27QAW99',
      offers: {
        price: 198000,
        currency: 'KRW',
        availability: 'InStock',
        shippingFee: 0,
      },
    },
    facts: {
      name: '크로스오버 27QAW99',
      brand: '크로스오버',
      sku: '27QAW99',
      model: '27QAW99',
      price: 198000,
      shippingFee: 0,
      availability: 'InStock',
    },
    evidence: [],
  };
}

function verify(page: DirectPageResult) {
  return verifyDirectSellerCandidate({
    page,
    target,
    canonicalIdentity,
    retrievedAt: '2026-09-06T04:10:00.000Z',
  });
}

test('direct exact seller page preserves identity, price, shipping and decisive total', () => {
  const offer = verify(exactPage());

  assert.ok(offer);
  assert.equal(offer.identityVerdict, 'exact');
  assert.equal(offer.eligible, true);
  assert.equal(offer.salePrice, 198000);
  assert.equal(offer.totalCashPrice, 198000);
  assert.equal(offer.shippingFee, 0);
  assert.equal(offer.fieldVerification?.identity, 'page_verified');
  assert.equal(offer.fieldVerification?.price, 'page_verified');
  assert.equal(offer.fieldVerification?.shipping, 'page_verified');
});

test('exact page title alone cannot graduate a generic price-scoped structured product', () => {
  assert.equal(verify(titleOnlyExactPage()), null);
});

test('comparison portal page is never graduated as a direct seller offer', () => {
  const page = exactPage();
  page.url = 'https://prod.danawa.com/info/?pcode=999';

  assert.equal(verify(page), null);
});

test('internally conflicting seller page cannot bypass variant isolation', () => {
  const page = exactPage();
  page.description = '상세 사양: QHD Fast IPS 180Hz 화이트 일반';

  assert.equal(verify(page), null);
});

test('seller page without explicit current availability cannot graduate', () => {
  const page = exactPage();
  if (page.product?.offers) delete page.product.offers.availability;
  if (page.facts) delete page.facts.availability;

  assert.equal(verify(page), null);
});
