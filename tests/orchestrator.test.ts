import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearch, type ResearchDependencies } from '../src/orchestrator/research.ts';
import type { DirectPageResult } from '../src/providers/direct-page.ts';

const url = 'https://brand.naver.com/mildo/products/7322162980';

function directResult(): DirectPageResult {
  return {
    url,
    title: '밀도 원목 수납침대 K',
    product: { name: '밀도 원목 수납침대 K', brand: '밀도', offers: { price: 439000, currency: 'KRW' } },
    evidence: [
      {
        claim: '상품명: 밀도 원목 수납침대 K / 가격: 439000 KRW',
        sourceUrl: url,
        sourceType: 'json_ld_product',
        retrievedAt: '2026-08-17T00:00:00.000Z',
        acquisitionMethod: 'structured_data',
        evidenceClass: 'retailer_listing',
        independenceKey: 'naver-product',
        confidence: 0.78,
        specificity: 'exact_product',
        data: { product: { name: '밀도 원목 수납침대 K', brand: '밀도', offers: { price: 439000, currency: 'KRW' } } },
      },
    ],
  };
}

function deps(overrides: Partial<ResearchDependencies> = {}): ResearchDependencies {
  return {
    directPage: async () => directResult(),
    publicSearch: async () => [
      { title: '밀도 원목 수납침대 K 1년 사용 후기', url: 'https://example.com/review/7322162980', snippet: '밀도 원목 수납침대 K 7322162980 프레임이 안정적이라는 장기 후기' },
      { title: '밀도 원목 수납침대 K 조립 후기', url: 'https://www.youtube.com/watch?v=7322162980', snippet: '밀도 원목 수납침대 K 7322162980 조립성과 소음 확인' },
    ],
    relayClient: null,
    now: () => new Date('2026-08-17T00:00:00.000Z'),
    idFactory: () => 'job-fixed',
    ...overrides,
  };
}

test('orchestrator combines direct URL evidence with related public search and identifies Naver product', async () => {
  const job = await runResearch({ question: '이 침대 어때?', url }, deps());
  assert.equal(job.id, 'job-fixed');
  assert.equal(job.target.kind, 'product');
  assert.equal(job.target.productId, '7322162980');
  assert.equal(job.target.name, '밀도 원목 수납침대 K');
  assert.ok(job.evidence.length >= 3);
  assert.ok(job.sourceResults.some((source) => source.source === 'direct_page' && source.success));
  assert.ok(job.sourceResults.some((source) => source.source === 'public_search' && source.success));
  assert.equal(job.status, 'completed');
  assert.ok(job.report);
});

test('provider failure degrades to a partial result instead of discarding successful evidence', async () => {
  const job = await runResearch({ question: '어때?', url }, deps({
    directPage: async () => { throw new Error('blocked'); },
    publicSearch: async () => [{ title: '밀도 원목 수납침대 K 7322162980 사용 후기', url: 'https://example.com/review/7322162980', snippet: '상품 7322162980 장기 사용 후기' }],
  }));
  assert.equal(job.status, 'partial');
  assert.ok(job.evidence.length >= 1);
  assert.ok(job.errors.some((error) => /blocked/i.test(error)));
});

test('relay-offline mode keeps public research usable and marks personalization unavailable', async () => {
  const job = await runResearch({ question: '내 가격까지 봐줘', url, includeLocalRelay: true }, deps({
    relayClient: {
      isAvailable: async () => false,
      extract: async () => { throw new Error('should not run'); },
    },
  }));
  assert.equal(job.relay.available, false);
  assert.equal(job.relay.used, false);
  assert.equal(job.relay.mode, 'public_only');
  assert.ok(job.report);
});

test('online relay merges only normalized personalized price fields into the report', async () => {
  const job = await runResearch({ question: '내 쿠폰가 포함해서 어때?', url, includeLocalRelay: true }, deps({
    relayClient: {
      isAvailable: async () => true,
      extract: async () => ({
        currency: 'KRW',
        membershipPrice: 419000,
        estimatedPoints: 12000,
        shippingEta: '2026-08-20',
      }),
    },
  }));
  assert.equal(job.relay.mode, 'local_authenticated');
  assert.equal(job.relay.used, true);
  assert.equal(job.report?.personalizedPrice?.membershipPrice, 419000);
  assert.equal(job.report?.personalizedPrice?.shippingEta, '2026-08-20');
});

