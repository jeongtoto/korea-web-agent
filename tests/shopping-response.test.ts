import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStandardPriceRows,
  decideClarification,
  normalizeEventWindow,
} from '../src/report/shopping-response.ts';

test('asks only when missing requirements materially affect category recommendation', () => {
  const result = decideClarification({
    question: '43인치 이동형 티비 추천해줘',
    recommendationMode: true,
    known: { size: '43인치', mobility: '이동형' },
  });
  assert.equal(result.action, 'proceed');
  assert.deepEqual(result.assumptions, ['예산 미지정: 가성비 중심으로 폭넓게 비교']);
});

test('requests clarification for a safety-critical or identity-critical ambiguity', () => {
  const result = decideClarification({
    question: '이 모델 최저가 찾아줘',
    recommendationMode: false,
    known: {},
  });
  assert.equal(result.action, 'ask');
  assert.match(result.question ?? '', /모델명|상품 URL/);
});

test('uses a stable cash, card, membership and effective price row order', () => {
  const rows = buildStandardPriceRows({
    cash: 499_000,
    card: 479_000,
    cardCondition: '토스페이 삼성카드',
    withoutMembershipEffective: 494_010,
    withMembershipEffective: 397_250,
    membershipName: '네이버플러스',
  });
  assert.deepEqual(rows.map((row) => row.key), [
    'cash',
    'card',
    'effective_without_membership',
    'effective_with_membership',
  ]);
});

test('normalizes explicit event dates and flags expired events', () => {
  const event = normalizeEventWindow({
    startsAt: '2026-08-23T00:00:00+09:00',
    endsAt: '2026-08-25T23:59:59+09:00',
    observedAt: '2026-08-24T18:00:00+09:00',
  });
  assert.equal(event.status, 'active');
  assert.equal(event.startsOn, '2026-08-23');
  assert.equal(event.endsOn, '2026-08-25');
});
