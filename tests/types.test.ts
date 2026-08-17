import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_CLASSES, REPORT_DECISIONS } from '../src/core/types.ts';

test('evidence classes include the required provenance categories', () => {
  assert.deepEqual(EVIDENCE_CLASSES, [
    'official_record',
    'accredited_test',
    'peer_reviewed_research',
    'manufacturer_spec',
    'retailer_listing',
    'verified_purchase_review',
    'community_report',
    'editorial_review',
    'sponsored_content',
    'inferred_analysis',
  ]);
});

test('product report decisions are constrained to BUY WAIT SKIP or INSUFFICIENT', () => {
  assert.deepEqual(REPORT_DECISIONS, ['BUY', 'WAIT', 'SKIP', 'INSUFFICIENT']);
});
