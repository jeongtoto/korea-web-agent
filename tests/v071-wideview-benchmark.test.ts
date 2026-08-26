import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { isDecisiveCashOffer } from '../src/core/offer-engine.ts';
import type { MarketOffer } from '../src/core/types.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import { verifiedSellerOfferFromPage } from '../src/providers/seller-expansion.ts';

const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  variant: '43인치',
  name: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};
const canonicalIdentity = compileCanonicalIdentity(target, target.name);
const retrievedAt = '2026-08-27T00:00:00.000Z';

function sellerPage(bundleVersion: 'V2' | 'V3', price: number, shippingFee?: number): DirectPageResult {
  const name = `와이드뷰 QWGE43UT1 + EKWBYME78W(${bundleVersion}) 43인치 이동형 패키지`;
  return {
    url: `https://seller.example/wideview-${bundleVersion.toLowerCase()}`,
    title: name,
    description: `${name} 신품`,
    product: {
      name,
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      description: `EKWBYME78W(${bundleVersion}) 이동형 스탠드 포함`,
      offers: {
        price,
        currency: 'KRW',
        availability: 'https://schema.org/InStock',
        ...(shippingFee !== undefined ? { shippingFee } : {}),
      },
    },
    facts: {
      name,
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      description: `EKWBYME78W(${bundleVersion}) 이동형 스탠드 포함`,
      price,
      availability: 'https://schema.org/InStock',
      ...(shippingFee !== undefined ? { shippingFee } : {}),
    },
    evidence: [],
  };
}

function verify(page: DirectPageResult) {
  return verifiedSellerOfferFromPage({
    page,
    target,
    canonicalIdentity,
    constraints: [],
    retrievedAt,
    discoveredBy: ['v071-wideview-benchmark'],
  });
}

test('WideView benchmark allows only exact V3 with deterministic shipping to become decisive', () => {
  const metadataOnly: MarketOffer = {
    id: 'naver-metadata-365400',
    market: '네이버쇼핑',
    title: target.name,
    url: 'https://shopping.naver.com/catalog/metadata-only',
    currency: 'KRW',
    retrievedAt,
    verification: 'search_metadata',
    condition: 'new',
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    fieldVerification: { identity: 'search_metadata', price: 'search_metadata', shipping: 'search_metadata' },
    bundleComplete: true,
    eligible: false,
    salePrice: 365400,
    shippingFee: 0,
    totalCashPrice: 365400,
    conditions: [],
    riskFlags: [],
    exclusionReasons: ['search_metadata_requires_page_verification'],
  };
  const wrongV2 = verify(sellerPage('V2', 299000, 0));
  const unknownShipping = verify(sellerPage('V3', 349000));
  const exactV3 = verify(sellerPage('V3', 449000, 0));

  assert.ok(wrongV2);
  assert.ok(unknownShipping);
  assert.ok(exactV3);

  assert.equal(isDecisiveCashOffer(metadataOnly), false, 'search metadata must not be decisive');
  assert.equal(wrongV2?.eligible, false, 'wrong bundle must not be eligible');
  assert.equal(isDecisiveCashOffer(wrongV2!), false, 'wrong bundle must not be decisive');
  assert.equal(unknownShipping?.eligible, false, 'unknown shipping must not be eligible');
  assert.equal(isDecisiveCashOffer(unknownShipping!), false, 'unknown shipping must not be decisive');
  assert.equal(exactV3?.eligible, true, 'exact V3 with known shipping should be eligible');
  assert.equal(isDecisiveCashOffer(exactV3!), true, 'exact V3 with known shipping should be decisive');
});
