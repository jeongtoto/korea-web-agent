import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { runResearch } from '../src/orchestrator/research.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';

const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  name: 'QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지',
  model: 'QWGE43UT1',
  variant: 'V3',
};

const canonicalIdentity = compileCanonicalIdentity(
  target,
  '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
);

function exactPage(url: string): DirectPageResult {
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      offers: {
        price: 449000,
        currency: 'KRW',
        availability: 'InStock',
        shippingFee: 0,
      },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'EKWBYME78W V3',
      price: 449000,
      shippingFee: 0,
      availability: 'InStock',
      attributes: {},
    },
    sellerInfo: {
      name: '와이드뷰 공식 판매자',
      productId: 'wideview-v3-bundle',
      canonicalUrl: url,
    },
    evidence: [],
  };
}

test('runResearch uses exactly the required 13 v2 provider coverage rows while isolating a blocked provider', async () => {
  const naverUrl = 'https://brand.naver.com/widevu/products/100';
  const coupangUrl = 'https://www.coupang.com/vp/products/200';
  const job = await runResearch(
    {
      question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3)의 현재 가격을 조사해줘.',
      category: 'product',
      includeLocalRelay: false,
    },
    {
      publicSearch: async (query) => {
        if (query.includes('네이버 쇼핑')) return [{
          title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지 449,000원',
          url: naverUrl,
          snippet: '신품 무료배송',
        }];
        if (query.includes('site:coupang.com')) return [{
          title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지 448,000원',
          url: coupangUrl,
          snippet: '신품 무료배송',
        }];
        return [];
      },
      directPage: async (url) => {
        if (url === coupangUrl) throw new Error('403 bot blocked by site policy');
        if (url === naverUrl) return exactPage(url);
        throw new Error(`unexpected direct page: ${url}`);
      },
      relayClient: null,
      now: () => new Date('2026-08-25T21:30:00.000Z'),
      idFactory: () => 'provider-v2-integration',
    },
    {
      resolvedTarget: target,
      canonicalIdentity,
      identityConfidence: 1,
    },
  );

  assert.notEqual(job.status, 'failed');
  assert.ok(job.report);
  assert.ok(job.report?.bestOffers?.cash);
  assert.equal(job.report?.bestOffers?.cash?.amount, 449000);

  const coverage = (job.report?.marketCoverage ?? []) as Array<{
    providerId?: string;
    market: string;
    status: string;
  }>;
  assert.equal(coverage.length, 13);
  assert.deepEqual(coverage.map((row) => row.providerId), [
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
  ]);
  assert.equal(coverage.find((row) => row.providerId === 'naver-shopping')?.status, 'verified');
  assert.equal(coverage.find((row) => row.providerId === 'coupang')?.status, 'failed');
});
