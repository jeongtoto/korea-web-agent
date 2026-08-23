import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProduct } from '../src/orchestrator/product-resolver.ts';

test('resolves a query-only product when independent results agree on brand model and size', async () => {
  const result = await resolveProduct({
    question: '와이드뷰 43인치 4K V3 스탠드 어때?',
    category: 'product',
  }, {
    publicSearch: async () => [
      {
        title: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드',
        url: 'https://brand.naver.com/widevu/products/11458011168',
        snippet: '와이드뷰 V3 43인치 UHD 4K 스탠드',
      },
      {
        title: '와이드뷰 V3 43인치 UHD 4K 이동식 TV 후기',
        url: 'https://blog.naver.com/reviewer/223000000000',
        snippet: '와이드뷰 V3 43인치 실사용 후기',
      },
      {
        title: '삼성 M7 43인치 스마트모니터',
        url: 'https://example.com/samsung-m7',
        snippet: '43인치 4K 스마트모니터',
      },
    ],
  });

  assert.equal(result.ambiguous, false);
  assert.ok(result.confidence >= 0.7);
  assert.equal(result.target.kind, 'product');
  assert.match(result.target.name ?? '', /와이드뷰.*V3|V3.*와이드뷰/i);
  assert.equal(result.target.model?.toUpperCase(), 'V3');
  assert.match(result.target.variant ?? '', /43/);
  assert.ok(result.target.canonicalUrl);
});

test('prefers a relay-eligible commerce product URL even when a matching blog result appears first', async () => {
  const result = await resolveProduct({
    question: '와이드뷰 43인치 4K V3 스탠드 어때?',
    category: 'product',
  }, {
    publicSearch: async () => [
      {
        title: '와이드뷰 V3 43인치 UHD 4K 이동식 TV 후기',
        url: 'https://blog.naver.com/reviewer/223000000000',
        snippet: '와이드뷰 V3 43인치 실사용 후기',
      },
      {
        title: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드',
        url: 'https://brand.naver.com/widevu/products/11458011168',
        snippet: '와이드뷰 V3 43인치 UHD 4K 스탠드',
      },
    ],
  });

  assert.equal(result.ambiguous, false);
  assert.equal(result.target.canonicalUrl, 'https://brand.naver.com/widevu/products/11458011168');
  assert.equal(result.target.productId, '11458011168');
});

test('enriches a Shopping Live URL product id with discovery identity instead of stopping at an unnamed product', async () => {
  const shoppingLiveUrl = 'https://product.shoppinglive.naver.com/products/11458011168?prdFrom=checkout';
  const queries: string[] = [];
  const result = await resolveProduct({
    question: '살만한지 봐줘',
    url: shoppingLiveUrl,
    category: 'product',
  }, {
    publicSearch: async (query) => {
      queries.push(query);
      return [
        {
          title: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드 11458011168',
          url: 'https://product.shoppinglive.naver.com/products/11458011168',
          snippet: '와이드뷰 V3 43인치 UHD 4K 스탠드 상품번호 11458011168',
        },
        {
          title: '와이드뷰 V3 43인치 사용 후기 11458011168',
          url: 'https://blog.naver.com/reviewer/223000000001',
          snippet: '와이드뷰 V3 43인치 실사용 상품번호 11458011168',
        },
      ];
    },
  });

  assert.ok(queries.some((query) => query.includes('11458011168')));
  assert.equal(result.ambiguous, false);
  assert.equal(result.target.productId, '11458011168');
  assert.equal(result.target.canonicalUrl, 'https://product.shoppinglive.naver.com/products/11458011168');
  assert.match(result.target.name ?? '', /와이드뷰.*V3|V3.*와이드뷰/i);
  assert.equal(result.target.model?.toUpperCase(), 'V3');
  assert.match(result.target.variant ?? '', /43/);
});

test('preserves Naver Shopping Live liveId while enriching a live-view URL with product identity', async () => {
  const liveUrl = 'https://view.shoppinglive.naver.com/lives/1985890?fm=store&tr=ltlim';
  const result = await resolveProduct({
    question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지 가격 확인',
    url: liveUrl,
    category: 'product',
  }, {
    publicSearch: async () => [
      {
        title: '와이드뷰 QWGE43UT1 43인치 QLED 4K + EKWBYME78W V3 이동형 패키지',
        url: 'https://brand.naver.com/widevu/products/11458011168',
        snippet: 'QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지',
      },
      {
        title: '와이드뷰 QWGE43UT1 V3 43인치 가격비교',
        url: 'https://prod.danawa.com/info/?pcode=88236242',
        snippet: 'QWGE43UT1 V3 43인치',
      },
    ],
  });

  assert.equal(result.ambiguous, false);
  assert.equal(result.target.liveId, '1985890');
  assert.equal(result.target.canonicalUrl, 'https://view.shoppinglive.naver.com/lives/1985890');
  assert.equal(result.target.sourceHost, 'view.shoppinglive.naver.com');
});

test('refuses to resolve when top candidates are too close', async () => {
  const result = await resolveProduct({
    question: '43인치 4K 스마트모니터 어때?',
    category: 'product',
  }, {
    publicSearch: async () => [
      { title: '삼성 M7 43인치 4K 스마트모니터', url: 'https://example.com/m7', snippet: '43인치 4K' },
      { title: 'LG MyView 43인치 4K 스마트모니터', url: 'https://example.com/myview', snippet: '43인치 4K' },
    ],
  });

  assert.equal(result.ambiguous, true);
  assert.equal(result.target.kind, 'unknown');
  assert.ok(result.candidates.length >= 2);
});
