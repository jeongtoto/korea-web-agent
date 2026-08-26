import test from 'node:test';
import assert from 'node:assert/strict';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';
import { deepResearchCandidates } from '../src/shopping/deep-research.ts';
import type { ShoppingCandidate } from '../src/shopping/types.ts';

function candidate(index: number): ShoppingCandidate {
  return {
    key: `tv-${index}`,
    brand: '브랜드',
    model: `MODEL${1000 + index}`,
    title: `브랜드 MODEL${1000 + index} 43인치 4K 이동식 TV`,
    variant: { screenSizeInch: 43, resolution: '4K' },
    bundle: [],
    condition: 'new',
    sourceUrls: [`https://shop.example/${index}`],
    discoveryScore: 1 - index / 20,
    facts: {},
    constraintState: 'ELIGIBLE',
  };
}

test('deep research is capped at five finalists and explicitly searches reviews, negatives, durability, and service', async () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 가성비 추천해줘');
  const calls: string[] = [];
  const result = await deepResearchCandidates(plan, Array.from({ length: 7 }, (_, index) => candidate(index)), {
    publicSearch: async (query) => {
      calls.push(query);
      return [{
        title: '실사용 후기',
        url: `https://review.example/${calls.length}`,
        snippet: '화질이 선명하고 스탠드가 안정적이라는 후기',
      }];
    },
    now: () => new Date('2026-08-26T00:00:00.000Z'),
  });

  assert.equal(result.researchedCandidateKeys.length, 5);
  assert.ok(calls.some((query) => /(후기|리뷰)/.test(query)));
  assert.ok(calls.some((query) => /(단점|불량|고장|결함)/.test(query)));
  assert.ok(calls.some((query) => /(장기|내구)/.test(query)));
  assert.ok(calls.some((query) => /(A\/S|AS|보증|서비스)/i.test(query)));
  assert.ok(result.reviewEvidence.length > 0);
});

test('deep research isolates one search failure and preserves evidence from other queries/candidates', async () => {
  const plan = planShoppingResearch('퀸 사계절 차렵이불 추천해줘');
  let calls = 0;
  const result = await deepResearchCandidates(plan, [candidate(0), candidate(1)], {
    publicSearch: async (query) => {
      calls += 1;
      if (calls === 2) throw new Error('blocked source');
      return [{
        title: '사용 후기',
        url: `https://review.example/${calls}`,
        snippet: query.includes('단점') ? '세탁 후 보풀이 생긴다는 단점' : '촉감이 부드럽고 만족스럽다',
      }];
    },
    now: () => new Date('2026-08-26T00:00:00.000Z'),
  });

  assert.ok(result.errors.length >= 1);
  assert.ok(result.reviewEvidence.length >= 1);
  assert.deepEqual(result.researchedCandidateKeys, ['tv-0', 'tv-1']);
});
