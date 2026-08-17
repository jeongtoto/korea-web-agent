import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayBroker } from '../src/relay/broker.ts';
import { verifyRelayJob } from '../src/relay/protocol.ts';

const secret = 'broker-secret-at-least-32-bytes-long-1234';
const url = 'https://brand.naver.com/mildo/products/7322162980';

async function waitForJob(broker: RelayBroker) {
  for (let i = 0; i < 20; i += 1) {
    const job = await broker.poll();
    if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('job did not enter queue');
}

test('broker is offline until a PC connector polls, then reports online for the TTL', async () => {
  let now = 1_000_000;
  const broker = new RelayBroker({ secret, now: () => now, onlineTtlMs: 10_000 });
  assert.equal(await broker.isAvailable(), false);
  assert.equal(await broker.poll(), null);
  assert.equal(await broker.isAvailable(), true);
  now += 10_001;
  assert.equal(await broker.isAvailable(), false);
});

test('broker queues a signed read-only job and resolves normalized personalized price result', async () => {
  const broker = new RelayBroker({ secret, timeoutMs: 2_000 });
  const resultPromise = broker.extract(url);
  const job = await waitForJob(broker);
  assert.equal(job.url, url);
  assert.ok(job.requestedFields.includes('membershipPrice'));
  assert.equal(await verifyRelayJob(job, secret), true);

  broker.submitResult(job.id, {
    membershipPrice: 419000,
    estimatedPoints: 12000,
    shippingEta: '2026-08-20',
  });
  const result = await resultPromise;
  assert.deepEqual(result, {
    currency: 'KRW',
    membershipPrice: 419000,
    estimatedPoints: 12000,
    shippingEta: '2026-08-20',
  });
});

test('broker rejects secret-bearing connector output before resolving the research job', async () => {
  const broker = new RelayBroker({ secret, timeoutMs: 2_000 });
  const resultPromise = broker.extract(url);
  const job = await waitForJob(broker);
  assert.throws(() => broker.submitResult(job.id, { price: 399000, accessToken: 'secret' }), /secret|token/i);
  broker.submitResult(job.id, { price: 399000 });
  assert.equal((await resultPromise).salePrice, 399000);
});

test('broker times out pending extraction instead of hanging indefinitely', async () => {
  const broker = new RelayBroker({ secret, timeoutMs: 25 });
  const resultPromise = broker.extract(url);
  await waitForJob(broker);
  await assert.rejects(resultPromise, /timed out/i);
});

test('broker bearer authorization accepts only the configured relay secret', () => {
  const broker = new RelayBroker({ secret });
  assert.equal(broker.authorizeBearer(`Bearer ${secret}`), true);
  assert.equal(broker.authorizeBearer(`Bearer wrong-${secret}`), false);
  assert.equal(broker.authorizeBearer(undefined), false);
});
