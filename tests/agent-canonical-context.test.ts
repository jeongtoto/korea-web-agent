import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentResearch } from '../src/agent/research.ts';
import type { ResearchContext, ResearchJob, ResearchRequest } from '../src/core/types.ts';

test('agent passes the resolved canonical bundle identity into cloud research', async () => {
  let observedContext: ResearchContext | undefined;
  const query = '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 패키지 스펙 알려줘';

  await runAgentResearch({ query }, {
    publicSearch: async () => [{
      title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
      url: 'https://brand.naver.com/widevu/products/11458011168',
      snippet: 'QWGE43UT1 EKWBYME78W V3 43인치 UHD 4K',
    }],
    cloudResearch: async (request: ResearchRequest, context: ResearchContext): Promise<ResearchJob> => {
      observedContext = context;
      return {
        id: 'canonical-context-job',
        status: 'completed',
        request,
        createdAt: '2026-08-25T06:10:00.000Z',
        updatedAt: '2026-08-25T06:10:01.000Z',
        completedAt: '2026-08-25T06:10:01.000Z',
        target: context.resolvedTarget ?? { kind: 'unknown' },
        researchContext: context,
        sourceResults: [],
        evidence: [],
        relay: { available: false, used: false, mode: 'public_only' },
        errors: [],
      };
    },
  });

  assert.equal(observedContext?.canonicalIdentity?.primary.model, 'QWGE43UT1');
  assert.equal(observedContext?.canonicalIdentity?.primary.size, '43');
  assert.deepEqual(
    observedContext?.canonicalIdentity?.requiredComponents.map((component) => ({
      model: component.model,
      version: component.version,
    })),
    [{ model: 'EKWBYME78W', version: 'V3' }],
  );
});