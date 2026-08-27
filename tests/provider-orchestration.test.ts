import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import type {
  CanonicalIdentityMatch,
  MarketOffer,
  NormalizedTarget,
  ProviderAttempt,
} from '../src/core/types.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  MarketProviderId,
  VerificationCandidate,
  VerifiedCandidate,
} from '../src/providers/market-provider.ts';
import { createMarketProviderRegistry } from '../src/providers/provider-registry.ts';
import {
  runMarketProviderCoverage,
  type MarketProviderCoverageResult,
  type ProviderPipelineResult,
} from '../src/orchestrator/provider-pipeline.ts';
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

function directPage(url: string, price = 449000): DirectPageResult {
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      offers: { price, currency: 'KRW', availability: 'InStock', shippingFee: 0 },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'EKWBYME78W V3',
      price,
      shippingFee: 0,
      availability: 'InStock',
      attributes: {},
    },
    evidence: [],
  };
}

function decisiveOffer(url: string, market: string, discoveredBy: string[], price = 449000): MarketOffer {
  return {
    id: `${market}:${url}`,
    market,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    url,
    currency: 'KRW',
    retrievedAt: '2026-08-25T21:00:00.000Z',
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
    salePrice: price,
    shippingFee: 0,
    shipping: { status: 'free', verification: 'page_verified' },
    totalCashPrice: price,
    availability: 'InStock',
    sellerInfo: {
      canonicalUrl: url,
      productId: 'seller-product-1',
      discoveredBy,
    },
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
  };
}

function discovery(providerId: MarketProviderId, market: string, url: string, suffix = ''): DiscoveryCandidate {
  return {
    providerId,
    market,
    title: `QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지 ${suffix}`.trim(),
    url,
    snippet: '무료배송 449,000원',
    discoveredAt: '2026-08-25T21:00:00.000Z',
  };
}

function fakeProvider(input: {
  id: MarketProviderId;
  market: string;
  discoveryUrls?: string[];
  verificationBudget?: number;
  sellerExpansionBudget?: number;
  discover?: (context: MarketProviderContext) => Promise<DiscoveryCandidate[]>;
  identify?: (candidate: VerificationCandidate, context: MarketProviderContext) => CanonicalIdentityMatch;
  expandSellers?: MarketProvider['expandSellers'];
  verify?: (candidate: VerificationCandidate, context: MarketProviderContext) => Promise<VerifiedCandidate>;
  extractOffer?: MarketProvider['extractOffer'];
}): MarketProvider {
  const urls = input.discoveryUrls ?? [`https://shop.example.com/${input.id}/1`];
  return {
    id: input.id,
    market: input.market,
    budget: {
      discovery: Math.max(urls.length, 1),
      verification: input.verificationBudget ?? Math.max(urls.length, 1),
      sellerExpansion: input.sellerExpansionBudget ?? 0,
    },
    discover: input.discover ?? (async () => urls.map((url, index) => discovery(input.id, input.market, url, String(index + 1)))),
    identify: input.identify ?? (() => exactMatch),
    ...(input.expandSellers ? { expandSellers: input.expandSellers } : {}),
    verify: input.verify ?? (async (candidate, context) => {
      const url = 'sellerUrl' in candidate ? candidate.sellerUrl : candidate.url;
      const page = await context.directPage(url);
      return { candidate, page, identity: exactMatch, retrievedAt: context.now().toISOString() };
    }),
    extractOffer: input.extractOffer ?? ((verified) => {
      const url = verified.page.url;
      return decisiveOffer(url, input.market, [input.id]);
    }),
  };
}

function run(
  providers: readonly MarketProvider[],
  overrides: Partial<Parameters<typeof runMarketProviderCoverage>[0]> = {},
): Promise<MarketProviderCoverageResult> {
  return runMarketProviderCoverage({
    providers,
    target,
    canonicalIdentity,
    constraints: [],
    publicSearch: async () => [],
    directPage: async (url) => directPage(url),
    now: () => new Date('2026-08-25T21:00:00.000Z'),
    nowMs: () => 0,
    totalDeadlineMs: 45_000,
    ...overrides,
  });
}

test('registry binds all 13 concrete providers in the approved deterministic order', async () => {
  const providers = await createMarketProviderRegistry();
  assert.deepEqual(providers.map((provider) => provider.id), [
    'naver-shopping',
    'coupang',
    'danawa',
    'enuri',
    '11st',
    'gmarket',
    'auction',
    'ssg',
    'lotteon',
    'himart',
    'official',
    'kakao-talkdeal',
    'toss-shopping',
  ]);
});

