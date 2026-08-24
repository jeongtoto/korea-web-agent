import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVersionTokens, normalizeModelCode, normalizeVariant, sameNormalizedSku, skuFingerprint } from '../src/core/sku-normalization.ts';

test('normalizes harmless model-code punctuation spacing and case', () => {
  assert.equal(normalizeModelCode(' qwge-43 ut1 '), normalizeModelCode('QWGE43UT1'));
  assert.equal(normalizeVariant('43 inch (v 3)'), '43인치 V3');
  assert.deepEqual(extractVersionTokens('삼탠바이미 (v 3) 43형'), ['V3']);
});

test('keeps materially different generations distinct', () => {
  assert.notEqual(normalizeVariant('43인치 V2'), normalizeVariant('43인치 V3'));
  assert.equal(sameNormalizedSku(
    { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', variant: '43형 V2' },
    { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', variant: '43인치 V3' },
  ), false);
});

test('builds a stable fingerprint for bundle codes regardless of separators', () => {
  const a = skuFingerprint({ kind: 'product', brand: '와이드뷰', name: 'QWGE43UT1 + EKWBYME78W(V3)', variant: '43형' });
  const b = skuFingerprint({ kind: 'product', brand: '와이드뷰', name: 'ekwbyme78w v 3 / qwge43ut1', variant: '43 inch' });
  assert.equal(a, b);
});