test('generic KC pages are not promoted to exact-product evidence by a product-shaped search query', async () => {
  const job = await runResearch({ question: '이 침대 어때?', url }, deps({
    publicSearch: async () => [{
      title: 'KCL 안전인증 KC 생활용품',
      url: 'https://www.kcl.re.kr/kc',
      snippet: '제품의 안전성 시험검사와 KC 인증 업무를 수행합니다.',
    }],
  }));

  assert.equal(job.evidence.some((item) => item.sourceUrl === 'https://www.kcl.re.kr/kc' && item.specificity === 'exact_product'), false);
});

test('exact-product snippets structure only explicit review sentiment, current price, and price-value wording', async () => {
  const job = await runResearch({ question: '이 침대 지금 가격이면 살만해?', url }, deps({
    publicSearch: async (query) => {
      if (query.includes('site:blog.naver.com')) return [{
        title: '밀도 원목 수납침대 K 7322162980 장기 사용 만족 추천',
        url: 'https://blog.naver.com/reviewer/positive-7322162980',
        snippet: '1년 사용 후에도 튼튼하고 안정적이라 만족한다는 후기',
      }];
      if (query.includes('site:danawa.com')) return [{
        title: '밀도 원목 수납침대 K 7322162980 399,000원 특가',
        url: 'https://prod.danawa.com/7322162980',
        snippet: '현재 399,000원 할인 특가 가격',
      }];
      return [];
    },
  }));

  const review = job.evidence.find((item) => item.sourceUrl.includes('positive-7322162980'));
  const price = job.evidence.find((item) => item.sourceUrl.includes('danawa.com'));
  assert.ok((review?.data?.sentiment as number | undefined) !== undefined);
  assert.ok((review?.data?.sentiment as number) > 0.3);
  assert.equal(((price?.data?.product as any)?.offers?.price), 399000);
  assert.ok((price?.data?.priceSignal as number) > 0);
});

test('orchestrator executes bounded source-specific searches instead of a single generic search', async () => {
  const queries: string[] = [];
  const job = await runResearch({ question: '이 침대 어때? 논문까지 확인해줘', url }, deps({
    publicSearch: async (query) => {
      queries.push(query);
      return [{ title: `밀도 원목 수납침대 K 7322162980 결과 ${queries.length}`, url: `https://example.com/7322162980/${queries.length}`, snippet: '밀도 원목 수납침대 K 7322162980 근거 요약' }];
    },
  }));

  assert.ok(queries.length >= 9);
  assert.ok(queries.length <= 14);
  assert.ok(queries.some((query) => query.includes('site:blog.naver.com')));
  assert.ok(queries.some((query) => query.includes('site:cafe.naver.com')));
  assert.ok(queries.some((query) => query.includes('site:coupang.com')));
  assert.ok(queries.some((query) => query.includes('site:danawa.com')));
  assert.ok(queries.some((query) => query.includes('site:youtube.com')));
  assert.ok(queries.some((query) => query.includes('site:pubmed.ncbi.nlm.nih.gov')));
  assert.ok(job.sourceResults.some((source) => source.source === 'naver-blog'));
  assert.ok(job.sourceResults.some((source) => source.source === 'academic'));
  assert.ok(job.evidence.some((item) => item.sourceType === 'academic' && item.evidenceClass === 'peer_reviewed_research'));
});

test('orchestrator adds dedicated Crossref-style academic evidence separately from exact-product search evidence', async () => {
  let academicCalls = 0;
  const academicDeps = deps({
    publicSearch: async () => [],
  }) as ResearchDependencies & { academicSearch: (query: string) => Promise<Array<{ title: string; url: string; snippet: string }>> };
  academicDeps.academicSearch = async (query) => {
    academicCalls += 1;
    assert.match(query, /sleep|침대|수면|ergonomics/i);
    return [{
      title: 'Sleep ergonomics systematic review',
      url: 'https://doi.org/10.1000/sleep',
      snippet: '2025 · peer-reviewed review',
    }];
  };

  const job = await runResearch({ question: '허리와 수면 관련 논문까지 확인해줘', url }, academicDeps);
  assert.equal(academicCalls, 1);
  assert.ok(job.sourceResults.some((source) => source.source === 'crossref' && source.success));
  assert.ok(job.evidence.some((item) =>
    item.sourceType === 'crossref' &&
    item.evidenceClass === 'peer_reviewed_research' &&
    item.specificity === 'general_mechanism'
  ));
});
