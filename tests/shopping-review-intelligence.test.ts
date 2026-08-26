import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateReviewConsensus,
  analyzeReviewClaim,
  deduplicateReviewEvidence,
  type ReviewEvidence,
} from '../src/shopping/review-intelligence.ts';

function review(overrides: Partial<ReviewEvidence> = {}): ReviewEvidence {
  return {
    candidateKey: 'tv-1',
    topic: 'stand_stability',
    polarity: 'negative',
    sourceClass: 'community_report',
    retrievedAt: '2026-08-26T00:00:00.000Z',
    sourceUrl: 'https://example.com/review-1',
    independenceKey: 'author:one:stand',
    confidence: 0.75,
    claim: '스탠드가 흔들린다는 단점이 있다',
    ...overrides,
  };
}

test('duplicate/reposted review claims sharing an independence key count only once', () => {
  const original = review();
  const repost = review({
    sourceUrl: 'https://mirror.example.com/repost',
    confidence: 0.55,
  });

  const deduped = deduplicateReviewEvidence([original, repost]);
  const consensus = aggregateReviewConsensus([original, repost]).find((item) => item.topic === 'stand_stability');

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.sourceUrl, original.sourceUrl);
  assert.equal(consensus?.independentSources, 1);
  assert.ok((consensus?.confidence ?? 1) < 0.6, 'one independent review must not create high consensus confidence');
});

test('sponsored-only independent reviews cannot create high consensus confidence', () => {
  const reviews = [0, 1, 2].map((index) => review({
    polarity: 'positive',
    sponsored: true,
    independenceKey: `sponsored:${index}`,
    sourceUrl: `https://sponsor.example/${index}`,
    confidence: 0.9,
  }));

  const consensus = aggregateReviewConsensus(reviews)[0];
  assert.ok(consensus);
  assert.equal(consensus.independentSources, 3);
  assert.ok(consensus.confidence < 0.65);
});

test('two independent repeated negative reports create a material negative topic signal', () => {
  const reviews = [
    review({ independenceKey: 'user:a', sourceUrl: 'https://a.example/review' }),
    review({ independenceKey: 'user:b', sourceUrl: 'https://b.example/review', confidence: 0.8 }),
  ];
  const consensus = aggregateReviewConsensus(reviews)[0];

  assert.ok(consensus);
  assert.equal(consensus.independentSources, 2);
  assert.ok(consensus.negativeWeight > 1);
  assert.ok(consensus.negativeWeight > consensus.positiveWeight);
  assert.ok(consensus.confidence >= 0.5);
});

test('star rating alone does not become qualitative product quality evidence', () => {
  const evidence = analyzeReviewClaim({
    candidateKey: 'tv-1',
    claim: '평점 4.9점 리뷰 1280개',
    sourceClass: 'verified_purchase_review',
    sourceUrl: 'https://shop.example/reviews',
    retrievedAt: '2026-08-26T00:00:00.000Z',
    independenceKey: 'shop:aggregate-rating',
  });

  assert.deepEqual(evidence, []);
});

test('review claim analysis extracts category-relevant qualitative topics', () => {
  const evidence = analyzeReviewClaim({
    candidateKey: 'tv-1',
    claim: '화질은 선명하고 만족스럽지만 스탠드가 흔들리고 스피커 소리가 약하다.',
    sourceClass: 'community_report',
    sourceUrl: 'https://community.example/1',
    retrievedAt: '2026-08-26T00:00:00.000Z',
    independenceKey: 'community:1',
  });

  assert.ok(evidence.some((item) => item.topic === 'display_quality' && item.polarity === 'positive'));
  assert.ok(evidence.some((item) => item.topic === 'stand_stability' && item.polarity === 'negative'));
  assert.ok(evidence.some((item) => item.topic === 'speaker_quality' && item.polarity === 'negative'));
});
