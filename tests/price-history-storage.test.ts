import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Netlify price-history persistence is exact-product cash-only and excludes purchase context', () => {
  const source = readFileSync('netlify/functions/_lib/price-history.mjs', 'utf8');
  assert.match(source, /researchMode\s*!==\s*['"]exact_product['"]/);
  assert.match(source, /bestOffers\?\.cash\?\.amount/);
  assert.doesNotMatch(source, /ownedCard\?\.amount/);
  assert.doesNotMatch(source, /advertisedPayment\?\.amount/);
  assert.doesNotMatch(source, /effective\?\.amount/);
  assert.doesNotMatch(source, /purchaseContext/);
});

test('history key requires a stable model or product id instead of free-form product name', () => {
  const source = readFileSync('netlify/functions/_lib/price-history.mjs', 'utf8');
  assert.match(source, /!product\.model\s*&&\s*!product\.productId/);
  const keyBuilder = source.slice(source.indexOf('function productKey'), source.indexOf('function comparablePrice'));
  assert.doesNotMatch(keyBuilder, /product\.name/);
});
