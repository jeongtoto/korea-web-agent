import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMembershipScenarios,
  classifyPricePosition,
  comparePriceSnapshots,
  normalizeSku,
  redactSensitiveLogValue,
  redactSensitiveText,
  retryPlanForFailure,
  sameSku,
} from '../src/core/shopping-intelligence.ts';

test('normalizes model spacing, punctuation, case and version notation', () => {
  assert.equal(normalizeSku(' QWGE-43 UT1 + EKWBYME78W (v 3) '), 'QWGE43UT1+EKWBYME78W(V3)');
  assert.equal(normalizeSku('abc v.2'), 'ABCV2');
});

test('rejects version-conflicting SKUs even when the base model matches', () => {
  assert.equal(sameSku('EKWBYME78W V3', 'EKWBYME78W(V3)'), true);
  assert.equal(sameSku('EKWBYME78W V2', 'EKWBYME78W V3'), false);
});

test('builds member and non-member effective price scenarios without a saved profile', () => {
  const scenarios = buildMembershipScenarios({
    cashPaymentPrice: 499_000,
    basePoints: 4_990,
    membershipPoints: 101_660,
    membershipName: '네이버플러스',
    membershipFee: 4_900,
  });
  assert.deepEqual(scenarios.withoutMembership, {
    paymentPrice: 499_000,
    expectedPoints: 4_990,
    membershipFee: 0,
    effectivePrice: 494_010,
  });
  assert.equal(scenarios.withMembership.expectedPoints, 106_650);
  assert.equal(scenarios.withMembership.effectivePrice, 397_250);
});

test('compares repeated observations and reports movement', () => {
  const result = comparePriceSnapshots([
    { observedAt: '2026-08-01T00:00:00Z', cashPrice: 420_000 },
    { observedAt: '2026-08-24T00:00:00Z', cashPrice: 399_000 },
  ]);
  assert.equal(result.direction, 'down');
  assert.equal(result.absoluteChange, -21_000);
  assert.equal(result.percentageChange, -5);
});

test('classifies a current price against six-month history', () => {
  const position = classifyPricePosition(390_000, [410_000, 400_000, 395_000, 420_000, 405_000]);
  assert.equal(position.label, 'six_month_low');
  assert.equal(position.minimum, 390_000);
  assert.equal(position.maximum, 420_000);
});

test('uses failure-specific retry strategies', () => {
  assert.deepEqual(retryPlanForFailure('rate_limited'), {
    retryable: true,
    maxAttempts: 3,
    backoff: 'exponential',
    requiresUserAction: false,
  });
  assert.equal(retryPlanForFailure('captcha').requiresUserAction, true);
  assert.equal(retryPlanForFailure('invalid_sku').retryable, false);
});

test('redacts cards, memberships, budgets, tokens and nested values from logs', () => {
  const value = redactSensitiveLogValue({
    ownedCards: ['삼성 iD SELECT ALL'],
    memberships: ['네이버플러스'],
    budget: 500_000,
    authorization: 'Bearer secret',
    nested: { cardName: '신한 ANNIVERSE', safe: 'ok' },
  });
  assert.deepEqual(value, {
    ownedCards: '[REDACTED]',
    memberships: '[REDACTED]',
    budget: '[REDACTED]',
    authorization: '[REDACTED]',
    nested: { cardName: '[REDACTED]', safe: 'ok' },
  });
});


test('redacts bearer tokens, configured secrets, and long payment-number patterns from error text', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const text = redactSensitiveText(
    `failed Authorization: Bearer abc.def.ghi secret=${secret} card 4111 1111 1111 1111`,
    [secret],
  );
  assert.equal(text.includes(secret), false);
  assert.equal(/Bearer\s+abc\.def\.ghi/i.test(text), false);
  assert.equal(text.includes('4111 1111 1111 1111'), false);
  assert.match(text, /REDACTED/);
});
