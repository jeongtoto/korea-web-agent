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

test('product source plan explicitly covers Korean shopping, community, video, news, and research sources', () => {
  const plan = buildSourcePlan(target, '이 침대 어때? 지금 가격이면 살만해?');
  const ids = new Set(plan.map((item) => item.id));

  for (const required of [
    'naver-shopping', 'naver-blog', 'naver-cafe', 'coupang', 'danawa',
    'youtube', 'reddit', 'news', 'academic', 'official',
  ]) {
    assert.ok(ids.has(required), `missing ${required}`);
  }

  assert.ok(plan.find((item) => item.id === 'naver-blog')?.query.includes('site:blog.naver.com'));
  assert.ok(plan.find((item) => item.id === 'naver-cafe')?.query.includes('site:cafe.naver.com'));
  assert.ok(plan.find((item) => item.id === 'coupang')?.query.includes('site:coupang.com'));
  assert.ok(plan.find((item) => item.id === 'danawa')?.query.includes('site:danawa.com'));
  assert.ok(plan.find((item) => item.id === 'youtube')?.query.includes('site:youtube.com'));
  assert.ok(plan.find((item) => item.id === 'reddit')?.query.includes('site:reddit.com'));
});

test('source plan uses product identity instead of stuffing the entire user question into every query', () => {
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
  assert.ok(plan.length <= 14);
  assert.equal(new Set(plan.map((item) => item.query)).size, plan.length);
});
