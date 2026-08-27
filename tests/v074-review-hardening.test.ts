import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import type { CanonicalIdentityMatch, MarketOffer, NormalizedTarget } from '../src/core/types.ts';
import { runMarketProviderCoverage } from '../src/orchestrator/provider-pipeline.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  SellerCandidate,
  VerificationCandidate,
  VerifiedCandidate,
} from '../src/providers/market-provider.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';

const target: NormalizedTarget = {
  kind: 'product',
  brand: '와이드뷰',
  name: 'QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지',
  model: 'QWGE43UT1',
  variant: 'V3',
};

const canonicalIdentity = compileCanonicalIdentity(
  target,
  '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
);

const exactMatch: CanonicalIdentityMatch = {
  verdict: 'exact',
  matched: ['QWGE43UT1', 'EKWBYME78W', 'V3', '43'],
  missing: [],
  conflicts: [],
  confidence: 1,
};

function exactPage(url: string): DirectPageResult {
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'EKWBYME78W V3',
      price: 409000,
      shippingFee: 0,
      availability: 'InStock',
      attributes: {},
    },
    evidence: [],
  };
}

function eligibleOffer(url: string): MarketOffer {
  return {
    id: `seller:${url}`,
    market: '판매자몰',
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    url,
    currency: 'KRW',
    retrievedAt: '2026-08-27T13:10:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 1,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: 'page_verified',
    },
    bundleComplete: true,
    eligible: true,
    salePrice: 409000,
    shippingFee: 0,
    shipping: { status: 'free', verification: 'page_verified' },
    totalCashPrice: 409000,
    availability: 'InStock',
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
  };
}

test('comparison provider uses exact-model fallback when resolved seller fails direct verification', async () => {
  const comparisonUrl = 'https://prod.danawa.com/info/?pcode=review-1';
  const staleSellerUrl = 'https://stale-seller.example/products/review-1';
  const fallbackSellerUrl = 'https://healthy-seller.example/products/review-1';
  let fallbackCalls = 0;
  const verifiedUrls: string[] = [];

  const fallbackSellers = async (_candidate: DiscoveryCandidate, _context: MarketProviderContext): Promise<SellerCandidate[]> => {
    fallbackCalls += 1;
    return [{
      providerId: 'danawa',
      discoveredFrom: ['danawa'],
      comparisonUrl,
      sellerUrl: fallbackSellerUrl,
      resolutionMethod: 'fallback_search',
    }];
  };

  const provider = {
    id: 'danawa',
    market: '다나와',
    budget: { discovery: 1, verification: 2, sellerExpansion: 2 },
    discover: async (): Promise<DiscoveryCandidate[]> => [{
      providerId: 'danawa',
      market: '다나와',
      title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      url: comparisonUrl,
      snippet: '가격비교',
      discoveredAt: '2026-08-27T13:10:00.000Z',
    }],
    identify: (_candidate: VerificationCandidate) => exactMatch,
    expandSellers: async (): Promise<SellerCandidate[]> => [{
      providerId: 'danawa',
      discoveredFrom: ['danawa'],
      comparisonUrl,
      sellerUrl: staleSellerUrl,
      resolutionMethod: 'static_link',
    }],
    fallbackSellers,
    verify: async (candidate: VerificationCandidate, context: MarketProviderContext): Promise<VerifiedCandidate> => {
      const url = 'sellerUrl' in candidate ? candidate.sellerUrl : candidate.url;
      verifiedUrls.push(url);
      if (url === staleSellerUrl) throw new Error('seller page no longer fetchable');
      const page = await context.directPage(url);
      return { candidate, page, identity: exactMatch, retrievedAt: context.now().toISOString() };
    },
    extractOffer: (verified: VerifiedCandidate) => eligibleOffer(verified.page.url),
  } as MarketProvider & {
    fallbackSellers: typeof fallbackSellers;
  };

  const result = await runMarketProviderCoverage({
    providers: [provider],
    target,
    canonicalIdentity,
    constraints: [],
    publicSearch: async () => [],
    directPage: async (url) => exactPage(url),
    now: () => new Date('2026-08-27T13:10:00.000Z'),
    nowMs: () => 0,
    totalDeadlineMs: 45_000,
  });

  assert.equal(fallbackCalls, 1, 'fallback discovery must run after comparison-derived seller verification cannot proceed');
  assert.deepEqual(verifiedUrls, [staleSellerUrl, fallbackSellerUrl]);
  assert.equal(result.attempts[0]?.verification.attempted, 2, 'fallback must remain inside the provider verification budget');
  assert.equal(result.offers.some((offer) => offer.url === fallbackSellerUrl && offer.eligible), true);
});
