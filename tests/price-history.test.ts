import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendPriceObservation,
  getPriceHistory,
  priceHistoryKey,
} from '../src/cloud/price-history.ts';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import type { JsonKeyValueStore } from '../src/cloud/relay-state.ts';
import type { NormalizedTarget } from '../src/core/types.ts';

class MemoryStore implements JsonKeyValueStore {
  data = new Map<string, unknown>();
  async getJSON<T>(key: string): Promise<T | null> { return (this.data.get(key) as T | undefined) ?? null; }
  async setJSON(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

const target: NormalizedTarget = {
  kind: 'product',
  brand: '와이드뷰',
  name: '와이드뷰 43인치 이동형 패키지',
  model: ' QWGE-43 UT1 ',
  variant: 'EKWBYME78W (v 3)',
};

const canonicalV3 = compileCanonicalIdentity(
  { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 패키지' },
  'QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
);
const canonicalV2 = compileCanonicalIdentity(
  { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', name: 'QWGE43UT1 + EKWBYME78W(V2) 43인치 패키지' },
  'QWGE43UT1 + EKWBYME78W(V2) 43인치 신품 패키지',
);

test('legacy price history key uses normalized model and variant, never the raw title', () => {
  assert.equal(priceHistoryKey(target), 'price:history:QWGE43UT1+EKWBYME78W(V3)');
  assert.equal(priceHistoryKey({ kind: 'product', name: '이름만 있는 상품' }), undefined);
});

test('canonical bundle key is stable across seller wording and separates V2 from V3', () => {
  const sellerA: NormalizedTarget = {
    kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', variant: '삼탠바이미 V3 세트', name: '화이트에디션 43인치',
  };
  const sellerB: NormalizedTarget = {
    kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', variant: '43형 스탠드 포함', name: '이동형 TV 패키지',
  };
  const v3a = priceHistoryKey(sellerA, canonicalV3);
  const v3b = priceHistoryKey(sellerB, canonicalV3);
  const v2 = priceHistoryKey(sellerA, canonicalV2);

  assert.equal(v3a, v3b);
  assert.ok(v3a?.includes('EKWBYME78W@V3'));
  assert.notEqual(v3a, v2);
});

test('appends public observations, deduplicates identical timestamps, and prunes older than 183 days', async () => {
  const store = new MemoryStore();
  const now = Date.parse('2026-08-24T09:00:00.000Z');

  await appendPriceObservation(store, target, {
    observedAt: '2026-02-20T09:00:00.000Z',
    cashPrice: 450000,
    sourceUrl: 'https://example.com/old',
    market: 'old',
  }, now);
  await appendPriceObservation(store, target, {
    observedAt: '2026-08-01T09:00:00.000Z',
    cashPrice: 410000,
    sourceUrl: 'https://example.com/a',
    market: 'A',
  }, now);
  await appendPriceObservation(store, target, {
    observedAt: '2026-08-24T09:00:00.000Z',
    cashPrice: 399000,
    sourceUrl: 'https://example.com/b',
    market: 'B',
  }, now);
  await appendPriceObservation(store, target, {
    observedAt: '2026-08-24T09:00:00.000Z',
    cashPrice: 389000,
    sourceUrl: 'https://example.com/c',
    market: 'C',
  }, now);

  const history = await getPriceHistory(store, target, now);
  assert.ok(history);
  assert.equal(history.observations.length, 2);
  assert.deepEqual(history.observations.map((item) => item.cashPrice), [410000, 389000]);
  assert.equal(history.comparison.direction, 'down');
  assert.equal(history.comparison.absoluteChange, -21000);
  assert.equal(history.position.minimum, 389000);
  assert.equal(history.position.maximum, 410000);
  assert.equal(history.position.sampleCount, 2);
});

test('canonical append and read share one series even when target seller wording differs', async () => {
  const store = new MemoryStore();
  const now = Date.parse('2026-08-24T09:00:00.000Z');
  const firstTarget = { kind: 'product' as const, model: 'QWGE43UT1', variant: 'seller wording A' };
  const secondTarget = { kind: 'product' as const, model: 'QWGE43UT1', variant: 'seller wording B' };

  await appendPriceObservation(store, firstTarget, {
    observedAt: '2026-08-01T09:00:00.000Z', cashPrice: 410000,
  }, now, canonicalV3);
  await appendPriceObservation(store, secondTarget, {
    observedAt: '2026-08-24T09:00:00.000Z', cashPrice: 389000,
  }, now, canonicalV3);

  const history = await getPriceHistory(store, secondTarget, now, canonicalV3);
  assert.deepEqual(history?.observations.map((item) => item.cashPrice), [410000, 389000]);
});

test('refuses to persist history when stable SKU identity is missing', async () => {
  const store = new MemoryStore();
  const result = await appendPriceObservation(store, { kind: 'product', name: 'generic title' }, {
    observedAt: '2026-08-24T09:00:00.000Z',
    cashPrice: 100000,
    sourceUrl: 'https://example.com',
  });
  assert.equal(result, null);
  assert.equal(store.data.size, 0);
});