import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { resolveProduct } from '../src/orchestrator/product-resolver.ts';
import { fetchDirectPage } from '../src/providers/direct-page.ts';
import { danawaExtractor } from '../src/providers/markets/danawa.ts';
import { directPageIdentityMatch } from '../src/providers/seller-expansion.ts';

const DANAWA_URL = 'https://prod.danawa.com/info/?pcode=88236242';
const EXACT_QUERY = '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지 현재 가격';

test('explicit Danawa URL preserves the requested exact product identity even when search discovery is unavailable', async () => {
  const result = await resolveProduct({
    question: EXACT_QUERY,
    url: DANAWA_URL,
    category: 'product',
  }, {
    publicSearch: async () => [],
  });

  assert.equal(result.ambiguous, false);
  assert.equal(result.target.kind, 'product');
  assert.equal(result.target.canonicalUrl, DANAWA_URL);
  assert.equal(result.target.sourceHost, 'prod.danawa.com');
  assert.equal(result.canonicalIdentity?.primary.model, 'QWGE43UT1');
  assert.equal(result.canonicalIdentity?.primary.size, '43');
  assert.deepEqual(result.canonicalIdentity?.requiredComponents.map((item) => [item.model, item.version]), [
    ['EKWBYME78W', 'V3'],
  ]);
});

test('Danawa page extractor preserves exact V3 bundle identity from page metadata', async () => {
  const html = `<!doctype html><html><head>
    <title>와이드뷰 QWGE43UT1 이동형 패키지 (와이드뷰 V3) : 다나와 가격비교</title>
    <meta property="og:title" content="와이드뷰 QWGE43UT1 이동형 패키지 (와이드뷰 V3)" />
    <meta name="description" content="QWGE43UT1 43인치 UHD 4K TV + EKWBYME78W(V3) 이동형 스탠드 포함 신품 패키지" />
  </head><body>와이드뷰 QWGE43UT1 EKWBYME78W(V3) 43인치 이동형 패키지</body></html>`;
  const fakeFetch: typeof fetch = async () => new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const page = await fetchDirectPage(DANAWA_URL, fakeFetch, danawaExtractor);
  const canonical = compileCanonicalIdentity(
    { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', name: EXACT_QUERY },
    EXACT_QUERY,
  );
  const identity = directPageIdentityMatch(canonical, page);

  assert.equal(identity.verdict, 'exact');
});

function sellerPageHtml(shippingText: string): string {
  return `<!doctype html><html><head>
    <meta property="og:title" content="와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지" />
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
      brand: { '@type': 'Brand', name: '와이드뷰' },
      model: 'QWGE43UT1',
      description: 'EKWBYME78W(V3) 이동형 스탠드 포함',
      offers: { '@type': 'Offer', price: '449000', priceCurrency: 'KRW', availability: 'https://schema.org/InStock' },
    })}</script>
  </head><body><main><div class="delivery">${shippingText}</div></main></body></html>`;
}

async function fetchSellerShipping(shippingText: string) {
  const fakeFetch: typeof fetch = async () => new Response(sellerPageHtml(shippingText), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  return fetchDirectPage('https://www.11st.co.kr/products/88236242', fakeFetch);
}

test('static seller page promotes explicit free shipping to deterministic zero', async () => {
  const page = await fetchSellerShipping('배송비: 무료배송');
  assert.equal(page.facts?.shippingFee, 0);
});

test('static seller page promotes one explicit fixed shipping fee', async () => {
  const page = await fetchSellerShipping('배송비 3,000원');
  assert.equal(page.facts?.shippingFee, 3000);
});

test('conditional, regional, collect-on-delivery, or extra shipping remains unresolved', async () => {
  for (const shippingText of [
    '조건부 무료배송 (30,000원 이상)',
    '배송비 3,000원 / 제주 도서산간 추가 배송비',
    '배송비 착불',
    '설치 지역에 따라 배송비 별도',
  ]) {
    const page = await fetchSellerShipping(shippingText);
    assert.equal(page.facts?.shippingFee, undefined, shippingText);
  }
});
