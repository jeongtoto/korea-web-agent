import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import {
  buildSellerFallbackQuery,
  discoverFallbackSellers,
} from '../src/providers/seller-fallback-discovery.ts';

const target = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  variant: '43인치 V3',
  name: 'QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};
const canonicalIdentity = compileCanonicalIdentity(
  target,
  '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
);

const fixture = {
  providerId: 'danawa' as const,
  comparisonUrl: 'https://prod.danawa.com/info/?pcode=123',
  target,
  canonicalIdentity,
  limit: 4,
  retrievedAt: '2026-08-27T00:00:00.000Z',
};

test('fallback query contains exact primary model and required component version without broad category terms', () => {
  const query = buildSellerFallbackQuery({ target, canonicalIdentity });
  assert.match(query, /QWGE43UT1/i);
  assert.match(query, /EKWBYME78W/i);
  assert.match(query, /V3/i);
  assert.doesNotMatch(query, /TV|텔레비전|이동식\s*TV/i);
});

test('fallback search results remain discovery-only seller candidates and exclude comparison/community results', async () => {
  const sellers = await discoverFallbackSellers({
    ...fixture,
    search: async () => [
      {
        title: '와이드뷰 QWGE43UT1 EKWBYME78W V3 패키지 365,400원',
        url: 'https://www.11st.co.kr/products/777?utm_source=search',
        snippet: '오늘 365,400원 무료배송',
      },
      {
        title: '가격비교',
        url: 'https://prod.danawa.com/info/?pcode=999',
        snippet: '최저가',
      },
      {
        title: '사용 후기',
        url: 'https://blog.naver.com/example/123',
        snippet: '리뷰',
      },
    ],
  });

  assert.equal(sellers.length, 1);
  assert.equal(sellers[0]?.resolutionMethod, 'fallback_search');
  assert.equal(sellers[0]?.advertisedPrice, undefined);
  assert.equal(sellers[0]?.sellerUrl, 'https://www.11st.co.kr/products/777');
  assert.equal(sellers[0]?.verificationTrace?.priceStatus, undefined);
  assert.equal(sellers[0]?.verificationTrace?.resolutionMethod, 'fallback_search');
});
