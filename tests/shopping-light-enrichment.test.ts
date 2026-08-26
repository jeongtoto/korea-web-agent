import test from 'node:test';
import assert from 'node:assert/strict';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';
import { lightEnrichCandidates } from '../src/shopping/light-enrichment.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';
import type { FactValue, ShoppingCandidate } from '../src/shopping/types.ts';

function candidate(index: number, facts: Record<string, FactValue> = {}): ShoppingCandidate {
  return {
    key: `c-${index}`,
    model: `MODEL${1000 + index}`,
    title: `브랜드 MODEL${1000 + index} 43인치 4K 이동식 TV`,
    variant: {},
    bundle: [],
    condition: 'new',
    sourceUrls: [`https://shop.example.com/${index}`],
    discoveryScore: 1 - index / 100,
    facts,
    constraintState: 'PRELIMINARY',
  };
}

function page(url: string, attributes: Record<string, string | number | boolean>): DirectPageResult {
  return {
    url,
    title: 'verified product',
    facts: { attributes },
    evidence: [],
  };
}

test('light enrichment upgrades structured facts, gates candidates, and never lets weaker data overwrite official facts', async () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const official: FactValue = { value: '4K', verification: 'official', sourceUrl: 'https://brand.example/spec' };
  const input = [candidate(1), candidate(2, { resolution: official })];

  const enriched = await lightEnrichCandidates(plan, input, {
    directPage: async (url) => url.endsWith('/1')
      ? page(url, { screenSizeInch: 43, resolution: '4K', portableStand: true })
      : page(url, { screenSizeInch: 43, resolution: 'FHD', portableStand: true }),
    publicSearch: async () => [],
  });

  assert.equal(enriched[0]?.constraintState, 'ELIGIBLE');
  assert.equal(enriched[0]?.facts.resolution?.verification, 'page_verified');
  assert.equal(enriched[1]?.facts.resolution?.value, '4K', 'official fact must survive a weaker page conflict');
  assert.equal(enriched[1]?.facts.resolution?.verification, 'official');
});

test('light enrichment is capped at 20 and isolates one candidate fetch failure', async () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const input = Array.from({ length: 25 }, (_, index) => candidate(index));
  let calls = 0;

  const enriched = await lightEnrichCandidates(plan, input, {
    directPage: async (url) => {
      calls += 1;
      if (url.endsWith('/3')) throw new Error('blocked');
      return page(url, { screenSizeInch: 43, resolution: '4K', portableStand: true });
    },
    publicSearch: async () => [],
  });

  assert.equal(calls, 20);
  assert.equal(enriched.length, 25);
  assert.equal(enriched.find((item) => item.key === 'c-3')?.constraintState, 'PRELIMINARY');
  assert.equal(enriched.find((item) => item.key === 'c-4')?.constraintState, 'ELIGIBLE');
  assert.equal(enriched.find((item) => item.key === 'c-24')?.constraintState, 'PRELIMINARY');
});
