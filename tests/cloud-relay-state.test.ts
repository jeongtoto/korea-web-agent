import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completePersistentRelay,
  failPersistentRelay,
  getPersistentRelayStatus,
  getStoredResearchJob,
  markPersistentConnectorSeen,
  pollPersistentRelay,
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
const URL = 'https://brand.naver.com/mildo/products/7322162980';

function job(id = 'research-1'): ResearchJob {
  return {
    id, status: 'running', request: { question: '어때?', url: URL, includeLocalRelay: true, category: 'product' },
    createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
    target: { kind: 'product', brand: 'mildo', productId: '7322162980', canonicalUrl: URL },
    sourceResults: [], evidence: [], relay: { available: true, used: false, mode: 'public_only' }, errors: [],
  };
}

test('persistent relay diagnostics distinguish never-seen, online, and stale heartbeat states', async () => {
  const store = new MemoryStore();
  assert.deepEqual(await getPersistentRelayStatus(store, 5_000, 1_000), {
    online: false,
    state: 'never_seen',
    lastSeenAt: null,
    heartbeatAgeMs: null,
    onlineTtlMs: 1_000,
  });

  await markPersistentConnectorSeen(store, 5_000);
  assert.deepEqual(await getPersistentRelayStatus(store, 5_400, 1_000), {
    online: true,
    state: 'online',
    lastSeenAt: 5_000,
    heartbeatAgeMs: 400,
    onlineTtlMs: 1_000,
  });

  assert.deepEqual(await getPersistentRelayStatus(store, 6_001, 1_000), {
    online: false,
    state: 'stale',
    lastSeenAt: 5_000,
    heartbeatAgeMs: 1_001,
    onlineTtlMs: 1_000,
  });
});

test('persistent relay diagnostics contain heartbeat metadata only and no secret material', async () => {
  const store = new MemoryStore();
  await markPersistentConnectorSeen(store, 10_000);
  const status = await getPersistentRelayStatus(store, 10_100, 500);
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /secret|signature|token|nonce|payload/i);
  assert.deepEqual(Object.keys(status).sort(), ['heartbeatAgeMs', 'lastSeenAt', 'online', 'onlineTtlMs', 'state'].sort());
});

test('persistent relay survives independent store callers and completes the stored research job', async () => {
  const store = new MemoryStore();
  await saveResearchJob(store, job());
  const targetHint = {
    brand: '와이드뷰',
    name: '와이드무빙뷰 삼탠바이미V3 43인치 UHD 4K',
    model: 'QWGE43UT1',
    variant: 'EKWBYME78W(V3) 43인치',
  };
  const signed = await queuePersistentRelay(store, 'research-1', URL, SECRET, 1_000, 30_000, targetHint);
  assert.deepEqual((signed as any).targetHint, targetHint);

  await markPersistentConnectorSeen(store, 1_100);
  const status = await getPersistentRelayStatus(store, 1_200, 500);
  assert.equal(status.online, true);
  assert.equal(status.state, 'online');

  const polled = await pollPersistentRelay(store, 1_300);
  assert.equal(polled?.id, signed.id);
  const duplicatePoll = await pollPersistentRelay(store, 1_400);
  assert.equal(duplicatePoll, null);

  const merged = await completePersistentRelay(store, signed.id, { membershipPrice: 419000, shippingEta: '2026-08-20' }, '2026-08-17T00:00:10.000Z');
  assert.equal(merged.report?.personalizedPrice?.membershipPrice, 419000);
  assert.equal(merged.status, 'completed');

  const stored = await getStoredResearchJob(store, 'research-1');
  assert.equal(stored?.relay.mode, 'local_authenticated');
  assert.equal(await pollPersistentRelay(store, 1_500), null);
});

test('persistent relay reports offline outside TTL and queues multiple research jobs without overwriting', async () => {
  const store = new MemoryStore();
  await markPersistentConnectorSeen(store, 1_000);
  const stale = await getPersistentRelayStatus(store, 2_000, 500);
  assert.equal(stale.online, false);
  assert.equal(stale.state, 'stale');

  await saveResearchJob(store, job('research-1'));
  await saveResearchJob(store, job('research-2'));
  const first = await queuePersistentRelay(store, 'research-1', URL, SECRET, 2_000, 30_000);
  const second = await queuePersistentRelay(store, 'research-2', URL, SECRET, 2_100, 30_000);

  assert.notEqual(first.id, second.id);
  assert.equal((await pollPersistentRelay(store, 2_200))?.id, first.id);
  await completePersistentRelay(store, first.id, { salePrice: 400000 }, '2026-08-17T00:00:03.000Z');
  assert.equal((await pollPersistentRelay(store, 2_300))?.id, second.id);
  await completePersistentRelay(store, second.id, { salePrice: 390000 }, '2026-08-17T00:00:04.000Z');

  assert.equal((await getStoredResearchJob(store, 'research-1'))?.report?.personalizedPrice?.salePrice, 400000);
  assert.equal((await getStoredResearchJob(store, 'research-2'))?.report?.personalizedPrice?.salePrice, 390000);
});

test('expired first relay job is discarded without blocking the next queued job', async () => {
  const store = new MemoryStore();
  await queuePersistentRelay(store, 'research-1', URL, SECRET, 1_000, 200);
  const second = await queuePersistentRelay(store, 'research-2', URL, SECRET, 1_100, 2_000);
  assert.equal((await pollPersistentRelay(store, 1_500))?.id, second.id);
});

test('persistent relay failure releases only the matching queue item and restores a public-result terminal state', async () => {
  const store = new MemoryStore();
  await saveResearchJob(store, job('research-1'));
  await saveResearchJob(store, job('research-2'));
  const first = await queuePersistentRelay(store, 'research-1', URL, SECRET, 1_000, 30_000);
  const second = await queuePersistentRelay(store, 'research-2', URL, SECRET, 1_100, 30_000);
  const failed = await failPersistentRelay(store, first.id, 'CAPTCHA required', '2026-08-17T00:00:10.000Z');
  assert.equal(failed.status, 'completed');
  assert.equal(failed.relay.used, false);
  assert.match(failed.relay.message ?? '', /CAPTCHA/i);
  assert.ok(failed.errors.some((error) => error.includes('local_relay')));
  assert.equal((await pollPersistentRelay(store, 1_500))?.id, second.id);
});
