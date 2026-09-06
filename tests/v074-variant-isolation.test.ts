import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { candidateIdentityFromText, compareCanonicalIdentity } from '../src/core/identity-match.ts';
import type { CanonicalProductIdentity } from '../src/core/types.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import { verifiedSellerOfferFromPage } from '../src/providers/seller-expansion.ts';

type MaterialVariantPrimary = CanonicalProductIdentity['primary'] & {
  pixelPolicy?: 'standard' | 'zero_defect';
  refreshRateHz?: number;
};

const target = {
  kind: 'product' as const,
  brand: '래안텍',
  model: '27QAF80CE',
  name: '래안텍 ARKCELL 27QAF80CE EVO 화이트 일반 IPS QHD 200Hz',
};

const canonical = compileCanonicalIdentity(
  target,
  '래안텍 ARKCELL 27QAF80CE EVO 화이트 일반 IPS QHD 200Hz 새상품',
);

function materialPrimary(identity: CanonicalProductIdentity): MaterialVariantPrimary {
  return identity.primary as MaterialVariantPrimary;
}

test('canonical identity preserves material monitor variant fields', () => {
  const primary = materialPrimary(canonical);
  assert.equal(primary.model, '27QAF80CE');
  assert.equal(primary.generation, 'EVO');
  assert.equal(primary.color, 'white');
  assert.equal(primary.pixelPolicy, 'standard');
  assert.equal(primary.refreshRateHz, 200);
});

test('non-EVO zero-defect 180Hz sibling is not exact for EVO standard 200Hz target', () => {
  const sibling = candidateIdentityFromText(
    '래안텍 ARKCELL 27QAF80CE 화이트 무결점 IPS QHD 180Hz 새상품',
  );
  const result = compareCanonicalIdentity(canonical, sibling);

  assert.equal(result.verdict, 'different');
  assert.ok(result.conflicts.some((item) => /pixel|refresh|generation/i.test(item)));
});

test('page title cannot lend exact variant identity to a price-scoped generic seller product', () => {
  const page: DirectPageResult = {
    url: 'https://item.gmarket.co.kr/Item?goodsCode=4716619824',
    title: '래안텍 ARKCELL 27QAF80CE EVO 화이트 일반 IPS QHD 200Hz',
    product: {
      name: '래안텍 ARKCELL 27QAF80CE',
      brand: '래안텍',
      sku: '27QAF80CE',
      model: '27QAF80CE',
      offers: {
        price: 199000,
        currency: 'KRW',
        availability: 'InStock',
        shippingFee: 0,
      },
    },
    facts: {
      name: '래안텍 ARKCELL 27QAF80CE',
      brand: '래안텍',
      sku: '27QAF80CE',
      model: '27QAF80CE',
      price: 199000,
      availability: 'InStock',
      shippingFee: 0,
    },
    evidence: [],
  };

  const offer = verifiedSellerOfferFromPage({
    page,
    target,
    canonicalIdentity: canonical,
    constraints: [],
    retrievedAt: '2026-09-06T03:30:00.000Z',
    discoveredBy: ['gmarket'],
    sellerName: '래안텍',
    sellerProductId: '4716619824',
  });

  assert.ok(offer);
  assert.equal(offer.identityVerdict, 'uncertain');
  assert.equal(offer.eligible, false);
  assert.equal(offer.fieldVerification?.price, 'unverified');
  assert.ok(offer.exclusionReasons.includes('identity:uncertain'));
});

test('exact structured variant keeps page-verified seller economics', () => {
  const page: DirectPageResult = {
    url: 'https://item.gmarket.co.kr/Item?goodsCode=4716619824&option=standard-white',
    product: {
      name: '래안텍 ARKCELL 27QAF80CE EVO 화이트 일반 IPS QHD 200Hz 새상품',
      brand: '래안텍',
      sku: '27QAF80CE',
      model: '27QAF80CE',
      offers: {
        price: 189000,
        currency: 'KRW',
        availability: 'InStock',
        shippingFee: 0,
      },
    },
    facts: {
      name: '래안텍 ARKCELL 27QAF80CE EVO 화이트 일반 IPS QHD 200Hz 새상품',
      brand: '래안텍',
      sku: '27QAF80CE',
      model: '27QAF80CE',
      price: 189000,
      availability: 'InStock',
      shippingFee: 0,
    },
    evidence: [],
  };

  const offer = verifiedSellerOfferFromPage({
    page,
    target,
    canonicalIdentity: canonical,
    constraints: [],
    retrievedAt: '2026-09-06T03:30:00.000Z',
    discoveredBy: ['gmarket'],
    sellerName: '래안텍',
    sellerProductId: '4716619824:standard-white',
  });

  assert.ok(offer);
  assert.equal(offer.identityVerdict, 'exact');
  assert.equal(offer.eligible, true);
  assert.equal(offer.salePrice, 189000);
  assert.equal(offer.totalCashPrice, 189000);
  assert.equal(offer.fieldVerification?.price, 'page_verified');
});
