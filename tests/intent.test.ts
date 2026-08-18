import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyResearchIntent } from '../src/core/intent.ts';

test('purchase evaluation marks personalized price as useful', () => {
  assert.deepEqual(classifyResearchIntent('와이드뷰 43인치 4K V3 스탠드 어때?'), {
    productResearch: true,
    purchaseDecision: true,
    priceSensitive: true,
    personalizedPriceUseful: true,
    specOnly: false,
  });
});

test('specification-only question suppresses personalized price relay', () => {
  const intent = classifyResearchIntent('와이드뷰 V3 43인치 패널 스펙 알려줘');
  assert.equal(intent.productResearch, true);
  assert.equal(intent.specOnly, true);
  assert.equal(intent.purchaseDecision, false);
  assert.equal(intent.priceSensitive, false);
  assert.equal(intent.personalizedPriceUseful, false);
});

test('explicit price and coupon language is price-sensitive', () => {
  const intent = classifyResearchIntent('와이드뷰 V3 지금 사도 돼? 쿠폰까지 보면 얼마야?');
  assert.equal(intent.purchaseDecision, true);
  assert.equal(intent.priceSensitive, true);
  assert.equal(intent.personalizedPriceUseful, true);
  assert.equal(intent.specOnly, false);
});
