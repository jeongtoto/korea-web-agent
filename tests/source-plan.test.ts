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

const REQUIRED_PROVIDER_IDS = [
  'naver-shopping',
  'coupang',
  'danawa',
  'enuri',
  '11st',
  'gmarket',
  'auction',
  'ssg',
  'lotteon',
  'himart',
  'official',
  'kakao-talkdeal',
  'toss-shopping',
] as const;

test('ordinary purchase source plan prioritizes all 13 required domestic commerce providers', () => {
  const plan = buildSourcePlan(target, '이 침대 어때? 지금 가격이면 살만해?');
  const ids = new Set(plan.map((item) => item.id));

  for (const required of REQUIRED_PROVIDER_IDS) {
    assert.ok(ids.has(required), `missing ${required}`);
  }

  assert.equal(ids.has('overseas'), false);
  assert.equal(ids.has('academic'), false);
  assert.ok(plan.find((item) => item.id === 'coupang')?.query.includes('site:coupang.com'));
  assert.ok(plan.find((item) => item.id === 'danawa')?.query.includes('site:danawa.com'));
  assert.ok(plan.find((item) => item.id === '11st')?.query.includes('site:11st.co.kr'));
  assert.ok(plan.find((item) => item.id === 'gmarket')?.query.includes('site:gmarket.co.kr'));
  assert.ok(plan.find((item) => item.id === 'auction')?.query.includes('site:auction.co.kr'));
  assert.ok(plan.find((item) => item.id === 'kakao-talkdeal')?.query.includes('site:store.kakao.com'));
  assert.ok(plan.find((item) => item.id === 'toss-shopping')?.query.includes('site:toss.im'));
});

test('supporting review sources remain available when they fit inside the bounded plan', () => {
  const plan = buildSourcePlan(target, '이 침대 어때? 지금 가격이면 살만해?');
  const ids = new Set(plan.map((item) => item.id));

  assert.ok(ids.has('general'));
  assert.ok(ids.has('naver-blog'));
  assert.ok(ids.has('naver-cafe'));
  assert.ok(plan.find((item) => item.id === 'naver-blog')?.query.includes('site:blog.naver.com'));
  assert.ok(plan.find((item) => item.id === 'naver-cafe')?.query.includes('site:cafe.naver.com'));
});

test('health or research question may add general-mechanism academic evidence without dropping required commerce providers', () => {
  const plan = buildSourcePlan(target, '논문까지 다 찾아서 이 제품이 허리 건강에 어떤지 엄청 자세히 알려줘');
  const ids = new Set(plan.map((item) => item.id));
  const base = plan.find((item) => item.id === 'general');

  assert.ok(base);
  assert.match(base.query, /밀도 원목 수납침대 K|mildo/);
  assert.ok(base.query.length < 220);
  for (const required of REQUIRED_PROVIDER_IDS) {
    assert.ok(ids.has(required), `academic plan dropped ${required}`);
  }
  assert.ok(plan.find((item) => item.id === 'academic')?.specificity === 'general_mechanism');
  assert.ok(plan.find((item) => item.id === 'academic')?.evidenceClass === 'peer_reviewed_research');
});

test('source plan is bounded and does not emit duplicate queries', () => {
  const plan = buildSourcePlan(target, '어때?');
  assert.ok(plan.length <= 20);
  assert.equal(new Set(plan.map((item) => item.query)).size, plan.length);
});
