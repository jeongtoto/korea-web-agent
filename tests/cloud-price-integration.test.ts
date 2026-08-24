import test from 'node:test';
import assert from 'node:assert/strict';
import { runCloudResearch } from '../src/cloud/research-service.ts';
import { shapeAgentResearchJob } from '../src/agent/research.ts';
import type { JsonKeyValueStore } from '../src/cloud/relay-state.ts';
import type { ResearchJob } from '../src/core/types.ts';

class MemoryStore implements JsonKeyValueStore {
  data = new Map<string, unknown>();
  async getJSON<T>(key: string): Promise<T | null> { return (this.data.get(key) as T | undefined) ?? null; }
  async setJSON(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

function publicJob(id: string, price: number, at: string): ResearchJob {
  return {
    id,
    status: 'completed',
    request: { question: 'QWGE43UT1 가격', category: 'product' },
    createdAt: at,
    updatedAt: at,
    completedAt: at,
    target: { kind: 'product', model: 'QWGE43UT1', variant: 'EKWBYME78W(V3)', name: '와이드뷰 이동형 패키지' },
    sourceResults: [],
    evidence: [],
    relay: { available: false, used: false, mode: 'public_only' },
    report: {
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
      bestOffers: {
        cash: {
          basis: 'cash', rank: 1, amount: price,
          reasons: ['cash'],
          offer: {
            id: 'naver:1', market: '네이버', title: '와이드뷰', url: 'https://brand.naver.com/example/products/1', currency: 'KRW',
            retrievedAt: at, verification: 'page_verified', condition: 'new', identityScore: 1, bundleComplete: true, eligible: true,
            shippingFee: 0, totalCashPrice: price, conditions: [], riskFlags: [], exclusionReasons: [],
          },
        },
      },
    },
    errors: [],
  };
}

test('cloud research persists public cash history and exposes it through ProductReport and Agent result', async () => {
  const store = new MemoryStore();
  let run = 0;
  const times = ['2026-08-01T09:00:00.000Z', '2026-08-24T09:00:00.000Z'];
  const prices = [410000, 389000];

  let last: ResearchJob | undefined;
  for (run = 0; run < 2; run += 1) {
    last = await runCloudResearch({ question: 'QWGE43UT1 가격', category: 'product' }, {
      store,
      nowMs: () => Date.parse(times[run]!),
      publicResearch: async () => publicJob(`job-${run}`, prices[run]!, times[run]!),
    });
  }

  assert.ok(last?.report?.priceHistory);
  assert.equal(last.report.priceHistory.comparison.direction, 'down');
  assert.equal(last.report.priceHistory.position.minimum, 389000);
  const shaped = shapeAgentResearchJob(last);
  assert.equal(shaped.priceHistory?.sku, 'QWGE43UT1+EKWBYME78W(V3)');
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
