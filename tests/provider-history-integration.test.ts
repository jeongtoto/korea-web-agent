import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import type { MarketOffer, ProductReport, ResearchJob } from '../src/core/types.ts';
import { runCloudResearch } from '../src/cloud/research-service.ts';
import { getPriceHistory } from '../src/cloud/price-history.ts';
import type { JsonKeyValueStore } from '../src/cloud/relay-state.ts';
import { deduplicateSellerOffers } from '../src/providers/offer-dedupe.ts';

class MemoryStore implements JsonKeyValueStore {
  data = new Map<string, unknown>();
  async getJSON<T>(key: string): Promise<T | null> { return (this.data.get(key) as T | undefined) ?? null; }
  async setJSON(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

const AT = '2026-08-26T05:00:00.000Z';
const SELLER_URL = 'https://www.11st.co.kr/products/12345';
const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  variant: 'EKWBYME78W(V3)',
  name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};
const canonical = compileCanonicalIdentity(
  target,
  '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 이동형 패키지',
);

function exactOffer(overrides: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: 'seller:12345',
    market: '11번가',
    title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 이동형 패키지',
    url: SELLER_URL,
    currency: 'KRW',
    retrievedAt: AT,
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
    salePrice: 449000,
    shipping: { status: 'free', verification: 'page_verified' },
    totalCashPrice: 449000,
    availability: 'in_stock',
    sellerInfo: {
      name: '판매처A',
      productId: '12345',
      canonicalUrl: SELLER_URL,
    },
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
    ...overrides,
  };
}

function jobWithReport(id: string, report: ProductReport): ResearchJob {
  return {
    id,
    status: 'completed',
    request: { question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3)의 현재 가격', category: 'product' },
    createdAt: AT,
    updatedAt: AT,
    completedAt: AT,
    target,
    researchContext: {
      identityConfidence: 0.99,
      resolvedTarget: target,
      canonicalIdentity: canonical,
    },
    sourceResults: [],
    evidence: [],
    relay: { available: false, used: false, mode: 'public_only' },
    report,
    errors: [],
  };
}

function reportFor(offers: MarketOffer[], bestOffers: ProductReport['bestOffers']): ProductReport {
  return {
    decision: 'BUY',
    confidence: 0.8,
    confidenceDimensions: {
      identity: 1,
      price: 0.9,
      officialSpecs: 0.5,
      reviews: 0.5,
      negativeSignals: 0.5,
      personalizedPrice: 0,
    },
    title: target.name,
    summary: 'provider history fixture',
    reasons: [],
    strengths: [],
    weaknesses: [],
    missingInformation: [],
    evidence: [],
    sourceCount: 1,
    offers,
    bestOffers,
  };
}

async function historyAfter(report: ProductReport, id: string): Promise<ResearchJob> {
  const store = new MemoryStore();
  return runCloudResearch(
    { question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3)의 현재 가격', category: 'product' },
    {
      store,
      nowMs: () => Date.parse(AT),
      publicResearch: async () => jobWithReport(id, report),
    },
  );
}

test('Danawa Enuri and Naver discovery of one downstream seller becomes one economic offer and one public-history observation', async () => {
  const discovered = [
    exactOffer({
      id: 'naver:12345',
      url: `${SELLER_URL}?utm_source=naver`,
      sellerInfo: { name: '판매처A', productId: '12345', canonicalUrl: `${SELLER_URL}?utm_source=naver`, discoveredBy: ['naver'] },
    }),
    exactOffer({
      id: 'danawa:12345',
      url: `${SELLER_URL}?utm_source=danawa`,
      sellerInfo: { name: '판매처A', productId: '12345', canonicalUrl: `${SELLER_URL}?utm_source=danawa`, discoveredBy: ['danawa'] },
    }),
    exactOffer({
      id: 'enuri:12345',
      url: `${SELLER_URL}?utm_source=enuri`,
      sellerInfo: { name: '판매처A', productId: '12345', canonicalUrl: `${SELLER_URL}?utm_source=enuri`, discoveredBy: ['enuri'] },
    }),
  ];

  const deduped = deduplicateSellerOffers(discovered);
  assert.equal(deduped.length, 1);
  assert.deepEqual(new Set(deduped[0]?.sellerInfo?.discoveredBy), new Set(['naver', 'danawa', 'enuri']));

  const winner = deduped[0]!;
  const store = new MemoryStore();
  const job = await runCloudResearch(
    { question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3)의 현재 가격', category: 'product' },
    {
      store,
      nowMs: () => Date.parse(AT),
      publicResearch: async () => jobWithReport('deduped-history', reportFor(deduped, {
        cash: { basis: 'cash', rank: 1, amount: 449000, offer: winner, reasons: ['verified downstream seller'] },
      })),
    },
  );

  assert.equal(job.report?.offers?.length, 1);
  assert.deepEqual(job.report?.priceHistory?.observations.map((item) => item.cashPrice), [449000]);
  const history = await getPriceHistory(store, target, Date.parse(AT), canonical);
  assert.equal(history?.observations.length, 1);
});

