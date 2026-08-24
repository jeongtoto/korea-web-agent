import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentResearch, type AgentResearchDependencies } from '../src/agent/research.ts';
import type { ResearchContext, ResearchJob, ResearchRequest } from '../src/core/types.ts';

function job(request: ResearchRequest, context: ResearchContext): ResearchJob {
  return {
    id: 'category-job', status: 'completed', request,
    createdAt: '2026-08-24T06:00:00.000Z', updatedAt: '2026-08-24T06:00:01.000Z',
    target: context.resolvedTarget ?? { kind: 'product' }, researchContext: context,
    sourceResults: [], evidence: [], relay: { available: false, used: false, mode: 'public_only' }, errors: [],
    report: {
      decision: 'INSUFFICIENT', confidence: 0.55,
      confidenceDimensions: { identity: 0.5, price: 0.3, officialSpecs: 0.4, reviews: 0.4, negativeSignals: 0.2, personalizedPrice: 0 },
      title: '43인치 이동형 TV 추천', summary: '후보 비교', reasons: [], strengths: [], weaknesses: [], missingInformation: [], evidence: [], sourceCount: 0,
    },
  };
}

test('broad moving-TV recommendation proceeds without requiring an exact SKU', async () => {
  const observed: Array<{ request: ResearchRequest; context: ResearchContext }> = [];
  const deps: AgentResearchDependencies = {
    publicSearch: async () => [
      { title: '브랜드A 43인치 이동형 스마트TV V3', url: 'https://brand.naver.com/a/products/1', snippet: '43인치 이동식 4K 스탠드 세트' },
      { title: '브랜드B 43인치 무빙TV QLED', url: 'https://www.coupang.com/vp/products/2', snippet: '43인치 4K 이동형 TV' },
      { title: '브랜드C 43인치 이동식 TV', url: 'https://www.11st.co.kr/products/3', snippet: '43인치 스마트TV 스탠드 포함' },
    ],
    cloudResearch: async (request, context) => { observed.push({ request, context }); return job(request, context); },
  };

  const result = await runAgentResearch({ query: '43인치 이동형 티비를 사고 싶은데 어떤 게 좋아? 추천해줘' }, deps);
  assert.equal(observed.length, 1);
  assert.equal(result.researchMode, 'category_recommendation');
  assert.equal(result.clarificationRequired, false);
  assert.ok(result.assumptions.length >= 1);
  assert.ok(result.product.candidates.length >= 3);
});

test('category result may expose focused clarification questions without blocking preliminary research', async () => {
  const deps: AgentResearchDependencies = {
    publicSearch: async () => [
      { title: '브랜드A 43인치 이동형 스마트TV', url: 'https://brand.naver.com/a/products/1', snippet: '43인치 이동형 TV' },
      { title: '브랜드B 43인치 이동형 스마트TV', url: 'https://www.coupang.com/vp/products/2', snippet: '43인치 이동형 TV' },
      { title: '브랜드C 43인치 이동형 스마트TV', url: 'https://www.11st.co.kr/products/3', snippet: '43인치 이동형 TV' },
    ],
    cloudResearch: async (request, context) => job(request, context),
  };
  const result = await runAgentResearch({ query: '43인치 이동형 TV 추천' }, deps);
  assert.ok(result.clarificationQuestions.length <= 3);
  assert.equal(result.status, 'completed');
});
