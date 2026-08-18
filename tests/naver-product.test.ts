import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNaverProductUrl } from '../src/adapters/naver-product.ts';

test('parses Naver Brand Store product URL and strips tracking query', () => {
  const target = parseNaverProductUrl('https://brand.naver.com/mildo/products/7322162980?n_media=27758&n_query=%EC%B9%A8%EB%8C%80');
  assert.equal(target?.kind, 'product');
  assert.equal(target?.brand, 'mildo');
  assert.equal(target?.productId, '7322162980');
  assert.equal(target?.sourceHost, 'brand.naver.com');
  assert.equal(target?.canonicalUrl, 'https://brand.naver.com/mildo/products/7322162980');
});

test('parses SmartStore product URL', () => {
  const target = parseNaverProductUrl('https://smartstore.naver.com/sample_store/products/123456789');
  assert.equal(target?.brand, 'sample_store');
  assert.equal(target?.productId, '123456789');
});

test('parses Naver Shopping Live product URL without fabricating a brand', () => {
  const target = parseNaverProductUrl('https://product.shoppinglive.naver.com/products/11458011168?prdFrom=x&NaPm=y');
  assert.equal(target?.kind, 'product');
  assert.equal(target?.productId, '11458011168');
  assert.equal(target?.sourceHost, 'product.shoppinglive.naver.com');
  assert.equal(target?.brand, undefined);
  assert.equal(target?.canonicalUrl, 'https://product.shoppinglive.naver.com/products/11458011168');
});

test('returns null for a non-Naver product URL', () => {
  assert.equal(parseNaverProductUrl('https://example.com/products/123'), null);
});
