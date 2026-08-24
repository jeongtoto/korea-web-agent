import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgentResearchInput } from '../src/agent/research.ts';
import { runResearch, type ResearchDependencies } from '../src/orchestrator/research.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';

const URL = 'https://brand.naver.com/example/products/1234567890';

function page(): DirectPageResult {
  return {
    url: URL,
    title: '테스트 QWGE43UT1 제품',
    product: { name: '테스트 QWGE43UT1 제품', brand: '테스트', sku: 'QWGE43UT1' },
    evidence: [{
      claim: '상품명 테스트 QWGE43UT1 제품',
      sourceUrl: URL,
      sourceType: 'json_ld_product',
      retrievedAt: '2026-08-24T09:00:00.000Z',
      acquisitionMethod: 'structured_data',
      evidenceClass: 'retailer_listing',
      independenceKey: 'test-product',
      confidence: 0.8,
      specificity: 'exact_product',
    }],
  };
}

test('agent input accepts request-scoped wallet names without creating a persistent profile', () => {
  const input = validateAgentResearchInput({
    query: '이 상품 할인 조사',
    purchaseContext: {
      paymentMethods: ['토스페이', '카카오페이', '네이버페이'],
      memberships: ['네이버플러스'],
    },
  });

  assert.deepEqual(input.purchaseContext?.paymentMethods, ['토스페이', '카카오페이', '네이버페이']);
  assert.deepEqual(input.purchaseContext?.memberships, ['네이버플러스']);
});

test('agent input rejects number-like sensitive data in paymentMethods', () => {
  assert.throws(() => validateAgentResearchInput({
    query: '할인 조사',
    purchaseContext: { paymentMethods: ['토스페이 4111 1111 1111 1111'] },
  }), /paymentMethods|numbers|names/i);
});

test('runResearch retries a transient direct-page timeout and preserves the successful provider result', async () => {
  let directAttempts = 0;
  const deps: ResearchDependencies = {
    directPage: async () => {
      directAttempts += 1;
      if (directAttempts < 3) throw new Error('ETIMEDOUT');
      return page();
    },
    publicSearch: async () => [],
    academicSearch: async () => [],
    relayClient: null,
    now: () => new Date('2026-08-24T09:00:00.000Z'),
    idFactory: () => 'retry-integrated',
  };

  const job = await runResearch({ question: '테스트 QWGE43UT1 어때?', url: URL, category: 'product' }, deps);

  assert.equal(directAttempts, 3);
  assert.ok(job.sourceResults.some((source) => source.source === 'direct_page' && source.success));
  assert.equal(job.errors.some((error) => /ETIMEDOUT/.test(error)), false);
});

test('runResearch does not retry authentication failures', async () => {
  let directAttempts = 0;
  const deps: ResearchDependencies = {
    directPage: async () => {
      directAttempts += 1;
      throw new Error('401 Unauthorized');
    },
    publicSearch: async () => [],
    academicSearch: async () => [],
    relayClient: null,
    now: () => new Date('2026-08-24T09:00:00.000Z'),
    idFactory: () => 'auth-no-retry',
  };

  const job = await runResearch({ question: '테스트 QWGE43UT1 어때?', url: URL, category: 'product' }, deps);

  assert.equal(directAttempts, 1);
  assert.ok(job.errors.some((error) => /401 Unauthorized/.test(error)));
});
