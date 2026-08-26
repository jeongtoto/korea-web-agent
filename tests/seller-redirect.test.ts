import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSellerRedirect } from '../src/providers/seller-redirect.ts';

function scriptedFetch(steps: Array<{ status: number; location?: string }>): typeof fetch {
  let index = 0;
  return (async () => {
    const step = steps[index++];
    if (!step) throw new Error('unexpected fetch');
    const headers = new Headers();
    if (step.location) headers.set('location', step.location);
    return new Response('', { status: step.status, headers });
  }) as typeof fetch;
}

test('resolves a comparison bridge to the final public seller URL', async () => {
  const result = await resolveSellerRedirect(
    'https://prod.danawa.com/bridge?id=1',
    scriptedFetch([
      { status: 302, location: 'https://redirect.example/out/1' },
      { status: 301, location: 'https://www.11st.co.kr/products/1?option=V3' },
      { status: 200 },
    ]),
  );

  assert.equal(result.status, 'resolved');
  assert.equal(result.resolvedUrl, 'https://www.11st.co.kr/products/1?option=V3');
  assert.deepEqual(result.hops, [
    'https://prod.danawa.com/bridge?id=1',
    'https://redirect.example/out/1',
    'https://www.11st.co.kr/products/1?option=V3',
  ]);
});

test('returns not_redirect when the public bridge endpoint serves a terminal page without redirecting', async () => {
  const input = 'https://prod.danawa.com/bridge?id=2';
  const result = await resolveSellerRedirect(input, scriptedFetch([{ status: 200 }]));
  assert.equal(result.status, 'not_redirect');
  assert.equal(result.resolvedUrl, undefined);
  assert.deepEqual(result.hops, [input]);
});

test('fails closed on redirect loops', async () => {
  const result = await resolveSellerRedirect(
    'https://prod.danawa.com/bridge?id=3',
    scriptedFetch([
      { status: 302, location: 'https://redirect.example/one' },
      { status: 302, location: 'https://prod.danawa.com/bridge?id=3' },
    ]),
  );
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /loop/i);
});

test('fails closed before requesting a private redirect destination', async () => {
  let requests = 0;
  const fetchImpl = (async () => {
    requests += 1;
    return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  }) as typeof fetch;

  const result = await resolveSellerRedirect('https://prod.danawa.com/bridge?id=4', fetchImpl);
  assert.equal(result.status, 'failed');
  assert.equal(requests, 1);
  assert.match(result.error ?? '', /public|private|blocked|url/i);
});

test('fails after at most five redirect hops', async () => {
  const steps = Array.from({ length: 6 }, (_, index) => ({
    status: 302,
    location: `https://redirect.example/hop-${index + 1}`,
  }));
  const result = await resolveSellerRedirect(
    'https://prod.danawa.com/bridge?id=5',
    scriptedFetch(steps),
    5,
  );
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /redirect/i);
});
