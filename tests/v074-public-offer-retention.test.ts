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

function sellerPage(url: string, price: number, paymentPrice?: number): DirectPageResult {
  const productId = new URL(url).searchParams.get('goodsCode') ?? 'unknown';
  return {
    url,
    title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 신품 패키지',
    product: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      offers: {
        price,
        currency: 'KRW',
        availability: 'InStock',
        shippingFee: 0,
      },
    },
    facts: {
      name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 신품 패키지',
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      price,
      availability: 'InStock',
      shippingFee: 0,
    },
    sellerInfo: {
      name: `G마켓 판매자 ${productId}`,
      productId,
      canonicalUrl: url,
    },
    ...(paymentPrice !== undefined ? {
      promotion: {
        type: 'instant_discount' as const,
        active: true,
        accountRequired: false,
        condition: `토스페이 결제 시 ${paymentPrice.toLocaleString('ko-KR')}원`,
      },
    } : {}),
    evidence: [],
  };
}

test('per-market retention cannot let lower conditional prices crowd out the lowest public cash offer', async () => {
  const offers = [
    { url: 'https://item.gmarket.co.kr/Item?goodsCode=1001', price: 190000, paymentPrice: 100000 },
    { url: 'https://item.gmarket.co.kr/Item?goodsCode=1002', price: 191000, paymentPrice: 101000 },
    { url: 'https://item.gmarket.co.kr/Item?goodsCode=1003', price: 192000, paymentPrice: 102000 },
    { url: 'https://item.gmarket.co.kr/Item?goodsCode=1004', price: 150000 },
  ];
  const pages = new Map(offers.map((offer) => [offer.url, sellerPage(offer.url, offer.price, offer.paymentPrice)]));

  const job = await runResearch(
    {
      question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3)의 현재 공개 구매가를 조사해줘.',
      category: 'product',
      includeLocalRelay: false,
    },
    {
      publicSearch: async (query) => query.includes('site:gmarket.co.kr')
        ? offers.map((offer) => ({
            title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 신품 패키지',
            url: offer.url,
            snippet: `판매가 ${offer.price.toLocaleString('ko-KR')}원 무료배송 재고있음`,
          }))
        : [],
      directPage: async (url) => {
        const page = pages.get(url);
        if (!page) throw new Error(`unexpected direct page: ${url}`);
        return page;
      },
      relayClient: null,
      now: () => new Date('2026-09-06T05:30:00.000Z'),
      idFactory: () => 'public-offer-retention',
    },
    {
      resolvedTarget: target,
      canonicalIdentity,
      identityConfidence: 1,
    },
  );

  const retained = job.report?.offers?.filter((offer) => offer.market === 'G마켓') ?? [];
  assert.equal(retained.length, 3);
  assert.ok(retained.some((offer) => offer.url === offers[3]!.url));
  assert.equal(job.report?.bestOffers?.cash?.amount, 150000);
  assert.ok(retained.some((offer) => offer.paymentPrice === 100000 && offer.promotion?.accountRequired === false));
});