test('provider-local block does not discard verified offers from other markets', async () => {
  const blocked = fakeProvider({
    id: 'coupang',
    market: '쿠팡',
    verify: async () => { throw new Error('403 bot blocked by site policy'); },
  });
  const verified = fakeProvider({ id: 'naver-shopping', market: '네이버쇼핑' });

  const result = await run([blocked, verified]);
  assert.equal(result.attempts.find((item) => item.market === '쿠팡')?.status, 'failed');
  assert.equal(result.attempts.find((item) => item.market === '네이버쇼핑')?.status, 'verified');
  assert.equal(result.offers.some((offer) => offer.market === '네이버쇼핑' && offer.eligible), true);
});

test('same-domain direct verification never exceeds the global limit of two active calls', async () => {
  const provider = fakeProvider({
    id: '11st',
    market: '11번가',
    discoveryUrls: [1, 2, 3, 4].map((id) => `https://same.example.com/products/${id}`),
    verificationBudget: 4,
  });

  let active = 0;
  let maxActive = 0;
  let entered = 0;
  let releaseFirstWave!: () => void;
  const firstWaveReleased = new Promise<void>((resolve) => { releaseFirstWave = resolve; });
  let firstWaveEntered!: () => void;
  const firstWaveReady = new Promise<void>((resolve) => { firstWaveEntered = resolve; });

  const pending = run([provider], {
    directPage: async (url) => {
      active += 1;
      entered += 1;
      maxActive = Math.max(maxActive, active);
      if (entered === 2) firstWaveEntered();
      if (entered <= 2) await firstWaveReleased;
      active -= 1;
      return directPage(url);
    },
  });

  await firstWaveReady;
  assert.equal(maxActive, 2);
  releaseFirstWave();
  await pending;
  assert.equal(maxActive, 2);
});

test('provider verification budget stops excess candidate verification without fixed top-three behavior', async () => {
  let verifyCalls = 0;
  const provider = fakeProvider({
    id: 'gmarket',
    market: 'G마켓',
    discoveryUrls: [1, 2, 3, 4].map((id) => `https://gmarket.example/products/${id}`),
    verificationBudget: 1,
    verify: async (candidate, context) => {
      verifyCalls += 1;
      const url = 'sellerUrl' in candidate ? candidate.sellerUrl : candidate.url;
      return { candidate, page: await context.directPage(url), identity: exactMatch, retrievedAt: context.now().toISOString() };
    },
  });

  const result = await run([provider]);
  assert.equal(verifyCalls, 1);
  assert.equal(result.attempts[0]?.verification.attempted, 1);
});

test('a verified eligible offer keeps provider status verified even when another candidate fails', async () => {
  let calls = 0;
  const provider = fakeProvider({
    id: 'auction',
    market: '옥션',
    discoveryUrls: [
      'https://auction.example/products/good',
      'https://auction.example/products/blocked',
    ],
    verificationBudget: 2,
    verify: async (candidate, context) => {
      calls += 1;
      if (calls === 2) throw new Error('403 blocked by site');
      const url = 'sellerUrl' in candidate ? candidate.sellerUrl : candidate.url;
      return { candidate, page: await context.directPage(url), identity: exactMatch, retrievedAt: context.now().toISOString() };
    },
  });

  const result = await run([provider]);
  assert.equal(result.attempts[0]?.verification.succeeded, 1);
  assert.equal(result.attempts[0]?.verification.failed, 1);
  assert.equal(result.attempts[0]?.status, 'verified');
});

test('comparison providers share one request-scoped seller verification and economic dedupe merges the downstream offer', async () => {
  const sellerUrl = 'https://seller.example.com/products/1?utm_source=portal';
  const canonicalSellerUrl = 'https://seller.example.com/products/1';
  let sellerFetches = 0;

  const comparison = (id: 'danawa' | 'enuri', market: string): MarketProvider => fakeProvider({
    id,
    market,
    discoveryUrls: [`https://${id}.example.com/compare/1`],
    sellerExpansionBudget: 2,
    verificationBudget: 2,
    expandSellers: async () => [{
      providerId: id,
      discoveredFrom: [id],
      comparisonUrl: `https://${id}.example.com/compare/1`,
      sellerName: '동일판매자',
      sellerUrl,
      sellerProductId: 'seller-product-1',
    }],
    extractOffer: (verified) => decisiveOffer(canonicalSellerUrl, '동일판매자몰', [id]),
  });

  const result = await run([
    comparison('danawa', '다나와'),
    comparison('enuri', '에누리'),
  ], {
    directPage: async (url) => {
      if (url.includes('seller.example.com')) sellerFetches += 1;
      return directPage(url.includes('seller.example.com') ? canonicalSellerUrl : url);
    },
  });

  assert.equal(sellerFetches, 1);
  const downstream = result.offers.filter((offer) => offer.url === canonicalSellerUrl && offer.verification === 'page_verified');
  assert.equal(downstream.length, 1);
  assert.deepEqual(new Set(downstream[0]?.sellerInfo?.discoveredBy), new Set(['danawa', 'enuri']));
});

