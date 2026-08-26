import test from 'node:test';
import assert from 'node:assert/strict';
import { planShoppingResearch } from '../src/shopping/query-planner.ts';
import { normalizeShoppingCandidates } from '../src/shopping/candidate-normalizer.ts';
import type { ShoppingRawHit } from '../src/shopping/types.ts';

function raw(title: string, url: string, snippet = ''): ShoppingRawHit {
  return { queryId: 'q', title, url, snippet, sourceGroup: 'market' };
}

test('normalizer merges the same exact model/variant but keeps V2 and V3 bundles separate', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const candidates = normalizeShoppingCandidates([
    raw('와이드뷰 QWGE43UT1 43인치 UHD 4K + EKWBYME78W(V3) 이동식 TV', 'https://naver.example/v3'),
    raw('WideView QWGE43UT1 43형 4K 이동형 패키지 EKWBYME78W V3', 'https://danawa.example/v3'),
    raw('와이드뷰 QWGE43UT1 43인치 4K + EKWBYME78W(V2) 이동식 TV', 'https://shop.example/v2'),
  ], plan);

  assert.equal(candidates.length, 2);
  const v3 = candidates.find((candidate) => String(candidate.variant.standVersion).toUpperCase() === 'V3');
  const v2 = candidates.find((candidate) => String(candidate.variant.standVersion).toUpperCase() === 'V2');
  assert.ok(v3);
  assert.ok(v2);
  assert.equal(v3.sourceUrls.length, 2);
  assert.equal(v3.model, 'QWGE43UT1');
});

test('normalizer never merges conflicting resolution, size, or condition', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const candidates = normalizeShoppingCandidates([
    raw('브랜드 ABC43X 43인치 4K 이동식 TV', 'https://a.example/new-4k'),
    raw('브랜드 ABC43X 43인치 FHD 이동식 TV', 'https://a.example/new-fhd'),
    raw('브랜드 ABC43X 40인치 4K 이동식 TV', 'https://a.example/new-40'),
    raw('브랜드 ABC43X 43인치 4K 이동식 TV 리퍼', 'https://a.example/refurb'),
  ], plan);

  assert.equal(candidates.length, 4);
  assert.deepEqual(new Set(candidates.map((candidate) => candidate.condition)), new Set(['new', 'refurbished']));
  assert.ok(candidates.some((candidate) => candidate.variant.resolution === 'FHD'));
  assert.ok(candidates.some((candidate) => candidate.variant.screenSizeInch === 40));
});

test('exact model evidence ranks above a generic lexical lookalike', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const candidates = normalizeShoppingCandidates([
    raw('가성비 43인치 UHD 4K 스마트 이동식 TV 스탠드 포함', 'https://generic.example/item'),
    raw('와이드뷰 QWGE43UT1 43인치 4K 이동식 TV', 'https://exact.example/item'),
  ], plan);

  assert.equal(candidates[0]?.model, 'QWGE43UT1');
  assert.ok((candidates[0]?.discoveryScore ?? 0) > (candidates[1]?.discoveryScore ?? 0));
});

test('normalization is bounded to 50 unique candidates', () => {
  const plan = planShoppingResearch('43인치 4K 이동식 TV 추천해줘');
  const hits = Array.from({ length: 65 }, (_, index) =>
    raw(`브랜드 MODELX${1000 + index} 43인치 4K 이동식 TV`, `https://example.com/${index}`));

  const candidates = normalizeShoppingCandidates(hits, plan);
  assert.equal(candidates.length, 50);
});
