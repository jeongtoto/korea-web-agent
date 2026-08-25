import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity, canonicalIdentityKey } from '../src/core/canonical-identity.ts';

test('compiles QWGE43UT1 + EKWBYME78W(V3) as a required-component bundle', () => {
  const identity = compileCanonicalIdentity(
    { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', name: '와이드뷰 이동형 TV' },
    '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지 가격',
  );
  assert.equal(identity.primary.model, 'QWGE43UT1');
  assert.equal(identity.primary.size, '43');
  assert.equal(identity.condition, 'new');
  assert.deepEqual(identity.requiredComponents.map((item) => ({ model: item.model, version: item.version })), [
    { model: 'EKWBYME78W', version: 'V3' },
  ]);
  assert.equal(canonicalIdentityKey(identity), '와이드뷰:QWGE43UT1:43:EKWBYME78W@V3:NEW');
});

test('does not invent bundle components for body-only request', () => {
  const identity = compileCanonicalIdentity(
    { kind: 'product', model: 'QWGE43UT1' },
    'QWGE43UT1 본체만 가격',
  );
  assert.equal(identity.requiredComponents.length, 0);
});

test('explicit exclusion suppresses a stand component even when the request mentions a stand', () => {
  const identity = compileCanonicalIdentity(
    { kind: 'product', model: 'QWGE43UT1' },
    'QWGE43UT1 43인치 스탠드 별도 본체만 신품',
  );
  assert.equal(identity.primary.size, '43');
  assert.equal(identity.condition, 'new');
  assert.deepEqual(identity.requiredComponents, []);
});
