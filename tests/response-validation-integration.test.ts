import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from '../src/orchestrator/research.ts';
import type { ResearchDependencies } from '../src/orchestrator/research.ts';

const deps: ResearchDependencies = {
  directPage: async () => { throw new Error('not used'); },
  publicSearch: async () => [],
  academicSearch: async () => [],
  relayClient: null,
  now: () => new Date('2026-08-25T06:45:00.000Z'),
  idFactory: () => 'response-validation-integration',
};

test('runResearch echoes only the current request purchase context into ProductReport and validates it', async () => {
  const job = await runResearch({
    question: '와이드뷰 QWGE43UT1 가격 확인',
    category: 'product',
    purchaseContext: {
      ownedCards: ['삼성 iD SELECT ALL'],
      paymentMethods: ['네이버페이'],
      memberships: ['네이버플러스'],
      budget: 400000,
      region: '대한민국 서울',
      preferences: ['신품'],
    },
  }, deps);

  const report = job.report as any;
  assert.deepEqual(report?.purchaseContextApplied, {
    ownedCards: ['삼성 iD SELECT ALL'],
    paymentMethods: ['네이버페이'],
    memberships: ['네이버플러스'],
    budget: 400000,
    region: '대한민국 서울',
    preferences: ['신품'],
  });
  assert.equal(report?.validationWarnings?.some((item: any) => item.code === 'PURCHASE_CONTEXT_NOT_APPLIED'), false);
});

test('runResearch never restores a purchase profile when the current request has no purchaseContext', async () => {
  const job = await runResearch({
    question: '와이드뷰 QWGE43UT1 가격 확인',
    category: 'product',
  }, { ...deps, idFactory: () => 'response-validation-no-context' });

  assert.equal((job.report as any)?.purchaseContextApplied, undefined);
});
