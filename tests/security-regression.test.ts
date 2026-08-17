import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl } from '../src/core/policy.ts';
import { fetchDirectPage } from '../src/providers/direct-page.ts';
import { sanitizeRelayResult } from '../src/relay/protocol.ts';

test('SSRF guard rejects alternate representations of loopback/private hosts', () => {
  for (const url of [
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://[::ffff:127.0.0.1]/',
  ]) {
    assert.throws(() => assertPublicUrl(url), /private|local|not allowed/i, url);
  }
});

test('direct page acquisition blocks redirects into private networks', async () => {
  const fakeFetch: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, 'manual');
    const url = String(input);
    if (url.startsWith('https://example.com')) {
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    }
    throw new Error(`private redirect should never be fetched: ${url}`);
  };
  await assert.rejects(fetchDirectPage('https://example.com/start', fakeFetch), /private|local|not allowed/i);
});

test('direct page acquisition allows bounded redirects to another public URL', async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    calls += 1;
    assert.equal(init?.redirect, 'manual');
    const url = String(input);
    if (url.startsWith('https://example.com')) {
      return new Response(null, { status: 302, headers: { location: 'https://example.org/product' } });
    }
    return new Response('<html><head><title>Public target</title></head></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const page = await fetchDirectPage('https://example.com/start', fakeFetch);
  assert.equal(calls, 2);
  assert.equal(page.title, 'Public target');
  assert.equal(page.url, 'https://example.org/product');
});

test('relay output rejects common secret-key variants before cloud serialization', () => {
  for (const payload of [
    { accessToken: 'x' },
    { cookieJar: { sid: 'x' } },
    { nested: { sessionId: 'x' } },
    { auth: { passwordHash: 'x' } },
  ]) {
    assert.throws(() => sanitizeRelayResult(payload), /secret|token|cookie|session|password/i);
  }
});
