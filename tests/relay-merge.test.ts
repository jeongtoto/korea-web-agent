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

test('Naver live visible commercial title can confirm a resolved model whose codes are not rendered', () => {
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
    name: '와이드무빙뷰 QWGE43UT1 이동형 패키지',
    model: 'QWGE43UT1',
    variant: 'EKWBYME78W(V3) 43인치 UHD 4K',
    liveId: '1985890',
    canonicalUrl: 'https://view.shoppinglive.naver.com/lives/1985890',
  };
  job.researchContext = {
    identityConfidence: 0.95,
    resolvedTarget: { ...job.target },
    resolutionAmbiguous: false,
  };

  const merged = applyPersonalizedRelayResult(job, {
    title: '와이드무빙뷰 화이트에디션 삼탠바이미V3 셋트 QLED 109cm(43인치) UHD 4K 스마트 이동식 TV 유압식 높이조절 중소바이미 자가설치 720,000원 30% 할인 499,000원 네이버 배송 무료배송',
    listPrice: 720000,
    salePrice: 499000,
    totalExpectedPoints: 106650,
    shippingFee: 0,
    dealType: 'naver_shopping_live',
    liveId: '1985890',
  }, '2026-08-23T10:00:00.000Z');

  assert.equal(merged.status, 'completed');
  assert.equal(merged.report?.personalizedPrice?.salePrice, 499000);
  assert.equal(merged.report?.personalizedPrice?.totalExpectedPoints, 106650);
  assert.equal(merged.target.name?.includes('109cm(43인치)'), true);
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

test('batch relay merges verified KREAM card and Naver points offers into separate winners', () => {
  const job = baseJob();
  job.request.purchaseContext = { ownedCards: ['삼성카드'] };
  job.target = {
    kind: 'product', brand: '와이드뷰', model: 'QWGE43UT1', variant: '43인치',
    name: '와이드뷰 QWGE43UT1 EKWBYME78W V3 43인치 이동형 패키지',
  };
  job.researchContext = { identityConfidence: 0.95, resolvedTarget: { ...job.target } };

  const merged = applyPersonalizedRelayResult(job, { offers: [
    {
      market: 'KREAM', url: 'https://kream.co.kr/products/1', title: `${job.target.name} 신품`,
      price: 407200, cardPrice: 390000, cardName: '삼성카드', shippingFee: 0,
      condition: 'new', bundleComplete: true, conditions: ['삼성카드 결제 조건'], riskFlags: [],
    },
    {
      market: '네이버', url: 'https://brand.naver.com/widevu/products/1', title: `${job.target.name} 신품`,
      price: 499000, estimatedPoints: 106650, shippingFee: 0,
      condition: 'new', bundleComplete: true, conditions: [], riskFlags: ['적립 조건 확인'],
    },
  ] }, '2026-08-24T10:00:00.000Z');

  assert.equal(merged.report?.offers?.length, 2);
  assert.equal(merged.report?.bestOffers?.cash?.amount, 407200);
  assert.equal(merged.report?.bestOffers?.ownedCard?.amount, 390000);
  assert.equal(merged.report?.bestOffers?.effective?.amount, 392350);
  assert.match(merged.relay.message ?? '', /2 authenticated/i);
});

test('batch relay verifies distinct recommendation candidates against their own signed identity hints', () => {
  const job = baseJob();
  const candidates = ['브랜드A 순면 퀸 이불', '브랜드B 모달 퀸 이불', '브랜드C 워싱 퀸 이불'].map((title, index) => ({
    title,
    score: 0.85 - index * 0.02,
    sourceUrls: [`https://brand.naver.com/bedding/products/${index + 1}`],
    target: { kind: 'product' as const, name: title, brand: title.split(' ')[0] },
  }));
  job.target = { ...candidates[0]!.target };
  job.request.question = '레드 침대에 어울리는 퀸 이불 Best 3 추천';
  job.researchContext = { identityConfidence: 0.8, resolvedTarget: { ...job.target }, recommendationMode: true, recommendationCandidates: candidates };

  const merged = applyPersonalizedRelayResult(job, { offers: candidates.map((candidate, index) => ({
    market: '네이버',
    url: candidate.sourceUrls[0],
    targetHint: { name: candidate.title, brand: candidate.target.brand },
    title: `${candidate.title} 세탁가능 리뷰 4.${8 - index}`,
    price: 120000 + index * 10000,
    shippingFee: 0,
    condition: 'new',
    bundleComplete: true,
  })) }, '2026-08-24T11:00:00.000Z');

  assert.equal(merged.report?.offers?.filter((offer) => offer.eligible).length, 3);
  assert.equal(merged.report?.recommendations?.length, 3);
  assert.ok(merged.report?.recommendations?.every((recommendation) => recommendation.bestOffer));
});
