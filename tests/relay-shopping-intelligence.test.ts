import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completePersistentRelay,
  queuePersistentRelay,
  saveResearchJob,
  type JsonKeyValueStore,
} from '../src/cloud/relay-state.ts';
import type { ResearchJob } from '../src/core/types.ts';

class MemoryStore implements JsonKeyValueStore {
  data = new Map<string, unknown>();
  async getJSON<T>(key: string): Promise<T | null> { return (this.data.get(key) as T | undefined) ?? null; }
  async setJSON(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

const SECRET = '0123456789abcdef0123456789abcdef';
const URL = 'https://brand.naver.com/example/products/1';

function publicJob(): ResearchJob {
  return {
    id: 'relay-intelligence',
    status: 'running',
    request: { question: 'QWGE43UT1 가격', category: 'product', url: URL, includeLocalRelay: true },
    createdAt: '2026-08-24T08:00:00.000Z',
    updatedAt: '2026-08-24T08:00:00.000Z',
    target: { kind: 'product', model: 'QWGE43UT1', variant: 'EKWBYME78W(V3)', canonicalUrl: URL },
    sourceResults: [],
    evidence: [],
    relay: { available: true, used: false, mode: 'public_only' },
    report: {
      decision: 'BUY', confidence: 0.8,
      confidenceDimensions: { identity: 0.9, price: 0.8, officialSpecs: 0.5, reviews: 0.5, negativeSignals: 0.5, personalizedPrice: 0 },
      title: 'QWGE43UT1 + EKWBYME78W(V3) 이동형 패키지', summary: 'public', reasons: [], strengths: [], weaknesses: [], missingInformation: [], evidence: [], sourceCount: 1,
      price: { currency: 'KRW', cashPaymentPrice: 389000, sourceUrl: URL },
      priceHistory: {
        sku: 'QWGE43UT1+EKWBYME78W(V3)',
        observations: [
          { observedAt: '2026-08-01T08:00:00.000Z', cashPrice: 410000, sourceUrl: URL, market: '네이버' },
          { observedAt: '2026-08-24T08:00:00.000Z', cashPrice: 389000, sourceUrl: URL, market: '네이버' },
        ],
        comparison: { direction: 'down', previousPrice: 410000, currentPrice: 389000, absoluteChange: -21000, percentageChange: -5.12 },
        position: { label: 'six_month_low', current: 389000, minimum: 389000, maximum: 410000, average: 399500, sampleCount: 2 },
      },
    },
    errors: [],
  };
}

test('personalized relay preserves public six-month history while recalculating member rows from personalized fields', async () => {
  const store = new MemoryStore();
  const job = publicJob();
  await saveResearchJob(store, job);
  const relay = await queuePersistentRelay(store, job.id, URL, SECRET, Date.parse('2026-08-24T09:00:00.000Z'), 30_000);

  const merged = await completePersistentRelay(store, relay.id, {
    title: 'QWGE43UT1 + EKWBYME78W(V3) 이동형 패키지',
    cashPaymentPrice: 369000,
    basePoints: 5000,
    membershipPoints: 12000,
    liveEndAt: '2026-08-31T14:59:59.000Z',
    sourceUrl: URL,
  }, '2026-08-24T09:00:05.000Z');

  assert.equal(merged.report?.priceHistory?.sku, 'QWGE43UT1+EKWBYME78W(V3)');
  assert.deepEqual(merged.report?.priceHistory?.observations.map((item) => item.cashPrice), [410000, 389000]);
  assert.equal(merged.report?.membershipScenarios?.withoutMembership.paymentPrice, 369000);
  assert.equal(merged.report?.membershipScenarios?.withMembership.expectedPoints, 17000);
  assert.equal(merged.report?.eventWindow?.endsOn, '2026-08-31');
  assert.equal(merged.report?.standardPriceRows?.[0]?.amount, 369000);
});
