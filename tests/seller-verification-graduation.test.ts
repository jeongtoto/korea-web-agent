import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  MarketOffer,
  SellerVerificationTrace,
} from '../src/core/types.ts';
import type { SellerCandidate } from '../src/providers/market-provider.ts';

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
