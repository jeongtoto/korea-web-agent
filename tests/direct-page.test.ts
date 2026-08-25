import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDirectPage } from '../src/providers/direct-page.ts';

const fixture = `<!doctype html>
<html><head>
<title>Fallback title</title>
<meta property="og:title" content="밀도 원목 수납침대 K" />
<meta name="description" content="원목 프레임과 수납 서랍이 있는 침대" />
<meta property="og:site_name" content="Mildo" />
<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":"Product",
  "name":"밀도 원목 수납침대 K",
  "description":"서랍형 소파형 프레임",
  "brand":{"@type":"Brand","name":"밀도"},
  "sku":"BED-K-01",
  "model":"BED-K-01",
  "additionalProperty":[
    {"@type":"PropertyValue","name":"프레임 폭","value":"1700 mm"},
    {"@type":"PropertyValue","name":"프레임 길이","value":"2075 mm"},
    {"@type":"PropertyValue","name":"서랍 수납","value":"있음"},
    {"@type":"PropertyValue","name":"헤드보드","value":"소파형"}
  ],
  "offers":{
    "@type":"Offer",
    "price":"439000",
    "priceCurrency":"KRW",
    "availability":"https://schema.org/InStock",
    "shippingDetails":{"@type":"OfferShippingDetails","shippingRate":{"@type":"MonetaryAmount","value":"0","currency":"KRW"}}
  }
}
</script>
</head><body><h1>Product</h1></body></html>`;

test('fetchDirectPage extracts OpenGraph metadata and Product JSON-LD as attributed evidence', async () => {
  const fakeFetch: typeof fetch = async () => new Response(fixture, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

  const result = await fetchDirectPage('https://brand.naver.com/mildo/products/7322162980', fakeFetch);
  assert.equal(result.title, '밀도 원목 수납침대 K');
  assert.equal(result.description, '원목 프레임과 수납 서랍이 있는 침대');
  assert.equal(result.siteName, 'Mildo');
  assert.equal(result.product?.name, '밀도 원목 수납침대 K');
  assert.equal(result.product?.brand, '밀도');
  assert.equal(result.product?.sku, 'BED-K-01');
  assert.equal(result.product?.offers?.price, 439000);
  assert.equal(result.product?.offers?.currency, 'KRW');
  assert.equal(result.product?.offers?.shippingFee, 0);
  assert.equal(result.facts?.model, 'BED-K-01');
  assert.equal(result.facts?.attributes?.supportedWidthMm, 1700);
  assert.equal(result.facts?.attributes?.supportedLengthMm, 2075);
  assert.equal(result.facts?.attributes?.drawerStorage, true);
  assert.equal(result.facts?.attributes?.headboardStyle, 'sofa');
  assert.ok(result.evidence.some((e) => e.evidenceClass === 'retailer_listing' && e.sourceUrl.includes('brand.naver.com')));
  assert.ok(result.evidence.every((e) => e.acquisitionMethod === 'structured_data' || e.acquisitionMethod === 'static_html'));
});

test('fetchDirectPage rejects oversized HTML before parsing', async () => {
  const fakeFetch: typeof fetch = async () => new Response('x', {
    status: 200,
    headers: { 'content-length': String(3_000_000), 'content-type': 'text/html' },
  });
  await assert.rejects(
    fetchDirectPage('https://example.com/product', fakeFetch),
    /too large/i,
  );
});
