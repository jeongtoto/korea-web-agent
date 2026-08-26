import test from 'node:test';
import assert from 'node:assert/strict';
import { isDecisiveCashOffer, rankMarketOffers } from '../src/core/offer-engine.ts';
import type { CanonicalIdentityMatch, MarketOffer } from '../src/core/types.ts';
import { runMarketProviderCoverage } from '../src/orchestrator/provider-pipeline.ts';
import { resolveComparisonBridgeCandidates } from '../src/providers/comparison-provider.ts';
import { discoverFallbackSellers } from '../src/providers/seller-fallback-discovery.ts';
import {
  directPageIdentityMatch,
  verifiedSellerOfferFromPage,
} from '../src/providers/seller-expansion.ts';
import { resolveSellerCandidatesFromPage } from '../src/providers/seller-resolution.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  VerificationCandidate,
} from '../src/providers/market-provider.ts';
import {
  V074_AT,
  comparisonDiscovery,
  wideViewCanonical,
  wideViewMetadataOffer,
  wideViewSellerPage,
  wideViewTarget,
} from './fixtures/seller-resolution-fixtures.ts';

function graduate(page = wideViewSellerPage({ price: 429000, shippingFee: 0 }), trace?: MarketOffer['verificationTrace']) {
  return verifiedSellerOfferFromPage({
    page,
    target: wideViewTarget,
    canonicalIdentity: wideViewCanonical,
    constraints: [],
    retrievedAt: V074_AT,
    discoveredBy: ['v074-golden'],
    ...(trace ? { verificationTrace: trace } : {}),
  });
}

const exactMatch: CanonicalIdentityMatch = {
  verdict: 'exact',
  matched: ['QWGE43UT1', 'EKWBYME78W', 'V3', '43'],
  missing: [],
  conflicts: [],
  confidence: 1,
};

function comparisonContext(overrides: Partial<MarketProviderContext> = {}): MarketProviderContext {
  return {
    target: wideViewTarget,
    canonicalIdentity: wideViewCanonical,
    constraints: [],
    publicSearch: async () => [],
    directPage: async (url) => wideViewSellerPage({ price: 429000, shippingFee: 0, url }),
    now: () => new Date(V074_AT),
    ...overrides,
  };
}

test('G1 standard retailer exact seller with known total is decisive', () => {
  const offer = graduate(wideViewSellerPage({ price: 399000, shippingFee: 0 }));
  assert.ok(offer);
  assert.equal(offer.eligible, true);
  assert.equal(offer.totalCashPrice, 399000);
  assert.equal(isDecisiveCashOffer(offer), true);
});

test('G2 comparison static merchant link opens seller and seller economics govern', () => {
  const comparison = comparisonDiscovery();
  const sellers = resolveSellerCandidatesFromPage({
    providerId: 'danawa',
    comparisonUrl: comparison.url,
    staticLinks: [{
      url: 'https://www.11st.co.kr/products/7402',
      sellerName: '판매자A',
      productId: '7402',
      advertisedPrice: 365400,
    }],
    embeddedRecords: [],
    limit: 5,
    retrievedAt: V074_AT,
  });
  const offer = graduate(
    wideViewSellerPage({ price: 429000, shippingFee: 0, url: sellers[0]!.sellerUrl }),
    sellers[0]!.verificationTrace,
  );
  assert.equal(sellers[0]?.resolutionMethod, 'static_link');
  assert.equal(offer?.verificationTrace?.comparisonAdvertisedPrice, 365400);
  assert.equal(offer?.salePrice, 429000);
  assert.equal(offer?.totalCashPrice, 429000);
});

test('G3 embedded JSON seller target opens seller and seller economics govern', () => {
  const comparison = comparisonDiscovery();
  const sellers = resolveSellerCandidatesFromPage({
    providerId: 'danawa',
    comparisonUrl: comparison.url,
    staticLinks: [],
    embeddedRecords: [{
      url: 'https://www.11st.co.kr/products/7403',
      sellerName: '판매자B',
      productId: '7403',
      advertisedPrice: 379000,
    }],
    limit: 5,
    retrievedAt: V074_AT,
  });
  const offer = graduate(
    wideViewSellerPage({ price: 419000, shippingFee: 0, url: sellers[0]!.sellerUrl }),
    sellers[0]!.verificationTrace,
  );
  assert.equal(sellers[0]?.resolutionMethod, 'embedded_metadata');
  assert.equal(offer?.salePrice, 419000);
  assert.equal(offer?.verificationTrace?.comparisonAdvertisedPrice, 379000);
});