test('comparison/search/expired/publicConditional/account-only/unknown-shipping values never append public cash history', async () => {
  const cases: Array<[string, ProductReport]> = [
    ['search snippet', reportFor([exactOffer({ verification: 'search_metadata' })], {
      cash: {
        basis: 'cash', rank: 1, amount: 330000,
        offer: exactOffer({
          id: 'search:1',
          verification: 'search_metadata',
          fieldVerification: { identity: 'search_metadata', price: 'search_metadata', shipping: 'search_metadata' },
          salePrice: 330000,
          shipping: undefined,
          shippingFee: 0,
          totalCashPrice: 330000,
        }),
        reasons: ['snippet'],
      },
    })],
    ['comparison advertisement', reportFor([exactOffer({ market: '다나와', verification: 'search_metadata' })], {
      cash: {
        basis: 'cash', rank: 1, amount: 439000,
        offer: exactOffer({
          id: 'danawa:ad', market: '다나와', verification: 'search_metadata',
          fieldVerification: { identity: 'search_metadata', price: 'search_metadata', shipping: 'unverified' },
          salePrice: 439000,
          shipping: undefined,
          shippingFee: undefined,
          totalCashPrice: undefined,
        }),
        reasons: ['comparison advertisement'],
      },
    })],
    ['expired deal', reportFor([exactOffer()], {
      cash: {
        basis: 'cash', rank: 1, amount: 359000,
        offer: exactOffer({
          id: 'talkdeal:expired', market: '카카오 톡딜', salePrice: 359000, totalCashPrice: 359000,
          promotion: { type: 'time_deal', active: false, endsAt: '2026-08-25T05:00:00.000Z' },
        }),
        reasons: ['expired deal'],
      },
    })],
    ['publicConditional only', reportFor([exactOffer()], {
      publicConditional: {
        basis: 'public_conditional', rank: 1, amount: 379000,
        offer: exactOffer({
          id: 'public-coupon', couponPrice: 379000,
          promotion: { type: 'public_coupon', active: true, condition: '공개 쿠폰' },
        }),
        reasons: ['public coupon'],
      },
    })],
    ['account-only value', reportFor([exactOffer()], {
      publicConditional: {
        basis: 'public_conditional', rank: 1, amount: 369000,
        offer: exactOffer({
          id: 'account-only', couponPrice: 369000,
          promotion: { type: 'public_coupon', active: true, accountRequired: true, condition: '로그인 전용' },
        }),
        reasons: ['account only'],
      },
    })],
    ['unknown shipping', reportFor([exactOffer()], {
      cash: {
        basis: 'cash', rank: 1, amount: 449000,
        offer: exactOffer({
          id: 'shipping-unknown',
          shipping: { status: 'unknown', verification: 'unverified' },
          shippingFee: undefined,
          totalCashPrice: undefined,
          fieldVerification: { identity: 'page_verified', price: 'page_verified', shipping: 'unverified' },
        }),
        reasons: ['shipping unknown'],
      },
    })],
  ];

  for (const [name, report] of cases) {
    const job = await historyAfter(report, name.replace(/\s+/g, '-'));
    assert.equal(job.report?.priceHistory, undefined, name);
  }
});

test('active unconditional TalkDeal that passes ordinary cash gates may append canonical public history', async () => {
  const talkDeal = exactOffer({
    id: 'talkdeal:active',
    market: '카카오 톡딜',
    salePrice: 379000,
    totalCashPrice: 379000,
    promotion: {
      type: 'time_deal',
      active: true,
      startsAt: '2026-08-26T00:00:00.000Z',
      endsAt: '2026-08-26T23:59:59.000Z',
    },
  });
  const job = await historyAfter(reportFor([talkDeal], {
    cash: { basis: 'cash', rank: 1, amount: 379000, offer: talkDeal, reasons: ['active unconditional deal'] },
  }), 'active-talkdeal');

  assert.deepEqual(job.report?.priceHistory?.observations.map((item) => item.cashPrice), [379000]);
});

test('personalized Relay snapshot cannot replace the verified public cash observation', async () => {
  const publicOffer = exactOffer({ salePrice: 410000, totalCashPrice: 410000 });
  const report = reportFor([publicOffer], {
    cash: { basis: 'cash', rank: 1, amount: 410000, offer: publicOffer, reasons: ['public cash'] },
  });
  report.personalizedPrice = {
    currency: 'KRW',
    cashPaymentPrice: 369000,
    shippingFee: 0,
    sourceUrl: SELLER_URL,
  };

  const job = await historyAfter(report, 'personalized-isolation');
  assert.deepEqual(job.report?.priceHistory?.observations.map((item) => item.cashPrice), [410000]);
});
