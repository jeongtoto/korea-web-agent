import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourcePlan } from '../src/providers/source-plan.ts';
import type { NormalizedTarget } from '../src/core/types.ts';

const target: NormalizedTarget = {
  kind: 'product',
  brand: 'mildo',
  name: '밀도 원목 수납침대 K',
  productId: '7322162980',
  canonicalUrl: 'https://brand.naver.com/mildo/products/7322162980',
};

test('ordinary purchase source plan covers commerce and reviews without mandatory academic search', () => {
  const plan = buildSourcePlan(target, '이 침대 어때? 지금 가격이면 살만해?');
  const ids = new Set(plan.map((item) => item.id));

  for (const required of [
    'naver-shopping', 'naver-blog', 'naver-cafe', 'coupang', 'danawa',
    'kream', 'enuri', 'open-market', 'retail', 'used', 'refurb', 'overseas', 'offline',
    'youtube', 'reddit', 'news', 'official',
  ]) {
    assert.ok(ids.has(required), `missing ${required}`);
  }

  assert.equal(ids.has('academic'), false);
  assert.ok(plan.find((item) => item.id === 'naver-blog')?.query.includes('site:blog.naver.com'));
  assert.ok(plan.find((item) => item.id === 'naver-cafe')?.query.includes('site:cafe.naver.com'));
  assert.ok(plan.find((item) => item.id === 'coupang')?.query.includes('site:coupang.com'));
  assert.ok(plan.find((item) => item.id === 'danawa')?.query.includes('site:danawa.com'));
  assert.ok(plan.find((item) => item.id === 'youtube')?.query.includes('site:youtube.com'));
  assert.ok(plan.find((item) => item.id === 'reddit')?.query.includes('site:reddit.com'));
});

test('health or research question may add general-mechanism academic evidence', () => {
  const plan = buildSourcePlan(target, '논문까지 다 찾아서 이 제품이 허리 건강에 어떤지 엄청 자세히 알려줘');
  const base = plan.find((item) => item.id === 'general');
  assert.ok(base);
  assert.match(base.query, /밀도 원목 수납침대 K|mildo/);
  assert.ok(base.query.length < 220);
  assert.ok(plan.find((item) => item.id === 'academic')?.specificity === 'general_mechanism');
  assert.ok(plan.find((item) => item.id === 'academic')?.evidenceClass === 'peer_reviewed_research');
});

test('source plan is bounded and does not emit duplicate queries', () => {
  const plan = buildSourcePlan(target, '어때?');
  assert.ok(plan.length <= 20);
  assert.equal(new Set(plan.map((item) => item.query)).size, plan.length);
});
