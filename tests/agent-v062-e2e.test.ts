import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentResearch } from '../src/agent/research.ts';
import { createDefaultResearchDependencies, runResearch } from '../src/orchestrator/research.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';

const QUERY = '와이드뷰 QWGE43UT1 + EKWBYME78W(V3)의 현재 가격을 조사해줘.';
const RESOLVED_URL = 'https://brand.naver.com/widevu/products/11458011168';
const NAVER_SNIPPET_URL = 'https://brand.naver.com/widevu/products/33000001';
const DANAWA_URL = 'https://prod.danawa.com/info/?pcode=44900001';
const VERIFIED_SELLER_URL = 'https://www.11st.co.kr/products/44900001';
const UNKNOWN_SHIPPING_URL = 'https://www.11st.co.kr/products/43000001';
const NOW = new Date('2026-08-26T05:30:00.000Z');

const exactName = '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지';

function productPage(
  url: string,
  options: { price?: number; shippingFee?: number; availability?: string; sellerLinks?: DirectPageResult['sellerLinks'] } = {},
): DirectPageResult {
  return {
    url,
    title: exactName,
    facts: {
      name: exactName,
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      description: 'EKWBYME78W V3 이동형 스탠드 포함 신품 세트',
      ...(options.price !== undefined ? { price: options.price } : {}),
      ...(options.shippingFee !== undefined ? { shippingFee: options.shippingFee } : {}),
      ...(options.availability ? { availability: options.availability } : {}),
    },
    product: {
      name: exactName,
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      description: 'EKWBYME78W V3 이동형 스탠드 포함 신품 세트',
      ...(options.price !== undefined ? {
        offers: {
          price: options.price,
          currency: 'KRW',
          ...(options.shippingFee !== undefined ? { shippingFee: options.shippingFee } : {}),
          ...(options.availability ? { availability: options.availability } : {}),
        },
      } : {}),
    },
    ...(options.sellerLinks ? { sellerLinks: options.sellerLinks } : {}),
    evidence: [],
  };
}

function resolverHit() {
  return [{
    title: exactName,
    url: RESOLVED_URL,
    snippet: 'QWGE43UT1 본체와 EKWBYME78W(V3) 스탠드가 포함된 43인치 신품 패키지',
  }];
}

function providerSearch(query: string) {
  if (query.includes('네이버 쇼핑')) return [{
    title: `${exactName} 330,000원`,
    url: NAVER_SNIPPET_URL,
    snippet: '검색 노출가 330,000원 무료배송',
  }];
  if (query.includes('site:danawa.com')) return [{
    title: `${exactName} 449,000원`,
    url: DANAWA_URL,
    snippet: '다나와 표시 최저가 449,000원',
  }];
  if (query.includes('site:11st.co.kr')) return [{
    title: `${exactName} 430,000원`,
    url: UNKNOWN_SHIPPING_URL,
    snippet: '11번가 430,000원 배송비 별도 확인',
  }];
  if (query.includes('site:')) return [];
  return resolverHit();
}

async function runFixture(danawaSellerShippingFee: number | undefined) {
  const directPage = async (url: string): Promise<DirectPageResult> => {
    if (url === RESOLVED_URL || url === NAVER_SNIPPET_URL) return productPage(url);
    if (url === DANAWA_URL) return productPage(url, {
      sellerLinks: [{
        url: VERIFIED_SELLER_URL,
        sellerName: '판매처A',
        productId: '44900001',
        advertisedPrice: 449000,
      }],
    });
    if (url === VERIFIED_SELLER_URL) return productPage(url, {
      price: 449000,
      ...(danawaSellerShippingFee !== undefined ? { shippingFee: danawaSellerShippingFee } : {}),
      availability: 'in_stock',
    });
    if (url === UNKNOWN_SHIPPING_URL) return productPage(url, {
      price: 430000,
      availability: 'in_stock',
    });
    return { url, evidence: [] };
  };

  return runAgentResearch({ query: QUERY }, {
    publicSearch: async (query) => providerSearch(query),
    cloudResearch: async (request, context) => runResearch(request, createDefaultResearchDependencies({
      directPage,
      publicSearch: async (query) => providerSearch(query),
      academicSearch: async () => [],
      relayClient: null,
      now: () => NOW,
      idFactory: () => 'wideview-v062-e2e',
    }), context),
  });
}

test('v0.6.2 exact-product E2E follows Danawa to the seller and ranks verified shipping-inclusive cash over lower snippets', async () => {
  const result = await runFixture(0);

  assert.equal(result.product.ambiguous, false);
  assert.equal(result.canonicalIdentity?.primary.model, 'QWGE43UT1');
  assert.equal(result.bestOffers?.cash?.amount, 449000);
  assert.equal(result.bestOffers?.cash?.offer.url, VERIFIED_SELLER_URL);
  assert.equal(result.bestOffers?.cash?.offer.verification, 'page_verified');
  assert.equal(result.bestOffers?.cash?.offer.shipping?.status, 'free');
  assert.equal(result.bestOffers?.cash?.offer.totalCashPrice, 449000);

  const snippet = result.offers?.find((offer) => offer.url === NAVER_SNIPPET_URL && offer.verification === 'search_metadata');
  assert.equal(snippet?.salePrice, 330000);
  assert.equal(snippet?.eligible, false);
  assert.notEqual(result.bestOffers?.cash?.offer.url, NAVER_SNIPPET_URL);

  const unknownShipping = result.offers?.find((offer) => offer.url === UNKNOWN_SHIPPING_URL && offer.verification === 'page_verified');
  assert.equal(unknownShipping?.salePrice, 430000);
  assert.equal(unknownShipping?.shipping?.status, 'unknown');
  assert.equal(unknownShipping?.eligible, false);

  assert.equal(result.marketCoverage?.length, 13);
  assert.equal(new Set(result.marketCoverage?.map((row) => row.providerId)).size, 13);
  const danawa = result.marketCoverage?.find((row) => row.providerId === 'danawa');
  assert.equal(danawa?.comparisonPages, 1);
  assert.equal(danawa?.expandedSellers, 1);
  assert.equal(danawa?.eligibleSellers, 1);

  assert.equal(result.relay.requested, true);
  assert.equal(result.relay.used, false);
  assert.equal(result.relay.mode, 'public_only');
});

test('v0.6.2 exact-product E2E stays INSUFFICIENT when every exact seller has unresolved shipping', async () => {
  const result = await runFixture(undefined);

  assert.equal(result.product.ambiguous, false);
  assert.equal(result.bestOffers?.cash, undefined);
  assert.equal(result.decision, 'INSUFFICIENT');
  assert.ok((result.offers ?? []).some((offer) => offer.identityVerdict === 'exact' && offer.shipping?.status === 'unknown'));
  assert.equal(result.marketCoverage?.length, 13);
  assert.equal(result.relay.used, false);
  assert.equal(result.relay.mode, 'public_only');
});
