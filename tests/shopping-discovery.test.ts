import test from 'node:test';
import assert from 'node:assert/strict';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';
import { discoverShoppingCandidates } from '../src/shopping/discovery.ts';
import type { SearchHit } from '../src/providers/index.ts';

test('broad discovery fans out across queries, preserves diversity, and caps raw hits at 80', async () => {
  const plan = planShoppingResearch('50만원 이하 43인치 4K 이동식 TV 가성비 좋은 거 추천해줘');
  const calls: string[] = [];

  const search = async (query: string): Promise<SearchHit[]> => {
    calls.push(query);
    const callIndex = calls.length;
    return Array.from({ length: 30 }, (_, index) => ({
      title: `브랜드${callIndex} TVMODEL${callIndex}-${index} 43인치 4K 이동식 TV`,
      url: `https://shop${callIndex}.example.com/product/${index}`,
      snippet: `query-${callIndex} result-${index}`,
    }));
  };

  const hits = await discoverShoppingCandidates(plan, search);

  assert.ok(calls.length >= 5);
  assert.ok(hits.length <= 80);
  assert.ok(new Set(hits.map((hit) => hit.queryId)).size >= 5, 'one discovery query must not monopolize the candidate pool');
  for (const query of plan.discoveryQueries) {
    const count = hits.filter((hit) => hit.queryId === query.id).length;
    assert.ok(count <= query.maxHits);
  }
});

test('broad discovery isolates one search failure and keeps successful queries', async () => {
  const plan = planShoppingResearch('퀸 사계절 차렵이불 30만원 이하 추천해줘');
  let calls = 0;
  const hits = await discoverShoppingCandidates(plan, async (query) => {
    calls += 1;
    if (calls === 2) throw new Error('temporary search failure');
    return [{ title: `브랜드 퀸 사계절 차렵이불 ${calls}`, url: `https://example.com/${calls}`, snippet: query }];
  });

  assert.ok(calls >= 5);
  assert.ok(hits.length >= 4);
  assert.ok(hits.every((hit) => hit.title.includes('차렵이불')));
});
