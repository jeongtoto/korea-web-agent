import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelayServer } from '../src/relay/server.ts';
import { signRelayJob, type SignedRelayJob, type UnsignedRelayJob } from '../src/relay/protocol.ts';
import type { BrowserDriver } from '../src/relay/playwright-adapter.ts';

const secret = 'relay-test-secret-32-bytes-minimum-1234';

class FakeDriver implements BrowserDriver {
  async navigate(): Promise<void> {}
  async readText(selectors: readonly string[]): Promise<string | null> {
    const key = selectors.join(' ');
    if (key.includes('price')) return '399,000원';
    if (key.includes('h1')) return '테스트 침대';
    return null;
  }
  async close(): Promise<void> {}
}

async function signedJob(): Promise<SignedRelayJob> {
  const now = Date.now();
  const unsigned: UnsignedRelayJob = {
    id: 'job-relay-api',
    url: 'https://brand.naver.com/mildo/products/7322162980',
    requestedFields: ['title', 'price'],
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    nonce: 'nonce-relay-12345',
  };
  return { ...unsigned, signature: await signRelayJob(unsigned, secret) };
}

async function withRelay(run: (base: string) => Promise<void>) {
  const server = createRelayServer({ secret, driverFactory: async () => new FakeDriver() });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test('relay server rejects unsigned jobs and serves signed read-only extraction', async () => {
  await withRelay(async (base) => {
    const unsigned = await signedJob();
    const bad = await fetch(`${base}/relay/extract`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...unsigned, signature: '0'.repeat(64) }),
    });
    assert.equal(bad.status, 401);

    const good = await fetch(`${base}/relay/extract`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(unsigned),
    });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { title: '테스트 침대', price: 399000 });
  });
});

test('relay health endpoint identifies a local read-only relay', async () => {
  await withRelay(async (base) => {
    const response = await fetch(`${base}/relay/health`);
    assert.equal(response.status, 200);
    const payload = await response.json() as { ok: boolean; readOnly: boolean };
    assert.equal(payload.ok, true);
    assert.equal(payload.readOnly, true);
  });
});
