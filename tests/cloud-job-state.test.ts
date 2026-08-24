import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimQueuedAgentResearch,
  createQueuedAgentResearch,
  failAgentResearchJob,
  finishAgentResearchJob,
  getAgentResearchJobState,
  getAgentResearchResult,
} from '../src/cloud/job-state.ts';
import type { JsonKeyValueStore } from '../src/cloud/relay-state.ts';

class MemoryStore implements JsonKeyValueStore {
  data = new Map<string, unknown>();
  async getJSON<T>(key: string): Promise<T | null> { return (this.data.get(key) as T | undefined) ?? null; }
  async setJSON(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

test('agent cloud job transitions queued to running and stores terminal compact result', async () => {
  const store = new MemoryStore();
  const queued = await createQueuedAgentResearch(store, {
    query: '43인치 이동형 TV 추천',
    purchaseContext: { paymentMethods: ['토스페이'] },
  }, { id: 'agent-1', nowMs: 1_000 });

  assert.equal(queued.status, 'queued');
  assert.equal(queued.jobId, 'agent-1');
  assert.equal(queued.pollUrl, '/api/agent/job?jobId=agent-1');
  assert.equal((await getAgentResearchJobState(store, 'agent-1'))?.status, 'queued');

  const claimed = await claimQueuedAgentResearch(store, 'agent-1', 2_000);
  assert.equal(claimed?.query, '43인치 이동형 TV 추천');
  assert.deepEqual(claimed?.purchaseContext?.paymentMethods, ['토스페이']);
  assert.equal((await getAgentResearchJobState(store, 'agent-1'))?.status, 'running');

  const result = {
    status: 'completed' as const,
    jobId: 'agent-1',
    query: '43인치 이동형 TV 추천',
    intent: { productResearch: true, purchaseDecision: true, priceSensitive: true, personalizedPriceUseful: true, specOnly: false },
    product: { kind: 'product' as const, identityConfidence: 0.9, ambiguous: false, candidates: [] },
    decision: 'BUY' as const,
    confidence: 0.8,
    relay: { requested: false, available: false, used: false, mode: 'public_only' as const },
    summary: 'done', reasons: [], strengths: [], weaknesses: [], missingInformation: [], evidence: [],
    sourceCoverage: { attempted: 1, succeeded: 1, failed: 0, evidenceCount: 1 }, errors: [],
  };
  await finishAgentResearchJob(store, 'agent-1', result, 3_000);

  assert.equal((await getAgentResearchJobState(store, 'agent-1'))?.status, 'completed');
  assert.equal((await getAgentResearchResult(store, 'agent-1'))?.summary, 'done');
  assert.equal([...store.data.keys()].some((key) => key.includes('input:agent-1')), false);
});

test('failed agent job deletes request-scoped input and records only bounded error state', async () => {
  const store = new MemoryStore();
  await createQueuedAgentResearch(store, { query: '상품 조사', purchaseContext: { memberships: ['네이버플러스'] } }, { id: 'agent-2', nowMs: 1_000 });
  await claimQueuedAgentResearch(store, 'agent-2', 2_000);
  await failAgentResearchJob(store, 'agent-2', 'provider failed '.repeat(100), 3_000);

  const state = await getAgentResearchJobState(store, 'agent-2');
  assert.equal(state?.status, 'failed');
  assert.ok((state?.error?.length ?? 0) <= 500);
  assert.equal([...store.data.keys()].some((key) => key.includes('input:agent-2')), false);
});

test('job state never stores authorization headers or relay secrets', async () => {
  const store = new MemoryStore();
  await createQueuedAgentResearch(store, { query: '상품 조사' }, { id: 'agent-3', nowMs: 1_000 });
  const serialized = JSON.stringify([...store.data.entries()]);
  assert.equal(/authorization|bearer|KWA_RELAY_SECRET|relaySecret/i.test(serialized), false);
});
