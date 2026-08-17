import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductReport } from '../src/report/product-report.ts';
import type { EvidenceItem, NormalizedTarget } from '../src/core/types.ts';

const target: NormalizedTarget = {
  kind: 'product',
  brand: '밀도',
  name: '원목 수납침대 K',
  productId: '7322162980',
  canonicalUrl: 'https://brand.naver.com/mildo/products/7322162980',
  sourceHost: 'brand.naver.com',
};

function evidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    claim: '프레임이 안정적이라는 장기 사용 후기',
    sourceUrl: 'https://example.com/review/1',
    sourceType: 'review',
    retrievedAt: '2026-08-17T00:00:00.000Z',
    acquisitionMethod: 'static_html',
    evidenceClass: 'verified_purchase_review',
    independenceKey: 'review-1',
    confidence: 0.8,
    specificity: 'exact_product',
    data: { sentiment: 0.8 },
    ...overrides,
  };
}

test('returns INSUFFICIENT when independent evidence is too sparse', () => {
  const report = buildProductReport({ target, evidence: [evidence()] });
  assert.equal(report.decision, 'INSUFFICIENT');
  assert.ok(report.missingInformation.length > 0);
});

test('returns BUY for multiple strong independent exact-product positives', () => {
  const report = buildProductReport({
    target,
    evidence: [
      evidence({ independenceKey: 'a', sourceUrl: 'https://shop.example/review/1', confidence: 0.9, data: { sentiment: 0.9 } }),
      evidence({ independenceKey: 'b', sourceUrl: 'https://community.example/post/2', evidenceClass: 'community_report', confidence: 0.75, data: { sentiment: 0.7 } }),
      evidence({ independenceKey: 'c', sourceUrl: 'https://cert.example/test', evidenceClass: 'accredited_test', confidence: 0.9, data: { sentiment: 0.5 } }),
    ],
  });
  assert.equal(report.decision, 'BUY');
  assert.ok(report.confidence >= 0.5);
  assert.equal(report.sourceCount, 3);
  assert.ok(report.strengths.length >= 1);
});

test('returns SKIP for multiple strong negative exact-product reports', () => {
  const report = buildProductReport({
    target,
    evidence: [
      evidence({ independenceKey: 'a', claim: '장기 사용 후 프레임 흔들림', confidence: 0.9, data: { sentiment: -0.9 } }),
      evidence({ independenceKey: 'b', sourceUrl: 'https://community.example/2', claim: '반복적인 삐걱거림', evidenceClass: 'community_report', confidence: 0.85, data: { sentiment: -0.8 } }),
      evidence({ independenceKey: 'c', sourceUrl: 'https://review.example/3', claim: '서랍 레일 변형', confidence: 0.8, data: { sentiment: -0.7 } }),
    ],
  });
  assert.equal(report.decision, 'SKIP');
  assert.ok(report.weaknesses.length >= 2);
});

test('uses WAIT when product evidence is acceptable but price signal is poor', () => {
  const report = buildProductReport({
    target,
    evidence: [
      evidence({ independenceKey: 'a', data: { sentiment: 0.6, priceSignal: -0.8 } }),
      evidence({ independenceKey: 'b', sourceUrl: 'https://review.example/2', data: { sentiment: 0.6, priceSignal: -0.8 } }),
      evidence({ independenceKey: 'c', sourceUrl: 'https://retailer.example/3', evidenceClass: 'retailer_listing', data: { sentiment: 0.2, priceSignal: -0.9 } }),
    ],
  });
  assert.equal(report.decision, 'WAIT');
});

test('general scientific evidence is not presented as direct proof of the exact product', () => {
  const report = buildProductReport({
    target,
    evidence: [
      evidence({
        independenceKey: 'paper-1',
        sourceUrl: 'https://journal.example/paper-1',
        evidenceClass: 'peer_reviewed_research',
        specificity: 'general_mechanism',
        claim: '중간 경도의 매트리스가 일부 요통 지표에 유리할 수 있음',
        data: { sentiment: 0.4 },
      }),
      evidence({ independenceKey: 'paper-2', sourceUrl: 'https://journal.example/paper-2', evidenceClass: 'peer_reviewed_research', specificity: 'category', data: { sentiment: 0.3 } }),
    ],
  });
  assert.ok(report.missingInformation.some((item) => /exact|제품|직접/i.test(item)));
  assert.notEqual(report.decision, 'BUY');
});
