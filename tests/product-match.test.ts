import test from 'node:test';
import assert from 'node:assert/strict';
import { matchEvidenceToProduct } from '../src/core/product-match.ts';
import type { NormalizedTarget } from '../src/core/types.ts';

const target: NormalizedTarget = {
  kind: 'product',
  brand: '와이드뷰',
  name: '와이드뷰 43인치 4K V3 스탠드',
  model: 'V3',
  variant: '43인치',
};

test('matches brand model and size agreement as exact product evidence', () => {
  const result = matchEvidenceToProduct(target, {
    title: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드',
    url: 'https://example.com/wideview-v3-43',
    snippet: '와이드뷰 V3 43인치 UHD 4K 제품',
  });
  assert.equal(result.level, 'exact_product');
  assert.ok(result.score >= 0.8);
});

test('rejects generic KC certification pages as unrelated to an exact product', () => {
  const result = matchEvidenceToProduct(target, {
    title: 'KCL 안전인증 KC 생활용품',
    url: 'https://www.kcl.re.kr/kc',
    snippet: '제품의 안전성 시험검사와 KC 인증 업무를 수행합니다.',
  });
  assert.equal(result.level, 'unrelated');
  assert.ok(result.score < 0.3);
});

test('product id in a matching commerce URL is exact identity evidence', () => {
  const result = matchEvidenceToProduct({
    kind: 'product',
    productId: '11458011168',
    canonicalUrl: 'https://product.shoppinglive.naver.com/products/11458011168',
  }, {
    title: '네이버 쇼핑라이브 상품',
    url: 'https://product.shoppinglive.naver.com/products/11458011168?foo=bar',
    snippet: '',
  });
  assert.equal(result.level, 'exact_product');
  assert.equal(result.score, 1);
});
