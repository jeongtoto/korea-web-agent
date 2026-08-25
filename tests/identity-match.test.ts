import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { candidateIdentityFromText, compareCanonicalIdentity } from '../src/core/identity-match.ts';

const referenceBundle = compileCanonicalIdentity(
  { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1' },
  '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
);

test('body-only candidate is uncertain for a required V3 bundle, never exact', () => {
  const bodyOnly = candidateIdentityFromText('와이드뷰 QWGE43UT1 43인치 신품 TV 본체만');
  const result = compareCanonicalIdentity(referenceBundle, bodyOnly);
  assert.equal(result.verdict, 'uncertain');
  assert.ok(result.missing.some((item) => item.includes('EKWBYME78W')));
});

test('V2 conflicts with required V3', () => {
  const v2Bundle = candidateIdentityFromText('QWGE43UT1 + EKWBYME78W(V2) 43인치 신품 패키지');
  const result = compareCanonicalIdentity(referenceBundle, v2Bundle);
  assert.equal(result.verdict, 'different');
  assert.ok(result.conflicts.some((item) => item.includes('V3') && item.includes('V2')));
});

test('same SKU refurb is same_except_condition', () => {
  const refurbBundle = candidateIdentityFromText(
    'QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지',
    'refurbished',
  );
  const result = compareCanonicalIdentity(referenceBundle, refurbBundle);
  assert.equal(result.verdict, 'same_except_condition');
  assert.equal(result.missing.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test('different model used product is not an alternative condition', () => {
  const differentUsed = candidateIdentityFromText(
    'QWGE50UT1 + EKWBYME78W(V3) 50인치 이동형 패키지',
    'used',
  );
  const result = compareCanonicalIdentity(referenceBundle, differentUsed);
  assert.equal(result.verdict, 'different');
  assert.ok(result.conflicts.some((item) => item.includes('QWGE43UT1') && item.includes('QWGE50UT1')));
});

test('exact seller wording with the required component can be exact without repeating the brand', () => {
  const exact = candidateIdentityFromText('QWGE43UT1 EKWBYME78W V3 43인치 이동형 세트 신품');
  const result = compareCanonicalIdentity(referenceBundle, exact);
  assert.equal(result.verdict, 'exact');
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.missing.length, 0);
});

test('an under-specified reference cannot mark unrelated retailer text exact', () => {
  const weakReference = compileCanonicalIdentity(
    { kind: 'product', brand: '밀도', name: '밀도 원목 수납침대 K' },
    '이 침대 어때?',
  );
  const unrelated = candidateIdentityFromText('KCL 안전인증 KC 생활용품 시험검사 안내');
  const result = compareCanonicalIdentity(weakReference, unrelated);

  assert.notEqual(result.verdict, 'exact');
  assert.ok(result.confidence < 1);
});