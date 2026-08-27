import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeAgentResearchJob } from '../src/agent/research.ts';
import type { MarketOffer, ResearchJob } from '../src/core/types.ts';

function exactSellerWithUnknownShipping(): MarketOffer {
  return {
    id: 'seller:exact:1',
    market: '판매자몰',
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    url: 'https://seller.example.com/products/1',
    currency: 'KRW',
    retrievedAt: '2026-08-27T15:00:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 1,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: 'unverified',
    },
    bundleComplete: true,
    eligible: false,
    salePrice: 409000,
    shipping: { status: 'unknown', verification: 'unverified' },
    availability: 'InStock',
    verificationTrace: {
      resolutionMethod: 'static_link',
      resolvedSellerUrl: 'https://seller.example.com/products/1',
      identityVerdict: 'exact',
      bundleVerdict: 'complete',
      priceStatus: 'page_verified',
      shippingStatus: 'unknown',
      availabilityStatus: 'available',
      mandatoryFeeStatus: 'not_applicable',
      rejectionReasons: ['shipping:unknown'],
      retrievedAt: '2026-08-27T15:00:00.000Z',
    },
    conditions: [],
    riskFlags: [],
    exclusionReasons: ['shipping:unknown'],
  };
}

function uncertainSearchMetadata(): MarketOffer {
  return {
    id: 'search:preliminary:1',
    market: '네이버쇼핑',
    title: '비슷한 와이드뷰 43인치 상품',
    url: 'https://shopping.naver.com/catalog/other',
    currency: 'KRW',
    retrievedAt: '2026-08-27T15:00:00.000Z',
    verification: 'search_metadata',
    condition: 'unknown',
    identityScore: 0.45,
    identityVerdict: 'uncertain',
    constraintStatus: 'preliminary',
    fieldVerification: {
      identity: 'search_metadata',
      price: 'search_metadata',
      shipping: 'unverified',
    },
    bundleComplete: false,
    eligible: false,
    salePrice: 365400,
    conditions: [],
    riskFlags: [],
    exclusionReasons: ['identity:uncertain', 'search_metadata_requires_page_verification'],
  };
}

function insufficientJob(): ResearchJob {
  const target = {
    kind: 'product' as const,
    brand: '와이드뷰',
    name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
    model: 'QWGE43UT1',
    variant: 'V3',
  };
  return {
    id: 'verification-gap-metadata-precedence',
    status: 'completed',
    request: {
      question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 현재 가격',
      category: 'product',
      includeLocalRelay: false,
    },
    createdAt: '2026-08-27T15:00:00.000Z',
    updatedAt: '2026-08-27T15:00:01.000Z',
    completedAt: '2026-08-27T15:00:01.000Z',
    target,
    researchContext: {
      identityConfidence: 1,
      resolvedTarget: target,
      resolutionAmbiguous: false,
    },
    sourceResults: [],
    evidence: [],
    relay: { available: false, used: false, mode: 'public_only' },
    report: {
      decision: 'INSUFFICIENT',
      confidence: 0.6,
      confidenceDimensions: {
        identity: 1,
        price: 0.5,
        officialSpecs: 0.5,
        reviews: 0.5,
        negativeSignals: 0.5,
        personalizedPrice: 0,
      },
      title: '와이드뷰 V3 패키지',
      summary: '배송비가 확정되지 않았습니다.',
      reasons: [],
      strengths: [],
      weaknesses: [],
      missingInformation: [],
      evidence: [],
      sourceCount: 0,
      offers: [uncertainSearchMetadata(), exactSellerWithUnknownShipping()],
      bestOffers: {},
      marketCoverage: [],
      standardPriceRows: [],
      purchaseContextApplied: {
        ownedCards: [],
        paymentMethods: [],
        memberships: [],
        preferences: [],
      },
      validationWarnings: [],
    },
    errors: [],
  };
}

test('search metadata identity uncertainty cannot outrank an exact seller shipping blocker', () => {
  const shaped = shapeAgentResearchJob(insufficientJob()) as any;
  assert.equal(
    shaped.verificationGap,
    'shipping_unknown',
    'seller-authoritative exact identity plus unknown shipping must report shipping_unknown even when discovery metadata is uncertain',
  );
});
