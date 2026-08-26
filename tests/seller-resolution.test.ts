import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractEmbeddedSellerRecords,
  resolveSellerCandidatesFromPage,
} from '../src/providers/seller-resolution.ts';

test('extracts a deterministic seller URL and price from embedded JSON when no anchor exists', () => {
  const html = `
    <script type="application/json">
      {"mallList":[{"sellerName":"Shop A","sellerUrl":"https://shop.example.com/product/1","productId":"1","price":389000,"shippingFee":20000}]}
    </script>
  `;

  assert.deepEqual(
    extractEmbeddedSellerRecords(html, new URL('https://prod.danawa.com/info?pcode=1')),
    [{
      url: 'https://shop.example.com/product/1',
      sellerName: 'Shop A',
      productId: '1',
      advertisedPrice: 389000,
      advertisedShipping: 20000,
    }],
  );
});

test('extracts explicit data attributes but ignores malformed JSON and non-http seller targets', () => {
  const html = `
    <script type="application/json">{bad json}</script>
    <div data-seller-url="javascript:alert(1)" data-seller-name="Bad"></div>
    <div data-seller-url="https://shop.example.com/product/2" data-seller-name="Shop B" data-product-id="2" data-price="399000" data-shipping="0"></div>
  `;

  assert.deepEqual(
    extractEmbeddedSellerRecords(html, new URL('https://prod.danawa.com/info?pcode=2')),
    [{
      url: 'https://shop.example.com/product/2',
      sellerName: 'Shop B',
      productId: '2',
      advertisedPrice: 399000,
      advertisedShipping: 0,
    }],
  );
});

test('normalizes, bounds, and prioritizes direct embedded seller targets over a static bridge for the same seller product', () => {
  const candidates = resolveSellerCandidatesFromPage({
    providerId: 'danawa',
    comparisonUrl: 'https://prod.danawa.com/info?pcode=1',
    staticLinks: [{
      url: 'https://prod.danawa.com/bridge?id=1',
      sellerName: 'Shop A',
      productId: '1',
      advertisedPrice: 399000,
    }],
    embeddedRecords: [{
      url: 'https://shop.example.com/product/1',
      sellerName: 'Shop A',
      productId: '1',
      advertisedPrice: 389000,
    }],
    limit: 1,
    retrievedAt: '2026-08-27T00:00:00.000Z',
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.sellerUrl, 'https://shop.example.com/product/1');
  assert.equal(candidates[0]?.resolutionMethod, 'embedded_metadata');
  assert.equal(candidates[0]?.sellerProductId, '1');
  assert.equal(candidates[0]?.verificationTrace?.comparisonAdvertisedPrice, 389000);
});

test('keeps distinct seller products while deduplicating repeated canonical URLs', () => {
  const candidates = resolveSellerCandidatesFromPage({
    providerId: 'enuri',
    comparisonUrl: 'https://www.enuri.com/detail.jsp?modelno=1',
    staticLinks: [
      { url: 'https://shop.example.com/product/1?utm_source=enuri', productId: '1' },
      { url: 'https://shop.example.com/product/1', productId: '1' },
      { url: 'https://shop.example.com/product/2', productId: '2' },
    ],
    embeddedRecords: [],
    limit: 5,
    retrievedAt: '2026-08-27T00:00:00.000Z',
  });

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((item) => item.sellerProductId), ['1', '2']);
  assert.ok(candidates.every((item) => item.resolutionMethod === 'static_link'));
});