test('G4 bridge URL resolves to final seller before ranking', async () => {
  const bridgeUrl = 'https://prod.danawa.com/bridge?id=7404';
  const sellerUrl = 'https://www.11st.co.kr/products/7404';
  const candidates = resolveSellerCandidatesFromPage({
    providerId: 'danawa',
    comparisonUrl: comparisonDiscovery().url,
    staticLinks: [{ url: bridgeUrl, sellerName: '판매자C', productId: '7404', advertisedPrice: 365400 }],
    embeddedRecords: [],
    limit: 5,
    retrievedAt: V074_AT,
  });
  const resolved = await resolveComparisonBridgeCandidates(candidates, comparisonContext({
    resolveSellerRedirect: async (url) => ({
      originalUrl: url,
      resolvedUrl: sellerUrl,
      hops: [url, sellerUrl],
      status: 'resolved',
    }),
  }), 'danawa');
  const offer = graduate(
    wideViewSellerPage({ price: 429000, shippingFee: 0, url: resolved[0]!.sellerUrl }),
    resolved[0]!.verificationTrace,
  );
  assert.equal(resolved[0]?.sellerUrl, sellerUrl);
  assert.equal(resolved[0]?.resolutionMethod, 'redirect_resolution');
  assert.equal(offer?.verificationTrace?.originalSellerUrl, bridgeUrl);
  assert.equal(isDecisiveCashOffer(offer!), true);
});

test('G5 seller around ninth position remains reachable when inside sellerExpansion budget', () => {
  const staticLinks = Array.from({ length: 10 }, (_, index) => ({
    url: `https://www.11st.co.kr/products/${7500 + index}`,
    sellerName: `판매자${index + 1}`,
    productId: String(7500 + index),
    advertisedPrice: 390000 + index * 1000,
  }));
  const sellers = resolveSellerCandidatesFromPage({
    providerId: 'danawa',
    comparisonUrl: comparisonDiscovery().url,
    staticLinks,
    embeddedRecords: [],
    limit: 10,
    retrievedAt: V074_AT,
  });
  assert.equal(sellers.length, 10);
  assert.equal(sellers[8]?.sellerProductId, '7508');
  assert.equal(sellers[8]?.sellerUrl, 'https://www.11st.co.kr/products/7508');
});

test('G6 seller-verified price overrides lower comparison advertised price', () => {
  const offer = graduate(wideViewSellerPage({ price: 429000, shippingFee: 0 }), {
    comparisonSource: 'danawa',
    comparisonUrl: comparisonDiscovery().url,
    resolutionMethod: 'embedded_metadata',
    comparisonAdvertisedPrice: 365400,
    rejectionReasons: [],
    retrievedAt: V074_AT,
  });
  assert.equal(offer?.verificationTrace?.comparisonAdvertisedPrice, 365400);
  assert.equal(offer?.verificationTrace?.sellerVerifiedPrice, 429000);
  assert.equal(offer?.totalCashPrice, 429000);
});

test('G7 exact V3 seller with free shipping resolves decisive total', () => {
  const offer = graduate(wideViewSellerPage({ price: 409000, shippingFee: 0 }));
  assert.equal(offer?.shipping?.status, 'free');
  assert.equal(offer?.totalCashPrice, 409000);
  assert.equal(isDecisiveCashOffer(offer!), true);
});

test('G8 exact V3 seller with paid shipping includes fee in decisive total', () => {
  const offer = graduate(wideViewSellerPage({ price: 399000, shippingFee: 20000 }));
  assert.equal(offer?.shipping?.status, 'paid');
  assert.equal(offer?.shippingFee, 20000);
  assert.equal(offer?.totalCashPrice, 419000);
  assert.equal(isDecisiveCashOffer(offer!), true);
});

test('G9 exact V3 seller with unknown shipping is non-decisive', () => {
  const offer = graduate(wideViewSellerPage({ price: 349000 }));
  assert.equal(offer?.shipping?.status, 'unknown');
  assert.equal(offer?.eligible, false);
  assert.equal(offer?.totalCashPrice, undefined);
  assert.equal(isDecisiveCashOffer(offer!), false);
});

