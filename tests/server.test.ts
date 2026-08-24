import test from 'node:test';
import assert from 'node:assert/strict';
import { createKoreaWebAgentServer } from '../src/server.ts';
import type { ResearchJob, ResearchRequest } from '../src/core/types.ts';

function fakeJob(request: ResearchRequest): ResearchJob {
  const now = '2026-08-17T00:00:00.000Z';
  return {
    id: 'job-api-1',
    status: 'completed',
    request,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    target: { kind: 'product', name: '테스트 침대' },
    sourceResults: [],
    evidence: [],
    relay: { available: false, used: false, mode: 'public_only' },
    report: {
      decision: 'INSUFFICIENT',
      confidence: 0.2,
      title: '테스트 침대',
      summary: '근거가 부족합니다.',
      reasons: [],
      strengths: [],
      weaknesses: [],
      missingInformation: ['추가 리뷰 필요'],
      evidence: [],
      sourceCount: 0,
    },
    errors: [],
  };
}

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const server = createKoreaWebAgentServer({
    researchRunner: async (request) => fakeJob(request),
    publicDir: new URL('../public/', import.meta.url),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve()));
  }
}

test('GET /api/health returns service health', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: 'korea-web-agent', version: '0.6.0' });
  });
});

test('POST /api/research validates request and stores successful job for GET lookup', async () => {
  await withServer(async (base) => {
    const bad = await fetch(`${base}/api/research`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(bad.status, 400);

    const created = await fetch(`${base}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '이 침대 어때?', url: 'https://brand.naver.com/mildo/products/7322162980' }),
    });
    assert.equal(created.status, 201);
    const job = await created.json() as ResearchJob;
    assert.equal(job.id, 'job-api-1');
    assert.equal(job.request.question, '이 침대 어때?');

    const lookup = await fetch(`${base}/api/jobs/job-api-1`);
    assert.equal(lookup.status, 200);
    assert.equal((await lookup.json() as ResearchJob).id, 'job-api-1');
  });
});

test('GET / serves the mobile PWA shell', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.match(html, /Korea Web Agent/);
    assert.match(html, /manifest\.webmanifest/);
  });
});

import { RelayBroker } from '../src/relay/broker.ts';

const brokerSecret = 'server-broker-secret-at-least-32-bytes-123';

test('cloud relay endpoints are bearer-authenticated and expose signed pending jobs', async () => {
  const broker = new RelayBroker({ secret: brokerSecret, timeoutMs: 2_000 });
  const server = createKoreaWebAgentServer({
    researchRunner: async (request) => fakeJob(request),
    relayBroker: broker,
    publicDir: new URL('../public/', import.meta.url),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const unauthorized = await fetch(`${base}/api/relay/poll`, { method: 'POST' });
    assert.equal(unauthorized.status, 401);

    const pendingResult = broker.extract('https://brand.naver.com/mildo/products/7322162980');
    let poll: Response | null = null;
    for (let i = 0; i < 20; i += 1) {
      const candidate = await fetch(`${base}/api/relay/poll`, {
        method: 'POST', headers: { authorization: `Bearer ${brokerSecret}` },
      });
      if (candidate.status === 200) { poll = candidate; break; }
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.ok(poll);
    const signed = await poll.json() as { id: string; signature: string };
    assert.equal(typeof signed.signature, 'string');

    const result = await fetch(`${base}/api/relay/result`, {
      method: 'POST',
      headers: { authorization: `Bearer ${brokerSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: signed.id, result: { membershipPrice: 418000, shippingEta: '내일 도착' } }),
    });
    assert.equal(result.status, 204);
    assert.equal((await pendingResult).membershipPrice, 418000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('default research runner can merge an online outbound broker result', async () => {
  const broker = new RelayBroker({ secret: brokerSecret, timeoutMs: 2_000, onlineTtlMs: 10_000 });
  const server = createKoreaWebAgentServer({
    relayBroker: broker,
    researchDependencies: {
      directPage: async () => ({
        url: 'https://brand.naver.com/mildo/products/7322162980',
        title: '밀도 침대',
        product: { name: '밀도 침대', brand: '밀도', offers: { price: 439000, currency: 'KRW' } },
        evidence: [],
      }),
      publicSearch: async () => [],
      academicSearch: async () => [],
      now: () => new Date(),
      idFactory: () => 'job-with-broker',
    },
    publicDir: new URL('../public/', import.meta.url),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await fetch(`${base}/api/relay/poll`, { method: 'POST', headers: { authorization: `Bearer ${brokerSecret}` } });

    const researchPromise = fetch(`${base}/api/research`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: '내 가격까지 봐줘', url: 'https://brand.naver.com/mildo/products/7322162980', includeLocalRelay: true }),
    });

    let signed: any = null;
    for (let i = 0; i < 20 && !signed; i += 1) {
      const poll = await fetch(`${base}/api/relay/poll`, { method: 'POST', headers: { authorization: `Bearer ${brokerSecret}` } });
      if (poll.status === 200) signed = await poll.json();
      else await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(signed);
    await fetch(`${base}/api/relay/result`, {
      method: 'POST', headers: { authorization: `Bearer ${brokerSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: signed.id, result: { membershipPrice: 419000, shippingEta: '2026-08-20' } }),
    });

    const response = await researchPromise;
    assert.equal(response.status, 201);
    const job = await response.json() as ResearchJob;
    assert.equal(job.relay.mode, 'local_authenticated');
    assert.equal(job.report?.personalizedPrice?.membershipPrice, 419000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
