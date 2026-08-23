import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPersonalizedRelayResult } from '../src/relay/merge.ts';
import type { ResearchJob } from '../src/core/types.ts';

function baseJob(): ResearchJob {
  return {
    id: 'job-1',
    status: 'running',
    request: { question: '어때?', url: 'https://brand.naver.com/mildo/products/7322162980', includeLocalRelay: true, category: 'product' },
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:01.000Z',
    target: { kind: 'product', brand: 'mildo', productId: '7322162980', canonicalUrl: 'https://brand.naver.com/mildo/products/7322162980' },
    sourceResults: [],
    evidence: [
      {
        claim: '공개 판매 페이지', sourceUrl: 'https://example.com/product', sourceType: 'retailer', retrievedAt: '2026-08-17T00:00:01.000Z',
        acquisitionMethod: 'search_metadata', evidenceClass: 'retailer_listing', independenceKey: 'public-1', confidence: 0.6, specificity: 'exact_product',
      },
      {
        claim: '장기 사용 후기', sourceUrl: 'https://example.com/review', sourceType: 'review', retrievedAt: '2026-08-17T00:00:01.000Z',
        acquisitionMethod: 'search_metadata', evidenceClass: 'community_report', independenceKey: 'public-2', confidence: 0.6, specificity: 'exact_product', data: { sentiment: 0.5 },
      },
    ],
    relay: { available: true, used: false, mode: 'public_only', message: 'waiting' },
    errors: [],
  };
}

test('applyPersonalizedRelayResult merges only normalized price and delivery fields and rebuilds report', () => {
  const merged = applyPersonalizedRelayResult(baseJob(), {
    title: '밀도 원목 수납침대 K',
    membershipPrice: 419000,
    couponPrice: 429000,
    estimatedPoints: 12000,
    shippingEta: '2026-08-20',
  }, '2026-08-17T00:00:10.000Z');

  assert.equal(merged.status, 'completed');
  assert.equal(merged.relay.used, true);
  assert.equal(merged.relay.mode, 'local_authenticated');
  assert.equal(merged.target.name, '밀도 원목 수납침대 K');
  assert.equal(merged.report?.personalizedPrice?.membershipPrice, 419000);
  assert.equal(merged.report?.personalizedPrice?.estimatedPoints, 12000);
  assert.equal(merged.report?.personalizedPrice?.shippingEta, '2026-08-20');
  assert.ok((merged.report?.confidenceDimensions.identity ?? 0) >= 0.9);
  assert.ok(merged.evidence.some((item) => item.acquisitionMethod === 'local_relay'));
});

test('Naver live deal fields survive relay merge as explicit payment and effective-price economics', () => {
  const job = baseJob();
  job.request = {
    question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 지금 사도 돼?',
    url: 'https://view.shoppinglive.naver.com/lives/1985890',
    includeLocalRelay: true,
    category: 'product',
  };
  job.target = {
    kind: 'product',
    brand: '와이드뷰',
    name: '와이드뷰 QWGE43UT1 이동형 패키지 V3',
    model: 'qwge43ut1',
    variant: '43인치 V3',
    liveId: '1985890',
    canonicalUrl: 'https://view.shoppinglive.naver.com/lives/1985890',
  };
  job.researchContext = {
    identityConfidence: 0.95,
    resolvedTarget: { ...job.target },
    resolutionAmbiguous: false,
  };

  const merged = applyPersonalizedRelayResult(job, {
    listPrice: 720000,
    sellerInstantDiscount: 221000,
    couponDiscount: 59880,
    cardInstantDiscount: 21960,
    couponPrice: 439120,
    cashPaymentPrice: 417160,
    salePrice: 417160,
    totalExpectedPoints: 64200,
    estimatedPoints: 64200,
    effectivePrice: 352960,
    shippingFee: 0,
    dealType: 'naver_shopping_live',
    liveId: '1985890',
  }, '2026-08-23T10:00:00.000Z');

  const price = merged.report?.personalizedPrice;
  assert.equal(price?.listPrice, 720000);
  assert.equal(price?.sellerInstantDiscount, 221000);
  assert.equal(price?.couponDiscount, 59880);
  assert.equal(price?.cardInstantDiscount, 21960);
  assert.equal(price?.cashPaymentPrice, 417160);
  assert.equal(price?.salePrice, 417160);
  assert.equal(price?.totalExpectedPoints, 64200);
  assert.equal(price?.estimatedPoints, 64200);
  assert.equal(price?.effectivePrice, 352960);
  assert.equal(price?.shippingFee, 0);
  assert.equal(price?.dealType, 'naver_shopping_live');
  assert.equal(price?.liveId, '1985890');
});

test('relay title can improve identity without fabricating personalized price coverage', () => {
  const merged = applyPersonalizedRelayResult(baseJob(), {
    title: '밀도 원목 수납침대 K',
    currency: 'KRW',
  }, '2026-08-17T00:00:10.000Z');

  assert.equal(merged.target.name, '밀도 원목 수납침대 K');
  assert.equal(merged.report?.confidenceDimensions.personalizedPrice, 0);
  assert.equal(merged.report?.personalizedPrice?.salePrice, undefined);
});

test('an inconsistent relay title does not overwrite an already resolved product identity', () => {
  const job = baseJob();
  job.target = {
    ...job.target,
    brand: '와이드뷰',
    name: '와이드뷰 43인치 4K V3 스탠드',
    model: 'V3',
    variant: '43인치',
  };
  job.researchContext = {
    identityConfidence: 0.94,
    resolvedTarget: { ...job.target },
  };

  const merged = applyPersonalizedRelayResult(job, {
    title: '네이버 로그인',
    price: 439000,
  }, '2026-08-17T00:00:10.000Z');

  assert.equal(merged.target.name, '와이드뷰 43인치 4K V3 스탠드');
  assert.match(merged.relay.message ?? '', /title|identity|상품명|제품/i);
});

test('applyPersonalizedRelayResult rejects secret-bearing connector payloads', () => {
  assert.throws(() => applyPersonalizedRelayResult(baseJob(), {
    membershipPrice: 419000,
    cookie: 'must-never-survive',
  }, '2026-08-17T00:00:10.000Z'), /secret-bearing/i);
});

test('applyPersonalizedRelayResult preserves partial status when public-source errors already exist', () => {
  const job = baseJob();
  job.errors.push('naver-cafe: blocked');
  const merged = applyPersonalizedRelayResult(job, { price: 439000 }, '2026-08-17T00:00:10.000Z');
  assert.equal(merged.status, 'partial');
});
