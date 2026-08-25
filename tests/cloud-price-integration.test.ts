import test from 'node:test';
import assert from 'node:assert/strict';
import { runCloudResearch } from '../src/cloud/research-service.ts';
import { getPriceHistory } from '../src/cloud/price-history.ts';
import { shapeAgentResearchJob } from '../src/agent/research.ts';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import type { JsonKeyValueStore } from '../src/cloud/relay-state.ts';
import type { MarketOffer, ResearchJob } from '../src/core/types.ts';

class MemoryStore implements JsonKeyValueStore {
  data = new Map<string, unknown>();
  async getJSON<T>(key: string): Promise<T | null> { return (this.data.get(key) as T | undefined) ?? null; }
  async setJSON(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

const canonicalV3 = compileCanonicalIdentity(
  {
    kind: 'product',
    brand: '와이드뷰',
    model: 'QWGE43UT1',
    name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
  },
  'QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
);

interface PublicJobOptions {
  targetVariant?: string;
  offerOverrides?: Partial<MarketOffer>;
  includeCashWinner?: boolean;
  personalizedCashPrice?: number;
}

function publicJob(id: string, price: number, at: string, options: PublicJobOptions = {}): ResearchJob {
  const target = {
    kind: 'product' as const,
    brand: '와이드뷰',
    model: 'QWGE43UT1',
    variant: options.targetVariant ?? 'EKWBYME78W(V3)',
    name: '와이드뷰 이동형 패키지',
  };
  const baseOffer: MarketOffer = {
    id: 'naver:1',
    market: '네이버',
    title: 'QWGE43UT1 EKWBYME78W V3 43인치 신품 패키지',
    url: 'https://brand.naver.com/example/products/1',
    currency: 'KRW',
    retrievedAt: at,
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
    totalCashPrice: price,
    availability: 'in_stock',
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
    ...options.offerOverrides,
  };
  const report: NonNullable<ResearchJob['report']> = {
    decision: 'BUY',
    confidence: 0.8,
    confidenceDimensions: { identity: 0.9, price: 0.8, officialSpecs: 0.5, reviews: 0.5, negativeSignals: 0.5, personalizedPrice: 0 },
    title: '와이드뷰 이동형 패키지',
    summary: 'test',
    reasons: [], strengths: [], weaknesses: [], missingInformation: [], evidence: [], sourceCount: 1,
    price: {
      currency: 'KRW',
      cashPaymentPrice: price,
      basePoints: 5000,
      membershipPoints: 10000,
      liveEndAt: '2026-08-31T14:59:59.000Z',
      sourceUrl: 'https://brand.naver.com/example/products/1',
    },
  };
  if (options.includeCashWinner !== false) {
    report.bestOffers = {
      cash: {
        basis: 'cash', rank: 1, amount: price,
        reasons: ['cash'],
        offer: baseOffer,
      },
    };
  }
  if (options.personalizedCashPrice !== undefined) {
    report.personalizedPrice = {
      currency: 'KRW',
      cashPaymentPrice: options.personalizedCashPrice,
      shippingFee: 0,
      sourceUrl: 'https://brand.naver.com/example/products/1',
    };
  }

  return {
    id,
    status: 'completed',
    request: { question: 'QWGE43UT1 가격', category: 'product' },
    createdAt: at,
    updatedAt: at,
    completedAt: at,
    target,
    researchContext: {
      identityConfidence: 0.96,
      resolvedTarget: target,
      canonicalIdentity: canonicalV3,
    },
    sourceResults: [],
    evidence: [],
    relay: { available: false, used: false, mode: 'public_only' },
    report,
    errors: [],
  };
}

test('cloud research persists decisive public cash history by canonical bundle across seller wording', async () => {
  const store = new MemoryStore();
  const times = ['2026-08-01T09:00:00.000Z', '2026-08-24T09:00:00.000Z'];
  const prices = [410000, 389000];
  const variants = ['삼탠바이미 V3 판매처 표기', '43형 이동식 스탠드 포함'];

  let last: ResearchJob | undefined;
  for (let run = 0; run < 2; run += 1) {
    last = await runCloudResearch({ question: 'QWGE43UT1 가격', category: 'product' }, {
      store,
      nowMs: () => Date.parse(times[run]!),
      publicResearch: async () => publicJob(`job-${run}`, prices[run]!, times[run]!, { targetVariant: variants[run] }),
    });
  }

  assert.ok(last?.report?.priceHistory);
  assert.equal(last.report.priceHistory.comparison.direction, 'down');
  assert.equal(last.report.priceHistory.position.minimum, 389000);
  const shaped = shapeAgentResearchJob(last);
  assert.equal(shaped.priceHistory?.sku, '와이드뷰:QWGE43UT1:43:EKWBYME78W@V3:NEW');
  assert.deepEqual(shaped.priceHistory?.observations.map((item) => item.cashPrice), [410000, 389000]);
});

test('body-only or uncertain identity offer cannot contaminate the exact V3 bundle history', async () => {
  const store = new MemoryStore();
  const firstAt = '2026-08-01T09:00:00.000Z';
  const secondAt = '2026-08-24T09:00:00.000Z';

  await runCloudResearch({ question: 'QWGE43UT1 가격', category: 'product' }, {
    store,
    nowMs: () => Date.parse(firstAt),
    publicResearch: async () => publicJob('bundle', 410000, firstAt),
  });
  await runCloudResearch({ question: 'QWGE43UT1 가격', category: 'product' }, {
    store,
    nowMs: () => Date.parse(secondAt),
    publicResearch: async () => publicJob('body-only', 350000, secondAt, {
      offerOverrides: {
        title: 'QWGE43UT1 43인치 TV 본체만',
        identityVerdict: 'uncertain',
        bundleComplete: false,
        eligible: false,
      },
    }),
  });

  const history = await getPriceHistory(store, { kind: 'product', model: 'QWGE43UT1' }, Date.parse(secondAt), canonicalV3);
  assert.deepEqual(history?.observations.map((item) => item.cashPrice), [410000]);
});

test('search metadata winner, unknown shipping, and report.price fallback are never appended for canonical exact-product history', async () => {
  const at = '2026-08-24T09:00:00.000Z';
  const cases: Array<[string, PublicJobOptions]> = [
    ['search-metadata', {
      offerOverrides: {
        verification: 'search_metadata',
        fieldVerification: { identity: 'search_metadata', price: 'search_metadata', shipping: 'search_metadata' },
      },
    }],
    ['unknown-shipping', {
      offerOverrides: {
        shippingFee: undefined,
        totalCashPrice: undefined,
        fieldVerification: { identity: 'page_verified', price: 'page_verified', shipping: 'unverified' },
      },
    }],
    ['fallback-only', { includeCashWinner: false }],
  ];

  for (const [name, options] of cases) {
    const store = new MemoryStore();
    const job = await runCloudResearch({ question: 'QWGE43UT1 가격', category: 'product' }, {
      store,
      nowMs: () => Date.parse(at),
      publicResearch: async () => publicJob(name, 389000, at, options),
    });
    assert.equal(job.report?.priceHistory, undefined, name);
    const history = await getPriceHistory(store, job.target, Date.parse(at), canonicalV3);
    assert.deepEqual(history?.observations ?? [], [], name);
  }
});

test('personalized Relay price never replaces the public observation written to history', async () => {
  const store = new MemoryStore();
  const at = '2026-08-24T09:00:00.000Z';
  const job = await runCloudResearch({ question: 'QWGE43UT1 가격', category: 'product' }, {
    store,
    nowMs: () => Date.parse(at),
    publicResearch: async () => publicJob('public-with-personalized', 410000, at, { personalizedCashPrice: 379000 }),
  });

  assert.deepEqual(job.report?.priceHistory?.observations.map((item) => item.cashPrice), [410000]);
});

test('report intelligence exposes stable rows, member/non-member scenarios and exact known live end date', async () => {
  const store = new MemoryStore();
  const at = '2026-08-24T09:00:00.000Z';
  const job = await runCloudResearch({ question: 'QWGE43UT1 가격', category: 'product' }, {
    store,
    nowMs: () => Date.parse(at),
    publicResearch: async () => publicJob('job-intel', 389000, at),
  });

  assert.deepEqual(job.report?.standardPriceRows?.map((row) => row.key), [
    'cash', 'card', 'effective_without_membership', 'effective_with_membership',
  ]);
  assert.equal(job.report?.membershipScenarios?.withoutMembership.paymentPrice, 389000);
  assert.equal(job.report?.membershipScenarios?.withMembership.expectedPoints, 15000);
  assert.equal(job.report?.eventWindow?.endsOn, '2026-08-31');
  assert.equal(job.report?.eventWindow?.status, 'active');
});