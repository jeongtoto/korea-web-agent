import test from 'node:test';
import assert from 'node:assert/strict';
import { runCloudResearch } from '../src/cloud/research-service.ts';
import { markPersistentConnectorSeen, getStoredResearchJob, pollPersistentRelay, type JsonKeyValueStore } from '../src/cloud/relay-state.ts';
import type { ResearchJob, ResearchRequest } from '../src/core/types.ts';

class MemoryStore implements JsonKeyValueStore {
  data = new Map<string, unknown>();
  async getJSON<T>(key: string): Promise<T | null> { return (this.data.get(key) as T | undefined) ?? null; }
  async setJSON(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

const SECRET = '0123456789abcdef0123456789abcdef';
const URL = 'https://brand.naver.com/mildo/products/7322162980';

function publicJob(request: ResearchRequest): ResearchJob {
  return {
    id: 'job-cloud', status: 'completed', request, createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:05.000Z', completedAt: '2026-08-17T00:00:05.000Z',
    target: {
      kind: 'product',
      brand: '와이드뷰',
      name: '와이드무빙뷰 삼탠바이미V3 43인치 UHD 4K',
      model: 'QWGE43UT1',
      variant: 'EKWBYME78W(V3) 43인치',
      productId: '7322162980',
      canonicalUrl: URL,
    },
    sourceResults: [], evidence: [], relay: { available: false, used: false, mode: 'public_only' }, errors: [],
    report: { decision: 'INSUFFICIENT', confidence: 0, title: 'mildo', summary: 'public', reasons: [], strengths: [], weaknesses: [], missingInformation: [], evidence: [], sourceCount: 0 },
  };
}

test('cloud research queues persistent relay only when connector is online and returns a pollable running job', async () => {
  const store = new MemoryStore();
  await markPersistentConnectorSeen(store, 9_900);
  let observed: ResearchRequest | null = null;
  const result = await runCloudResearch(
    { question: '내 쿠폰가까지 봐줘', url: URL, includeLocalRelay: true, category: 'product' },
    {
      store,
      relaySecret: SECRET,
      nowMs: () => 10_000,
      publicResearch: async (request) => { observed = request; return publicJob(request); },
    },
  );

  assert.equal(observed?.includeLocalRelay, false);
  assert.equal(result.status, 'running');
  assert.equal(result.relay.available, true);
  assert.equal(result.relay.used, false);
  assert.match(result.relay.message ?? '', /waiting|pc/i);
  assert.equal((await getStoredResearchJob(store, result.id))?.status, 'running');
  const relayJob = await pollPersistentRelay(store, 10_001);
  assert.deepEqual((relayJob as any)?.targetHint, {
    brand: '와이드뷰',
    name: '와이드무빙뷰 삼탠바이미V3 43인치 UHD 4K',
    model: 'QWGE43UT1',
    variant: 'EKWBYME78W(V3) 43인치',
    productId: '7322162980',
  });
});

test('cloud research falls back to completed public result when connector is offline', async () => {
  const store = new MemoryStore();
  const result = await runCloudResearch(
    { question: '어때?', url: URL, includeLocalRelay: true, category: 'product' },
    {
      store,
      relaySecret: SECRET,
      nowMs: () => 10_000,
      publicResearch: async (request) => publicJob(request),
    },
  );
  assert.equal(result.status, 'completed');
  assert.equal(result.relay.available, false);
  assert.equal(result.relay.used, false);
  assert.match(result.relay.message ?? '', /offline|public/i);
});
