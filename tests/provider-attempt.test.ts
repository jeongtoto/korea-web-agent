import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMarketCoverage, providerFailureKind } from '../src/core/provider-attempt.ts';
import type { ProviderAttempt } from '../src/core/types.ts';

function attempt(overrides: Partial<ProviderAttempt> = {}): ProviderAttempt {
  return {
    market: '네이버',
    attemptedAt: '2026-08-25T06:00:00.000Z',
    discovery: { attempted: true, hitCount: 0 },
    identity: { exact: 0, uncertain: 0, different: 0 },
    verification: { attempted: 0, succeeded: 0, failed: 0 },
    offers: { extracted: 0, eligible: 0 },
    status: 'no_match',
    ...overrides,
  };
}

test('zero discovery hits is a genuine no_match rather than a generic failure', () => {
  const coverage = deriveMarketCoverage([attempt()]);
  assert.deepEqual(coverage, [{
    market: '네이버',
    attempted: true,
    found: 0,
    verified: 0,
    status: 'no_match',
  }]);
});

test('discovered uncertain candidates without direct verification are found_unverified', () => {
  const coverage = deriveMarketCoverage([attempt({
    market: '쿠팡',
    discovery: { attempted: true, hitCount: 3 },
    identity: { exact: 0, uncertain: 1, different: 2 },
    status: 'found_unverified',
  })]);
  assert.equal(coverage[0]?.status, 'found_unverified');
  assert.equal(coverage[0]?.found, 1);
  assert.equal(coverage[0]?.verified, 0);
});

test('exact candidate whose direct page is blocked is failed with blocked_by_site', () => {
  const coverage = deriveMarketCoverage([attempt({
    market: '쿠팡',
    discovery: { attempted: true, hitCount: 1 },
    identity: { exact: 1, uncertain: 0, different: 0 },
    verification: { attempted: 1, succeeded: 0, failed: 1 },
    failureKind: 'blocked_by_site',
    failureMessage: '403 bot blocked',
    status: 'failed',
  })]);
  assert.equal(coverage[0]?.status, 'failed');
  assert.equal(coverage[0]?.message, 'blocked_by_site: 403 bot blocked');
});

test('page-verified eligible offer yields verified market coverage', () => {
  const coverage = deriveMarketCoverage([attempt({
    market: '다나와',
    discovery: { attempted: true, hitCount: 2 },
    identity: { exact: 1, uncertain: 1, different: 0 },
    verification: { attempted: 1, succeeded: 1, failed: 0 },
    offers: { extracted: 1, eligible: 1 },
    status: 'verified',
  })]);
  assert.equal(coverage[0]?.status, 'verified');
  assert.equal(coverage[0]?.found, 2);
  assert.equal(coverage[0]?.verified, 1);
});

test('one blocked URL does not overwrite a verified eligible offer from the same market', () => {
  const coverage = deriveMarketCoverage([attempt({
    market: '네이버',
    discovery: { attempted: true, hitCount: 3 },
    identity: { exact: 2, uncertain: 0, different: 1 },
    verification: { attempted: 2, succeeded: 1, failed: 1 },
    offers: { extracted: 1, eligible: 1 },
    failureKind: 'blocked_by_site',
    failureMessage: 'one seller blocked',
    status: 'verified',
  })]);
  assert.equal(coverage[0]?.status, 'verified');
  assert.equal(coverage[0]?.verified, 1);
});

test('semantic provider failure mapping distinguishes login, block, transient, parse and relay cases', () => {
  assert.equal(providerFailureKind(new Error('401 Unauthorized login required')), 'login_required');
  assert.equal(providerFailureKind(new Error('403 bot blocked by site policy')), 'blocked_by_site');
  assert.equal(providerFailureKind(new Error('429 Too Many Requests')), 'rate_limited');
  assert.equal(providerFailureKind(new Error('ETIMEDOUT while fetching')), 'network_transient');
  assert.equal(providerFailureKind(new Error('Unexpected token while parsing product JSON')), 'parse_failed');
  assert.equal(providerFailureKind(new Error('PC relay offline')), 'relay_offline');
  assert.equal(providerFailureKind(new Error('region selection required')), 'region_required');
  assert.equal(providerFailureKind(new Error('store stock check required')), 'stock_check_required');
  assert.equal(providerFailureKind(new Error('404 not found')), 'not_found');
  assert.equal(providerFailureKind(new Error('captcha challenge')), 'captcha');
  assert.equal(providerFailureKind(new Error('provider returned an unfamiliar failure')), 'unknown');
});