test('G10 comparison 365400 stays indicative when resolved seller winner is 429000', () => {
  const metadata = wideViewMetadataOffer(365400);
  const seller = graduate(wideViewSellerPage({ price: 429000, shippingFee: 0 }));
  const ranked = rankMarketOffers([metadata, seller!]);
  assert.equal(ranked.bestOffers.cash?.amount, 429000);
  assert.equal(ranked.bestOffers.cash?.offer.verification, 'page_verified');
  assert.equal(isDecisiveCashOffer(metadata), false);
});

test('G11 exact-model fallback may find seller but still requires seller-page verification', async () => {
  const sellerUrl = 'https://www.11st.co.kr/products/7411';
  const candidates = await discoverFallbackSellers({
    providerId: 'danawa',
    comparisonUrl: comparisonDiscovery().url,
    target: wideViewTarget,
    canonicalIdentity: wideViewCanonical,
    search: async (query) => {
      assert.match(query, /QWGE43UT1/i);
      assert.match(query, /EKWBYME78W/i);
      assert.match(query, /V3/i);
      return [{ title: `${wideViewTarget.name} 365,400원`, url: sellerUrl, snippet: '무료배송 365,400원' }];
    },
    limit: 4,
    retrievedAt: V074_AT,
  });
  assert.equal(candidates[0]?.resolutionMethod, 'fallback_search');
  assert.equal(candidates[0]?.advertisedPrice, undefined);
  const offer = graduate(
    wideViewSellerPage({ price: 429000, shippingFee: 0, url: sellerUrl }),
    candidates[0]!.verificationTrace,
  );
  assert.equal(offer?.salePrice, 429000);
  assert.equal(offer?.verification, 'page_verified');
});

test('G12 metadata-only low price can never become decisive cash', () => {
  const metadata = wideViewMetadataOffer(299000);
  const ranked = rankMarketOffers([metadata]);
  assert.equal(isDecisiveCashOffer(metadata), false);
  assert.equal(ranked.bestOffers.cash, undefined);
});

test('G13 broken provider cannot discard a healthy verified winner', async () => {
  const healthyUrl = 'https://www.11st.co.kr/products/7413';
  const healthyDiscovery: DiscoveryCandidate = {
    providerId: '11st',
    market: '11번가',
    title: wideViewTarget.name,
    url: healthyUrl,
    snippet: '429,000원 무료배송',
    discoveredAt: V074_AT,
  };
  const healthy: MarketProvider = {
    id: '11st',
    market: '11번가',
    budget: { discovery: 1, verification: 1, sellerExpansion: 0 },
    discover: async () => [healthyDiscovery],
    identify: () => exactMatch,
    verify: async (candidate, context) => {
      const page = await context.directPage('sellerUrl' in candidate ? candidate.sellerUrl : candidate.url);
      return { candidate, page, identity: directPageIdentityMatch(wideViewCanonical, page), retrievedAt: V074_AT };
    },
    extractOffer: (verified) => graduate(verified.page),
  };
  const broken: MarketProvider = {
    id: 'coupang',
    market: '쿠팡',
    budget: { discovery: 1, verification: 1, sellerExpansion: 0 },
    discover: async () => { throw new Error('403 blocked by site'); },
    identify: (_candidate: VerificationCandidate) => exactMatch,
    verify: async () => { throw new Error('unreachable'); },
    extractOffer: () => null,
  };

  const result = await runMarketProviderCoverage({
    providers: [broken, healthy],
    target: wideViewTarget,
    canonicalIdentity: wideViewCanonical,
    constraints: [],
    publicSearch: async () => [],
    directPage: async (url) => wideViewSellerPage({ price: 429000, shippingFee: 0, url }),
    now: () => new Date(V074_AT),
    nowMs: () => Date.parse(V074_AT),
    totalDeadlineMs: 45000,
  });

  assert.equal(result.attempts.find((item) => item.market === '쿠팡')?.status, 'failed');
  assert.equal(result.attempts.find((item) => item.market === '11번가')?.status, 'verified');
  assert.equal(rankMarketOffers(result.offers).bestOffers.cash?.amount, 429000);
});
