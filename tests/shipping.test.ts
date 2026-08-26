import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotalCashPrice, resolveShippingCost } from '../src/providers/shipping.ts';
import type { ShippingQuote } from '../src/core/types.ts';

function quote(overrides: Partial<ShippingQuote> = {}): ShippingQuote {
  return { status: 'free', verification: 'page_verified', ...overrides };
}

test('free shipping resolves to zero', () => {
  assert.equal(resolveShippingCost(quote(), 399000), 0);
});

test('paid shipping resolves a deterministic base fee', () => {
  assert.equal(resolveShippingCost(quote({ status: 'paid', baseFee: 3000 }), 399000), 3000);
});

test('conditional free shipping resolves only when item price meets the threshold', () => {
  const shipping = quote({ status: 'conditional_free', threshold: 300000, baseFee: 3000 });
  assert.equal(resolveShippingCost(shipping, 399000), 0);
  assert.equal(resolveShippingCost(shipping, 299000), 3000);
});

test('unknown or incomplete shipping never defaults to zero', () => {
  assert.equal(resolveShippingCost(quote({ status: 'unknown' }), 399000), undefined);
  assert.equal(resolveShippingCost(quote({ status: 'paid', baseFee: undefined }), 399000), undefined);
  assert.equal(resolveShippingCost(quote({ status: 'conditional_free', threshold: undefined }), 399000), undefined);
});

test('total cash includes shipping and every deterministic mandatory fee', () => {
  assert.equal(calculateTotalCashPrice({
    salePrice: 399000,
    shipping: quote({ status: 'paid', baseFee: 3000 }),
    mandatoryFees: [10000, 2000],
  }), 414000);
});

test('total cash stays unresolved when shipping or a mandatory fee is unresolved', () => {
  assert.equal(calculateTotalCashPrice({ salePrice: 399000, shipping: quote({ status: 'unknown' }) }), undefined);
  assert.equal(calculateTotalCashPrice({ salePrice: 399000, shipping: quote(), mandatoryFees: [Number.NaN] }), undefined);
});
