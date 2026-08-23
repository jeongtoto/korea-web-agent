import test from 'node:test';
import assert from 'node:assert/strict';
import { runConnectorIteration } from '../src/relay/connector.ts';
import { signRelayJob, type SignedRelayJob, type UnsignedRelayJob } from '../src/relay/protocol.ts';
import type { BrowserDriver } from '../src/relay/playwright-adapter.ts';

const secret = 'connector-secret-at-least-32-bytes-12345';

class FakeDriver implements BrowserDriver {
  navigations: string[] = [];
  async navigate(url: string) { this.navigations.push(url); }
  async readText(selectors: readonly string[]) {
    const joined = selectors.join(' ');
    if (joined.includes('membership')) return '419,000원';
    if (joined.includes('shipping')) return '내일 도착 예정';
    if (joined.includes('h1')) return '밀도 침대';
    return null;
  }
  async close() {}
}

async function relayJob(): Promise<SignedRelayJob> {
  const now = Date.now();
  const unsigned: UnsignedRelayJob = {
    id: 'cloud-job-1',
    url: 'https://brand.naver.com/mildo/products/7322162980',
    requestedFields: ['title', 'membershipPrice', 'shippingEta'],
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    nonce: 'connector-nonce-123',
  };
  return { ...unsigned, signature: await signRelayJob(unsigned, secret) };
}

test('connector verifies a cloud job locally, performs read-only extraction, and posts only normalized result', async () => {
  const job = await relayJob();
  const driver = new FakeDriver();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const requestUrl = String(input);
    calls.push({ url: requestUrl, init });
    if (requestUrl.endsWith('/api/relay/poll')) {
      return new Response(JSON.stringify(job), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (requestUrl.endsWith('/api/relay/result')) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected URL: ${requestUrl}`);
  };

  const status = await runConnectorIteration({
    cloudUrl: 'https://agent.example',
    secret,
    fetchImpl: fakeFetch,
    driverFactory: async () => driver,
  });
  assert.equal(status, 'processed');
  assert.deepEqual(driver.navigations, [job.url]);
  const resultCall = calls.find((call) => call.url.endsWith('/api/relay/result'));
  assert.ok(resultCall?.init?.body);
  const body = JSON.parse(String(resultCall.init.body));
  assert.deepEqual(body, {
    jobId: 'cloud-job-1',
    result: { title: '밀도 침대', membershipPrice: 419000, shippingEta: '내일 도착 예정' },
  });
  assert.doesNotMatch(JSON.stringify(body), /cookie|token|password|session/i);
});

test('connector returns idle on 204 poll without opening a browser', async () => {
  let driverCreated = false;
  const status = await runConnectorIteration({
    cloudUrl: 'https://agent.example',
    secret,
    fetchImpl: async () => new Response(null, { status: 204 }),
    driverFactory: async () => { driverCreated = true; return new FakeDriver(); },
  });
  assert.equal(status, 'idle');
  assert.equal(driverCreated, false);
});

test('connector processes a signed multi-market batch sequentially in one read-only browser', async () => {
  const now = Date.now();
  const unsigned: UnsignedRelayJob = {
    id: 'batch-1',
    url: 'https://kream.co.kr/products/1',
    targets: [
      { url: 'https://kream.co.kr/products/1', market: 'KREAM' },
      { url: 'https://www.coupang.com/vp/products/2', market: '쿠팡' },
    ],
    requestedFields: ['title', 'price'],
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    nonce: 'batch-nonce-123',
  };
  const signed = { ...unsigned, signature: await signRelayJob(unsigned, secret) };
  const driver = new FakeDriver();
  const uploads: unknown[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/relay/poll')) return new Response(JSON.stringify(signed), { status: 200 });
    if (url.endsWith('/api/relay/result')) { uploads.push(JSON.parse(String(init?.body))); return new Response(null, { status: 204 }); }
    throw new Error('unexpected');
  };

  await runConnectorIteration({ cloudUrl: 'https://agent.example', secret, fetchImpl: fakeFetch, driverFactory: async () => driver });
  assert.deepEqual(driver.navigations, unsigned.targets?.map((target) => target.url));
  assert.deepEqual((uploads[0] as any).result.offers.map((offer: any) => offer.market), ['KREAM', '쿠팡']);
});
