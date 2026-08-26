import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collapseReviewIndependence,
  reviewClaimFingerprint,
  scoreReviewTrust,
} from '../src/shopping/review-trust.ts';
import type { ReviewEvidence } from '../src/shopping/review-intelligence.ts';

function evidence(overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  return {
    candidateKey: 'tv-a',
    topic: 'durability',
    polarity: 'positive',
    sourceClass: 'community_report',
    acquisitionMethod: 'search_metadata',
    identityRelevance: 0.8,
    verifiedPurchaseConfidence: 0,
    retrievedAt: '2026-08-27T00:00:00.000Z',
    sourceUrl: 'https://community.example/post/1',
    independenceKey: 'community.example/post/1',
    confidence: 0.8,
    claim: 'MODEL1000 장기 사용 내구성이 좋고 문제 없다',
    ...overrides,
  };
}

const NOW = new Date('2026-08-27T00:00:00.000Z');

test('search metadata can never receive verified-purchase trust from its hostname or source class', () => {
  const item = evidence({
    sourceClass: 'verified_purchase_review',
    acquisitionMethod: 'search_metadata',
    sourceUrl: 'https://www.coupang.com/vp/products/123',
    verifiedPurchaseConfidence: 1,
  });

  const trust = scoreReviewTrust(item, NOW);

  assert.ok(trust.sourceTrust <= 0.55);
  assert.equal(trust.verifiedPurchaseConfidence, 0);
});

test('review recency uses bounded decay and malformed or future dates fall back safely', () => {
  const recent = scoreReviewTrust(evidence({ publishedAt: '2026-06-01' }), NOW);
  const oneYear = scoreReviewTrust(evidence({ publishedAt: '2025-10-01' }), NOW);
  const old = scoreReviewTrust(evidence({ publishedAt: '2024-01-01' }), NOW);
  const malformed = scoreReviewTrust(evidence({ publishedAt: 'not-a-date' }), NOW);
  const future = scoreReviewTrust(evidence({ publishedAt: '2027-01-01' }), NOW);

  assert.equal(recent.recencyFactor, 1);
  assert.equal(oneYear.recencyFactor, 0.9);
  assert.equal(old.recencyFactor, 0.6);
  assert.equal(malformed.recencyFactor, 0.7);
  assert.equal(future.recencyFactor, 0.7);
});

test('same-host copied claims collapse even when paths and standalone numbers differ', () => {
  const first = evidence({ sourceUrl: 'https://blog.example/a', claim: 'MODEL1000 고장 문제 3번 발생' });
  const copy = evidence({ sourceUrl: 'https://blog.example/b', claim: 'MODEL1000 고장 문제 5번 발생' });

  assert.equal(reviewClaimFingerprint(first.claim), reviewClaimFingerprint(copy.claim));
  const collapsed = collapseReviewIndependence([first, copy]);
  assert.equal(collapsed.length, 1);
});

test('syndicated copies across hosts receive diminishing independence weight', () => {
  const claim = 'MODEL1000 장기 사용 후 고장 문제가 반복됨';
  const items = [
    evidence({ sourceUrl: 'https://a.example/p1', claim }),
    evidence({ sourceUrl: 'https://b.example/p2', claim }),
    evidence({ sourceUrl: 'https://c.example/p3', claim }),
  ];

  const collapsed = collapseReviewIndependence(items);
  assert.deepEqual(collapsed.map((item) => item.independenceConfidence), [1, 0.35, 0.15]);
});

test('sponsored content is materially discounted and cannot look like independent user evidence', () => {
  const organic = scoreReviewTrust(evidence({ acquisitionMethod: 'static_html' }), NOW);
  const sponsored = scoreReviewTrust(evidence({
    acquisitionMethod: 'static_html',
    sourceClass: 'sponsored_content',
    sponsored: true,
  }), NOW);

  assert.ok(sponsored.sourceTrust <= 0.4);
  assert.ok(sponsored.sponsorshipFactor < 1);
  assert.ok(sponsored.effectiveWeight < organic.effectiveWeight);
});
