import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileProductConstraints,
  constraintEligibility,
  evaluateProductConstraints,
} from '../src/core/constraints.ts';

test('compiles explicit bed-frame fit, drawer and headboard requirements as hard constraints', () => {
  const constraints = compileProductConstraints(
    '매트리스 1670×2075가 실제로 완전히 올라가야 함. 서랍형 필수. 무헤드 또는 소파형 헤드만.',
  );

  assert.ok(constraints.some((item) => item.field === 'supportedWidthMm' && item.expected === 1670 && item.strength === 'hard'));
  assert.ok(constraints.some((item) => item.field === 'supportedLengthMm' && item.expected === 2075 && item.strength === 'hard'));
  assert.ok(constraints.some((item) => item.field === 'drawerStorage' && item.expected === true && item.strength === 'hard'));
  assert.ok(constraints.some((item) => item.field === 'headboardStyle'
    && Array.isArray(item.expected)
    && item.expected.includes('headless')
    && item.expected.includes('sofa')));
});

test('1700x2000 fails a required 1670x2075 mattress fit', () => {
  const constraints = compileProductConstraints('1670×2075 매트리스가 실제로 올라가야 함');
  const evaluations = evaluateProductConstraints(constraints, {
    supportedWidthMm: 1700,
    supportedLengthMm: 2000,
  });
  assert.equal(constraintEligibility(evaluations), 'excluded');
  assert.ok(evaluations.some((item) => item.constraint.field === 'supportedLengthMm' && item.status === 'verified_fail'));
});

test('unknown required dimensions stay preliminary rather than eligible', () => {
  const constraints = compileProductConstraints('1670×2075 매트리스가 실제로 올라가야 함. 서랍형 필수');
  const evaluations = evaluateProductConstraints(constraints, { drawerStorage: true });
  assert.equal(constraintEligibility(evaluations), 'preliminary');
});

test('fully verified 1700x2075 drawer sofa frame is eligible', () => {
  const constraints = compileProductConstraints(
    '1670×2075 매트리스가 실제로 올라가야 함. 서랍형 필수. 무헤드 또는 소파형 헤드만.',
  );
  const evaluations = evaluateProductConstraints(constraints, {
    supportedWidthMm: 1700,
    supportedLengthMm: 2075,
    drawerStorage: true,
    headboardStyle: 'sofa',
  });
  assert.equal(constraintEligibility(evaluations), 'eligible');
  assert.ok(evaluations.every((item) => item.status === 'verified_pass'));
});

test('does not silently promote ordinary preference wording to a hard requirement', () => {
  const constraints = compileProductConstraints('베이지면 좋겠고 리뷰 좋은 제품 추천');
  assert.equal(constraints.filter((item) => item.strength === 'hard').length, 0);
});
