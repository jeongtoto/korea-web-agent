import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity } from '../src/core/canonical-identity.ts';
import { resolveProduct } from '../src/orchestrator/product-resolver.ts';
import { runMarketProviderCoverage } from '../src/orchestrator/provider-pipeline.ts';
import { fetchDirectPage, type DirectPageResult } from '../src/providers/direct-page.ts';
import { danawaExtractor } from '../src/providers/markets/danawa.ts';
import { naverShoppingProvider } from '../src/providers/markets/naver.ts';
import { directPageIdentityMatch, verifiedSellerOfferFromPage } from '../src/providers/seller-expansion.ts';

const DANAWA_URL = 'https://prod.danawa.com/info/?pcode=88236242';
const NAVER_PORTAL_URL = 'https://shopping.naver.com/catalog/88236242';
const NAVER_SELLER_URL = 'https://www.11st.co.kr/products/88236242';
const EXACT_QUERY = '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지 현재 가격';

function canonicalWideView() {
  return compileCanonicalIdentity(
    { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', name: EXACT_QUERY, variant: '43인치' },
    EXACT_QUERY,
  );
}

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
  const identity = directPageIdentityMatch(canonicalWideView(), page);
  assert.equal(identity.verdict, 'exact');
});

function sellerPageHtml(shippingText: string, options: { price?: number; bundleVersion?: 'V2' | 'V3' } = {}): string {
  const price = options.price ?? 449000;
  const bundleVersion = options.bundleVersion ?? 'V3';
  return `<!doctype html><html><head>
    <meta property="og:title" content="와이드뷰 QWGE43UT1 + EKWBYME78W(${bundleVersion}) 43인치 이동형 패키지" />
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `와이드뷰 QWGE43UT1 + EKWBYME78W(${bundleVersion}) 43인치 이동형 패키지`,
      brand: { '@type': 'Brand', name: '와이드뷰' },
      model: 'QWGE43UT1',
      description: `EKWBYME78W(${bundleVersion}) 이동형 스탠드 포함`,
      offers: { '@type': 'Offer', price: String(price), priceCurrency: 'KRW', availability: 'https://schema.org/InStock' },
    })}</script>
  </head><body><main><div class="delivery">${shippingText}</div></main></body></html>`;
}

async function fetchSellerShipping(shippingText: string, options: { price?: number; bundleVersion?: 'V2' | 'V3' } = {}) {
  const fakeFetch: typeof fetch = async () => new Response(sellerPageHtml(shippingText, options), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  return fetchDirectPage(NAVER_SELLER_URL, fakeFetch);
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

function naverPortalHtml(withSeller: boolean): string {
  return `<!doctype html><html><head>
    <meta property="og:title" content="와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지" />
    <meta name="description" content="QWGE43UT1 43인치 UHD 4K + EKWBYME78W(V3)" />
  </head><body>${withSeller ? `<a href="${NAVER_SELLER_URL}" data-seller-name="11번가" data-price="365400">11번가 365,400원 무료배송</a>` : '판매처 정보 없음'}</body></html>`;
}

async function fetchHtmlPage(url: string, html: string): Promise<DirectPageResult> {
  const fakeFetch: typeof fetch = async () => new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  return fetchDirectPage(url, fakeFetch);
}

test('Naver comparison portal auto-extracts attributable downstream seller links', async () => {
  const page = await fetchHtmlPage(NAVER_PORTAL_URL, naverPortalHtml(true));
  assert.equal(page.sellerLinks?.length, 1);
  assert.equal(page.sellerLinks?.[0]?.url, NAVER_SELLER_URL);
  assert.equal(page.sellerLinks?.[0]?.sellerName, '11번가');
  assert.equal(page.sellerLinks?.[0]?.advertisedPrice, 365400);
  assert.equal(page.sellerLinks?.[0]?.advertisedShipping, 0);
});

test('Naver 365,400 search metadata remains discovery-only when no downstream seller is verified', async () => {
  const portalPage = await fetchHtmlPage(NAVER_PORTAL_URL, naverPortalHtml(false));
  const result = await runMarketProviderCoverage({
    providers: [naverShoppingProvider],
    target: { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', name: EXACT_QUERY, variant: '43인치' },
    canonicalIdentity: canonicalWideView(),
    constraints: [],
    publicSearch: async () => [{
      title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지 365,400원',
      url: NAVER_PORTAL_URL,
      snippet: '검색 노출가 365,400원',
    }],
    directPage: async () => portalPage,
    now: () => new Date('2026-08-27T00:00:00.000Z'),
  });

  const metadataOffer = result.offers.find((offer) => offer.verification === 'search_metadata');
  assert.equal(metadataOffer?.salePrice, 365400);
  assert.equal(metadataOffer?.eligible, false);
  assert.equal(result.offers.some((offer) => offer.verification === 'page_verified' && offer.eligible), false);
});

test('Naver downstream exact V3 seller can be decisive only after seller page verification', async () => {
  const portalPage = await fetchHtmlPage(NAVER_PORTAL_URL, naverPortalHtml(true));
  const sellerPage = await fetchSellerShipping('배송비 무료배송', { price: 365400, bundleVersion: 'V3' });
  const result = await runMarketProviderCoverage({
    providers: [naverShoppingProvider],
    target: { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', name: EXACT_QUERY, variant: '43인치' },
    canonicalIdentity: canonicalWideView(),
    constraints: [],
    publicSearch: async () => [{
      title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지 365,400원',
      url: NAVER_PORTAL_URL,
      snippet: '검색 노출가 365,400원',
    }],
    directPage: async (url) => url === NAVER_PORTAL_URL ? portalPage : sellerPage,
    now: () => new Date('2026-08-27T00:00:00.000Z'),
  });

  const verified = result.offers.find((offer) => offer.verification === 'page_verified');
  assert.equal(verified?.url, NAVER_SELLER_URL);
  assert.equal(verified?.salePrice, 365400);
  assert.equal(verified?.shippingFee, 0);
  assert.equal(verified?.identityVerdict, 'exact');
  assert.equal(verified?.eligible, true);
});

test('wrong V2 downstream seller is rejected even when price and shipping are attractive', async () => {
  const page = await fetchSellerShipping('배송비 무료배송', { price: 299000, bundleVersion: 'V2' });
  const offer = verifiedSellerOfferFromPage({
    page,
    target: { kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', name: EXACT_QUERY, variant: '43인치' },
    canonicalIdentity: canonicalWideView(),
    constraints: [],
    retrievedAt: '2026-08-27T00:00:00.000Z',
    discoveredBy: ['naver-shopping'],
    sellerName: '잘못된 V2 판매자',
  });

  assert.ok(offer);
  assert.equal(offer?.eligible, false);
  assert.notEqual(offer?.identityVerdict, 'exact');
  assert.ok(offer?.exclusionReasons.some((reason) => reason.startsWith('identity:')));
});
