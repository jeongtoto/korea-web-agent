import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveExplicitSearchSignals } from '../src/core/search-signals.ts';
import type { NormalizedTarget } from '../src/core/types.ts';

const target: NormalizedTarget = {
  kind: 'product',
  brand: '와이드뷰',
  name: '와이드뷰 43인치 4K V3 스탠드',
  model: 'V3',
  variant: '43인치',
};

test('retailer signal ignores reward points and extracts the actual sale price', () => {
  const data = deriveExplicitSearchSignals({
    title: '와이드뷰 V3 43인치 특가',
    url: 'https://shop.example/wideview-v3',
    snippet: '12,000원 적립 혜택 / 현재 판매가 439,000원 할인 특가',
  }, 'retailer_listing', target);

  assert.equal(((data.product as any)?.offers?.price), 439000);
  assert.ok((data.priceSignal as number) > 0);
});

test('shipping fee is not mistaken for a product price', () => {
  const data = deriveExplicitSearchSignals({
    title: '와이드뷰 V3 43인치 판매',
    url: 'https://shop.example/wideview-v3',
    snippet: '배송비 3,000원 / 판매가 439,000원',
  }, 'retailer_listing', target);

  assert.equal(((data.product as any)?.offers?.price), 439000);
});
