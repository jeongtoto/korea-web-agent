import test from 'node:test';
import assert from 'node:assert/strict';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';

function constraint(plan: ReturnType<typeof planShoppingResearch>, field: string) {
  return plan.hardConstraints.find((item) => item.field === field);
}

test('plans precision portable-display recommendation with hard requirements and bounded broad discovery', () => {
  const plan = planShoppingResearch('50만원 이하 43인치 4K 이동식 TV 가성비 좋은 거 추천해줘. 화질과 이동성이 중요해.');

  assert.equal(plan.mode, 'RECOMMENDATION');
  assert.equal(plan.categoryId, 'portable_display');
  assert.deepEqual(plan.budget, { max: 500_000, strength: 'hard' });
  assert.equal(constraint(plan, 'screenSizeInch')?.expected, 43);
  assert.equal(constraint(plan, 'resolution')?.expected, '4K');
  assert.equal(constraint(plan, 'portableStand')?.expected, true);
  assert.ok(plan.discoveryQueries.length >= 5);
  assert.ok(new Set(plan.discoveryQueries.map((item) => item.query)).size === plan.discoveryQueries.length);
  assert.deepEqual(plan.limits, {
    rawHits: 80,
    normalizedCandidates: 50,
    lightEnrichment: 20,
    shortlist: 10,
    deepResearch: 5,
    fullPriceVerification: 3,
  });
  const weightSum = Object.values(plan.dimensionWeights).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(weightSum - 1) < 1e-9);
  assert.ok((plan.dimensionWeights.displayQuality ?? 0) > (plan.dimensionWeights.smartFeatures ?? 0));
  assert.ok((plan.dimensionWeights.mobility ?? 0) > (plan.dimensionWeights.reviewConsensus ?? 0));
});

test('plans queen all-season bedding recommendation with hard size and budget', () => {
  const plan = planShoppingResearch('퀸 사이즈에 맞는 사계절 차렵이불 추천해줘. 30만원 이하로 세탁 편하고 촉감 좋은 가성비 제품.');

  assert.equal(plan.mode, 'RECOMMENDATION');
  assert.equal(plan.categoryId, 'bedding');
  assert.deepEqual(plan.budget, { max: 300_000, strength: 'hard' });
  assert.deepEqual(constraint(plan, 'bedSize')?.expected, ['Q', 'QUEEN']);
  assert.equal(constraint(plan, 'allSeason')?.expected, true);
  assert.ok(plan.preferences.some((item) => item.dimension === 'care'));
  assert.ok(plan.preferences.some((item) => item.dimension === 'tactileComfort'));
  assert.ok(plan.discoveryQueries.some((item) => /퀸|Q/.test(item.query)));
});

test('keeps exact model research out of broad recommendation mode', () => {
  const plan = planShoppingResearch('와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 지금 최저가 얼마야?');
  assert.equal(plan.mode, 'EXACT_PRODUCT');
  assert.equal(plan.categoryId, 'portable_display');
});

test('recognizes explicit product comparison mode', () => {
  const plan = planShoppingResearch('필립스 32M2N5800이랑 비트엠 32인치 4K 모델 비교해줘');
  assert.equal(plan.mode, 'COMPARISON');
  assert.equal(plan.categoryId, 'portable_display');
});
