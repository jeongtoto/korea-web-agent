import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPersonalizedRelayResult } from '../src/relay/merge.ts';
import type { ResearchJob } from '../src/core/types.ts';

function baseJob(): ResearchJob {
  return {
    id: 'job-1',
    status: 'running',
    request: { question: '어때?', url: 'https://brand.naver.com/mildo/products/7322162980', includeLocalRelay: true, category: 'product' },
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:01.000Z',
    target: { kind: 'product', brand: 'mildo', productId: '7322162980', canonicalUrl: 'https://brand.naver.com/mildo/products/7322162980' },
    sourceResults: [],
    evidence: [
      {
        claim: '공개 판매 페이지', sourceUrl: 'https://example.com/product', sourceType: 'retailer', retrievedAt: '2026-08-17T00:00:01.000Z',
        acquisitionMethod: 'search_metadata', evidenceClass: 'retailer_listing', independenceKey: 'public-1', confidence: 0.6, specificity: 'exact_product',
      },
      {
        claim: '장기 사용 후기', sourceUrl: 'https://example.com/review', sourceType: 'review', retrievedAt: '2026-08-17T00:00:01.000Z',
        acquisitionMethod: 'search_metadata', evidenceClass: 'community_report', independenceKey: 'public-2', confidence: 0.6, specificity: 'exact_product',
      },
    ],
    relay: { available: true, used: false, mode: 'public_only', message: 'waiting' },
    errors: [],
  };
}

test('applyPersonalizedRelayResult merges only normalized price and delivery fields and rebuilds report', () => {
  const merged = applyPersonalizedRelayResult(baseJob(), {
    membershipPrice: 419000,
    couponPrice: 429000,
    estimatedPoints: 12000,
    shippingEta: '2026-08-20',
  }, '2026-08-17T00:00:10.000Z');

  assert.equal(merged.status, 'completed');
  assert.equal(merged.relay.used, true);
  assert.equal(merged.relay.mode, 'local_authenticated');
  assert.equal(merged.report?.personalizedPrice?.membershipPrice, 419000);
  assert.equal(merged.report?.personalizedPrice?.estimatedPoints, 12000);
  assert.equal(merged.report?.personalizedPrice?.shippingEta, '2026-08-20');
  assert.ok(merged.evidence.some((item) => item.acquisitionMethod === 'local_relay'));
});

test('applyPersonalizedRelayResult rejects secret-bearing connector payloads', () => {
  assert.throws(() => applyPersonalizedRelayResult(baseJob(), {
    membershipPrice: 419000,
    cookie: 'must-never-survive',
  }, '2026-08-17T00:00:10.000Z'), /secret-bearing/i);
});

test('applyPersonalizedRelayResult preserves partial status when public-source errors already exist', () => {
  const job = baseJob();
  job.errors.push('naver-cafe: blocked');
  const merged = applyPersonalizedRelayResult(job, { price: 439000 }, '2026-08-17T00:00:10.000Z');
  assert.equal(merged.status, 'partial');
});
