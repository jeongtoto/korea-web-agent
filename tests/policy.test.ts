import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isRelayDomainAllowed } from '../src/core/policy.ts';

test('assertPublicUrl accepts a normal public HTTPS URL', () => {
  const url = assertPublicUrl('https://brand.naver.com/mildo/products/7322162980');
  assert.equal(url.hostname, 'brand.naver.com');
});

test('assertPublicUrl rejects local, private-network, credentialed, and non-web URLs', () => {
  for (const candidate of [
    'http://localhost:3000/x',
    'http://127.0.0.1/admin',
    'http://10.1.2.3/secret',
    'http://172.20.0.1/secret',
    'http://192.168.0.2/secret',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://user:pass@example.com/',
  ]) {
    assert.throws(() => assertPublicUrl(candidate), /not allowed|public URL|credentials/i, candidate);
  }
});

test('relay authenticated domains are explicit allowlist matches or their subdomains', () => {
  assert.equal(isRelayDomainAllowed('brand.naver.com'), true);
  assert.equal(isRelayDomainAllowed('m.smartstore.naver.com'), true);
  assert.equal(isRelayDomainAllowed('www.coupang.com'), true);
  assert.equal(isRelayDomainAllowed('evilnaver.com'), false);
  assert.equal(isRelayDomainAllowed('example.com'), false);
});
