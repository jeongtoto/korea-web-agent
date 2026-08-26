import type {
  MarketProvider,
  MarketProviderDefinition,
  MarketProviderId,
  ProviderBudget,
} from './market-provider.ts';

function budget(
  discovery: number,
  verification: number,
  sellerExpansion = 0,
): Readonly<ProviderBudget> {
  return Object.freeze({ discovery, verification, sellerExpansion });
}

function definition(
  value: Omit<MarketProviderDefinition, 'budget'> & { budget: Readonly<ProviderBudget> },
): Readonly<MarketProviderDefinition> {
  return Object.freeze(value);
}

const PROVIDER_DEFINITIONS: readonly Readonly<MarketProviderDefinition>[] = Object.freeze([
  definition({
    id: 'naver-shopping',
    market: '네이버쇼핑',
    sourceType: 'naver_shopping',
    budget: budget(8, 5, 5),
    query: (identity) => `${identity} 네이버 쇼핑`,
  }),
  definition({
    id: 'coupang',
    market: '쿠팡',
    sourceType: 'coupang',
    budget: budget(6, 4),
    query: (identity) => `${identity} site:coupang.com`,
  }),
  definition({
    id: 'danawa',
    market: '다나와',
    sourceType: 'danawa',
    budget: budget(5, 2, 6),
    query: (identity) => `${identity} site:danawa.com`,
  }),
  definition({
    id: 'enuri',
    market: '에누리',
    sourceType: 'enuri',
    budget: budget(5, 2, 6),
    query: (identity) => `${identity} site:enuri.com`,
  }),
  definition({
    id: '11st',
    market: '11번가',
    sourceType: '11st',
    budget: budget(5, 4),
    query: (identity) => `${identity} site:11st.co.kr`,
  }),
  definition({
    id: 'gmarket',
    market: 'G마켓',
    sourceType: 'gmarket',
    budget: budget(5, 4),
    query: (identity) => `${identity} site:gmarket.co.kr`,
  }),
  definition({
    id: 'auction',
    market: '옥션',
    sourceType: 'auction',
    budget: budget(5, 4),
    query: (identity) => `${identity} site:auction.co.kr`,
  }),
  definition({
    id: 'ssg',
    market: 'SSG',
    sourceType: 'ssg',
    budget: budget(4, 3),
    query: (identity) => `${identity} site:ssg.com`,
  }),
  definition({
    id: 'lotteon',
    market: '롯데ON',
    sourceType: 'lotteon',
    budget: budget(4, 3),
    query: (identity) => `${identity} site:lotteon.com`,
  }),
  definition({
    id: 'himart',
    market: '롯데하이마트',
    sourceType: 'himart',
    budget: budget(4, 3),
    query: (identity) => `${identity} site:e-himart.co.kr`,
  }),
  definition({
    id: 'official',
    market: '공식몰',
    sourceType: 'official_store',
    budget: budget(4, 3),
    query: (identity) => `${identity} 공식 스펙 보증 AS 인증 공식몰`,
  }),
  definition({
    id: 'kakao-talkdeal',
    market: '카카오 톡딜',
    sourceType: 'kakao_talkdeal',
    budget: budget(5, 4),
    query: (identity) => `${identity} 톡딜 site:store.kakao.com`,
  }),
  definition({
    id: 'toss-shopping',
    market: '토스쇼핑',
    sourceType: 'toss_shopping',
    budget: budget(5, 4),
    query: (identity) => `${identity} 토스 쇼핑 site:toss.im`,
  }),
]);

export function listMarketProviderDefinitions(): readonly Readonly<MarketProviderDefinition>[] {
  return PROVIDER_DEFINITIONS;
}

export function providerDefinitionById(
  id: MarketProviderId,
): Readonly<MarketProviderDefinition> | undefined {
  return PROVIDER_DEFINITIONS.find((provider) => provider.id === id);
}

/**
 * Loads the concrete adapters only after this registry module has finished
 * initializing. The lazy imports intentionally avoid a runtime cycle because
 * market adapters read their immutable definitions from this module.
 */
export async function createMarketProviderRegistry(): Promise<readonly MarketProvider[]> {
  const [
    naver,
    coupang,
    danawa,
    enuri,
    elevenst,
    gmarket,
    auction,
    ssg,
    lotteon,
    himart,
    official,
    kakao,
    toss,
  ] = await Promise.all([
    import('./markets/naver.ts'),
    import('./markets/coupang.ts'),
    import('./markets/danawa.ts'),
    import('./markets/enuri.ts'),
    import('./markets/elevenst.ts'),
    import('./markets/gmarket.ts'),
    import('./markets/auction.ts'),
    import('./markets/ssg.ts'),
    import('./markets/lotteon.ts'),
    import('./markets/himart.ts'),
    import('./markets/official.ts'),
    import('./markets/kakaotalkdeal.ts'),
    import('./markets/toss-shopping.ts'),
  ]);

  return Object.freeze([
    naver.naverShoppingProvider,
    coupang.coupangProvider,
    danawa.danawaProvider,
    enuri.enuriProvider,
    elevenst.elevenstProvider,
    gmarket.gmarketProvider,
    auction.auctionProvider,
    ssg.ssgProvider,
    lotteon.lotteonProvider,
    himart.himartProvider,
    official.officialProvider,
    kakao.kakaoTalkDealProvider,
    toss.tossShoppingProvider,
  ]);
}
