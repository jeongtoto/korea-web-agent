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

// This fixture mirrors the useful evidence available on a static Danawa comparison page:
// exact page title/model/bundle text, but no generic schema.org Product block.
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
