import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProduct } from '../src/orchestrator/product-resolver.ts';

test('resolves a query-only product when independent results agree on brand model and size', async () => {
  const result = await resolveProduct({
    question: '와이드뷰 43인치 4K V3 스탠드 어때?',
    category: 'product',
  }, {
    publicSearch: async () => [
      {
        title: '와이드뷰 43인치 4K V3 이동식 스마트TV 스탠드',
        url: 'https://brand.naver.com/widevu/products/11458011168',
        snippet: '와이드뷰 V3 43인치 UHD 4K 스탠드',
      },
      {
        title: '와이드뷰 V3 43인치 UHD 4K 이동식 TV 후기',
        url: 'https://blog.naver.com/reviewer/223000000000',
        snippet: '와이드뷰 V3 43인치 실사용 후기',
      },
      {
        title: '삼성 M7 43인치 스마트모니터',
        url: 'https://example.com/samsung-m7',
        snippet: '43인치 4K 스마트모니터',
      },
    ],
  });

  assert.equal(result.ambiguous, false);
  assert.ok(result.confidence >= 0.7);
  assert.equal(result.target.kind, 'product');
  assert.match(result.target.name ?? '', /와이드뷰.*V3|V3.*와이드뷰/i);
  assert.equal(result.target.model?.toUpperCase(), 'V3');
  assert.match(result.target.variant ?? '', /43/);
  assert.ok(result.target.canonicalUrl);
});

test('refuses to resolve when top candidates are too close', async () => {
  const result = await resolveProduct({
    question: '43인치 4K 스마트모니터 어때?',
    category: 'product',
  }, {
    publicSearch: async () => [
      { title: '삼성 M7 43인치 4K 스마트모니터', url: 'https://example.com/m7', snippet: '43인치 4K' },
      { title: 'LG MyView 43인치 4K 스마트모니터', url: 'https://example.com/myview', snippet: '43인치 4K' },
    ],
  });

  assert.equal(result.ambiguous, true);
  assert.equal(result.target.kind, 'unknown');
  assert.ok(result.candidates.length >= 2);
});
