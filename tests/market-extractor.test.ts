import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDirectPage } from '../src/providers/direct-page.ts';
import type { MarketPageExtractor } from '../src/providers/market-extractor.ts';

const html = `<!doctype html><html><head>
<title>Generic title</title>
<script type="application/ld+json">{
  "@context":"https://schema.org",
  "@type":"Product",
  "name":"Generic product",
  "sku":"GEN-1",
  "offers":{"price":"499000","priceCurrency":"KRW","shippingDetails":{"shippingRate":{"value":"3000"}}}
}</script>
</head><body>market page</body></html>`;

const extractor: MarketPageExtractor = {
  id: 'example-market',
  matches: (url) => url.hostname === 'shop.example.com',
  extract: ({ url, retrievedAt }) => ({
    product: {
      name: 'Verified market product',
      model: 'MODEL-V3',
      offers: { price: 449000, currency: 'KRW' },
    },
    facts: { shippingFee: 0, availability: 'InStock' },
    sellerLinks: [{ url: 'https://seller.example.net/items/1', sellerName: 'Seller A', productId: '1', advertisedPrice: 449000 }],
    promotion: { type: 'time_deal', active: true, startsAt: retrievedAt },
    sellerInfo: { name: 'Seller A', productId: '1', canonicalUrl: url.toString() },
  }),
};

test('matching market extractor overrides only verified fields and generic parser fills missing fields', async () => {
  const fakeFetch: typeof fetch = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  const result = await fetchDirectPage('https://shop.example.com/products/1', fakeFetch, extractor);

  assert.equal(result.product?.name, 'Verified market product');
  assert.equal(result.product?.model, 'MODEL-V3');
  assert.equal(result.product?.sku, 'GEN-1');
  assert.equal(result.product?.offers?.price, 449000);
  assert.equal(result.product?.offers?.currency, 'KRW');
  assert.equal(result.product?.offers?.shippingFee, 3000);
  assert.equal(result.facts?.shippingFee, 0);
  assert.equal(result.facts?.availability, 'InStock');
  assert.equal(result.sellerLinks?.[0]?.sellerName, 'Seller A');
  assert.equal(result.promotion?.type, 'time_deal');
  assert.equal(result.sellerInfo?.productId, '1');
  assert.equal('html' in (result as any), false);
});

test('non-matching extractor leaves generic direct-page extraction unchanged', async () => {
  const fakeFetch: typeof fetch = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  const result = await fetchDirectPage('https://other.example.com/products/1', fakeFetch, extractor);
  assert.equal(result.product?.name, 'Generic product');
  assert.equal(result.product?.offers?.price, 499000);
  assert.equal(result.product?.offers?.shippingFee, 3000);
  assert.equal(result.sellerLinks, undefined);
});

test('extractor never runs before safe redirect validation', async () => {
  let extractorCalls = 0;
  const guardedExtractor: MarketPageExtractor = {
    id: 'guarded',
    matches: () => true,
    extract: () => {
      extractorCalls += 1;
      return {};
    },
  };
  const fakeFetch: typeof fetch = async () => new Response(null, {
    status: 302,
    headers: { location: 'http://127.0.0.1/private' },
  });

  await assert.rejects(fetchDirectPage('https://shop.example.com/products/1', fakeFetch, guardedExtractor), /private|local/i);
  assert.equal(extractorCalls, 0);
});
