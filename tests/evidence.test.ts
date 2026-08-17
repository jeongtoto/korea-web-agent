import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateConfidence,
  dedupeEvidence,
  normalizeEvidence,
  scoreEvidence,
} from '../src/core/evidence.ts';
import type { EvidenceItem, EvidenceClass } from '../src/core/types.ts';

function item(evidenceClass: EvidenceClass, overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    claim: 'same claim',
    sourceUrl: 'https://example.com/a',
    sourceType: 'test',
    retrievedAt: '2026-08-17T00:00:00.000Z',
    acquisitionMethod: 'static_html',
    evidenceClass,
    independenceKey: `key-${evidenceClass}`,
    confidence: 0.8,
    specificity: 'exact_product',
    ...overrides,
  };
}

test('official and accredited evidence score above manufacturer and sponsored claims', () => {
  const official = scoreEvidence(item('official_record'));
  const accredited = scoreEvidence(item('accredited_test'));
  const manufacturer = scoreEvidence(item('manufacturer_spec'));
  const sponsored = scoreEvidence(item('sponsored_content', { sponsored: true }));

  assert.ok(official > manufacturer);
  assert.ok(accredited > manufacturer);
  assert.ok(manufacturer > sponsored);
});

test('scoreEvidence clamps malformed confidence values into 0..1', () => {
  const high = scoreEvidence(item('official_record', { confidence: 4 }));
  const low = scoreEvidence(item('sponsored_content', { confidence: -3, sponsored: true }));
  assert.ok(high >= 0 && high <= 1);
  assert.ok(low >= 0 && low <= 1);
  assert.equal(low, 0);
});

test('dedupeEvidence counts a syndicated independence key only once and keeps stronger evidence', () => {
  const weak = item('community_report', {
    sourceUrl: 'https://blog.example/1',
    independenceKey: 'syndicated-post-42',
    confidence: 0.4,
  });
  const strong = item('verified_purchase_review', {
    sourceUrl: 'https://shop.example/review/9',
    independenceKey: 'syndicated-post-42',
    confidence: 0.9,
  });

  const result = dedupeEvidence([weak, strong]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.sourceUrl, strong.sourceUrl);
});

test('general mechanism evidence is weaker than exact-product evidence with otherwise equal inputs', () => {
  const exact = scoreEvidence(item('peer_reviewed_research', { specificity: 'exact_product' }));
  const general = scoreEvidence(item('peer_reviewed_research', { specificity: 'general_mechanism' }));
  assert.ok(exact > general);
});

test('normalizeEvidence deduplicates and replaces raw confidence with evidence-aware score', () => {
  const raw = [
    item('manufacturer_spec', { independenceKey: 'a', confidence: 0.9 }),
    item('manufacturer_spec', { independenceKey: 'a', confidence: 0.2, sourceUrl: 'https://mirror.example' }),
    item('official_record', { independenceKey: 'b', confidence: 0.8 }),
  ];
  const normalized = normalizeEvidence(raw);
  assert.equal(normalized.length, 2);
  assert.ok(normalized.every((e) => e.confidence >= 0 && e.confidence <= 1));
});

test('aggregateConfidence increases with independent evidence and returns zero for no evidence', () => {
  assert.equal(aggregateConfidence([]), 0);
  const one = aggregateConfidence([item('community_report', { independenceKey: 'a' })]);
  const two = aggregateConfidence([
    item('community_report', { independenceKey: 'a' }),
    item('verified_purchase_review', { independenceKey: 'b' }),
  ]);
  assert.ok(two > one);
  assert.ok(two <= 1);
});
