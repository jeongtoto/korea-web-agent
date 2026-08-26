import test from 'node:test';
import assert from 'node:assert/strict';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';
import { rankPreliminaryCandidates } from '../src/shopping/preliminary-ranking.ts';
import type { FactValue, ShoppingCandidate } from '../src/shopping/types.ts';

function fact(value: FactValue['value'], verification: FactValue['verification'], sourceUrl: string): FactValue {
  return { value, verification, sourceUrl };
}

function candidate(key: string, discoveryScore: number, facts: Record<string, FactValue>, sourceUrls: string[]): ShoppingCandidate {
  return {
    key,
    brand: '브랜드',
    model: key.toUpperCase(),
    title: `브랜드 ${key.toUpperCase()} 43인치 4K 이동식 TV`,
    variant: { screenSizeInch: 43, resolution: '4K' },
    bundle: [],
    condition: 'new',
    sourceUrls,
    discoveryScore,
    facts,
    constraintState: 'ELIGIBLE',
  };
}

test('verified evidence outranks search prominence during preliminary finalist selection', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 화질 좋은 제품 추천해줘');
  const popular = candidate('popular', 0.99, {
    screenSizeInch: fact(43, 'search_metadata', 'https://search.example/popular'),
    resolution: fact('4K', 'search_metadata', 'https://search.example/popular'),
    portableStand: fact(true, 'search_metadata', 'https://search.example/popular'),
  }, ['https://search.example/popular']);
  const verified = candidate('verified', 0.62, {
    screenSizeInch: fact(43, 'official', 'https://brand.example/verified'),
    resolution: fact('4K', 'official', 'https://brand.example/verified'),
    portableStand: fact(true, 'page_verified', 'https://shop.example/verified'),
    brightnessNits: fact(500, 'official', 'https://brand.example/verified'),
    warrantyMonths: fact(24, 'official', 'https://brand.example/verified'),
  }, [
    'https://brand.example/verified',
    'https://shop.example/verified',
    'https://reviews.example/verified',
  ]);

  const ranked = rankPreliminaryCandidates(plan, [popular, verified], 2);

  assert.deepEqual(ranked.map((item) => item.candidate.key), ['verified', 'popular']);
  assert.ok((ranked[0]?.verifiedFactCoverage ?? 0) > (ranked[1]?.verifiedFactCoverage ?? 0));
  assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0));
});