test('production provider coverage injects a bounded seller redirect resolver into comparison expansion', async () => {
  const bridgeUrl = 'https://prod.danawa.com/bridge?id=777';
  const sellerUrl = 'https://seller.example.com/products/777';
  let resolverCalls = 0;
  let sellerFetches = 0;
  const provider = fakeProvider({
    id: 'danawa',
    market: '다나와',
    discoveryUrls: ['https://prod.danawa.com/info/?pcode=777'],
    sellerExpansionBudget: 1,
    verificationBudget: 1,
    expandSellers: async (_candidate, context) => {
      if (!context.resolveSellerRedirect) return [];
      const resolved = await context.resolveSellerRedirect(bridgeUrl);
      if (resolved.status !== 'resolved' || !resolved.resolvedUrl) return [];
      return [{
        providerId: 'danawa',
        discoveredFrom: ['danawa'],
        comparisonUrl: 'https://prod.danawa.com/info/?pcode=777',
        sellerUrl: resolved.resolvedUrl,
        resolutionMethod: 'redirect_resolution',
      }];
    },
    extractOffer: (verified) => decisiveOffer(verified.page.url, '판매자몰', ['danawa']),
  });

  const result = await run([provider], {
    sellerRedirectResolver: async (url: string) => {
      resolverCalls += 1;
      assert.equal(url, bridgeUrl);
      return { originalUrl: url, resolvedUrl: sellerUrl, hops: [url, sellerUrl], status: 'resolved' as const };
    },
    directPage: async (url) => {
      if (url === sellerUrl) sellerFetches += 1;
      return directPage(url);
    },
  } as never);

  assert.equal(resolverCalls, 1);
  assert.equal(sellerFetches, 1);
  assert.equal(result.attempts[0]?.status, 'verified');
  assert.equal(result.offers.some((offer) => offer.url === sellerUrl && offer.eligible), true);
});

test('unexpected v2 adapter failure may use the legacy gated fallback without failing the provider', async () => {
  const broken = fakeProvider({
    id: 'ssg',
    market: 'SSG',
    discover: async () => { throw new Error('unexpected adapter implementation failure'); },
  });
  let fallbackCalls = 0;
  const fallbackOffer = decisiveOffer('https://fallback.example.com/products/1', 'SSG', ['legacy-fallback']);
  const fallbackAttempt: ProviderAttempt = {
    market: 'SSG',
    attemptedAt: '2026-08-25T21:00:00.000Z',
    completedAt: '2026-08-25T21:00:00.000Z',
    discovery: { attempted: true, hitCount: 1 },
    identity: { exact: 1, uncertain: 0, different: 0 },
    verification: { attempted: 1, succeeded: 1, failed: 0 },
    offers: { extracted: 1, eligible: 1 },
    status: 'verified',
  };
  const legacyFallback = async (): Promise<ProviderPipelineResult> => {
    fallbackCalls += 1;
    return { evidence: [], offers: [fallbackOffer], attempt: fallbackAttempt };
  };

  const result = await run([broken], { legacyFallback });
  assert.equal(fallbackCalls, 1);
  assert.equal(result.attempts[0]?.status, 'verified');
  assert.equal(result.offers.some((offer) => offer.url === fallbackOffer.url && offer.eligible), true);
});

test('expired total budget yields deterministic not_attempted coverage without sleeping', async () => {
  const providers = [
    fakeProvider({ id: 'lotteon', market: '롯데ON' }),
    fakeProvider({ id: 'himart', market: '롯데하이마트' }),
  ];

  const result = await run(providers, { totalDeadlineMs: 0 });
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(result.attempts.map((item) => item.status), ['not_attempted', 'not_attempted']);
  assert.deepEqual(result.attempts.map((item) => item.discovery.attempted), [false, false]);
});
