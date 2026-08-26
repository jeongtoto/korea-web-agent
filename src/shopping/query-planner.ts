import { getShoppingCategorySchema, normalizeDimensionWeights } from './category-registry.ts';
import type {
  DiscoveryQuery,
  ShoppingCategoryId,
  ShoppingConstraint,
  ShoppingMode,
  ShoppingPreference,
  ShoppingResearchPlan,
} from './types.ts';

const DEFAULT_LIMITS = {
  rawHits: 80,
  normalizedCandidates: 50,
  lightEnrichment: 20,
  shortlist: 10,
  deepResearch: 5,
  fullPriceVerification: 3,
} as const;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function classifyMode(question: string): ShoppingMode {
  const text = compact(question).toLowerCase();
  if (/(비교|\bvs\.?\b|versus)/i.test(text)) return 'COMPARISON';

  const modelTokens = text.match(/[a-z][a-z0-9_-]*\d[a-z0-9_()-]*/gi) ?? [];
  const hasSpecificModel = modelTokens.some((token) => token.length >= 6 && /[a-z]/i.test(token) && /\d/.test(token));
  if (hasSpecificModel && /(최저가|가격|구매|살만|얼마|현재|지금|쿠폰|할인)/i.test(text)) return 'EXACT_PRODUCT';

  if (/(추천|베스트|best|골라|가성비|뭐로\s*살|무엇을\s*살|어떤\s*(제품|이불|침구|가전|tv|티비|모니터))/i.test(text)) {
    return 'RECOMMENDATION';
  }
  return hasSpecificModel ? 'EXACT_PRODUCT' : 'RECOMMENDATION';
}

function inferCategory(question: string): ShoppingCategoryId {
  const text = compact(question).toLowerCase();
  if (/(이불|침구|차렵|컴포터|구스|모달|침대패드|베딩|퀸\s*사이즈|queen\s*(?:size)?)/i.test(text)) return 'bedding';
  if (/(tv|티비|텔레비전|모니터|디스플레이|스탠바이미|무빙(?:tv|티비)?|이동식\s*(?:tv|티비)|이동형\s*(?:tv|티비)|\b4k\b|\buhd\b|qwge|ekwbyme)/i.test(text)) {
    return 'portable_display';
  }
  return 'unknown';
}

function parseBudget(question: string): ShoppingResearchPlan['budget'] | undefined {
  const manwon = question.match(/(\d+(?:\.\d+)?)\s*만\s*원(?:\s*(이하|미만|이내|안쪽|내|까지))?/i);
  if (manwon?.[1]) {
    const amount = Math.round(Number(manwon[1]) * 10_000);
    if (Number.isFinite(amount) && amount > 0) {
      return { max: amount, strength: manwon[2] ? 'hard' : 'soft' };
    }
  }

  const won = question.match(/([\d,]{4,})\s*원(?:\s*(이하|미만|이내|안쪽|내|까지))?/i);
  if (won?.[1]) {
    const amount = Number(won[1].replace(/,/g, ''));
    if (Number.isFinite(amount) && amount > 0) {
      return { max: amount, strength: won[2] ? 'hard' : 'soft' };
    }
  }
  return undefined;
}

function hardConstraint(
  id: string,
  field: string,
  expected: ShoppingConstraint['expected'],
  operator: ShoppingConstraint['operator'] = 'eq',
): ShoppingConstraint {
  return { id, field, operator, expected, strength: 'hard' };
}

function portableDisplayConstraints(question: string): ShoppingConstraint[] {
  const constraints: ShoppingConstraint[] = [];
  const size = question.match(/(\d{2,3})\s*(?:인치|inch|형)/i);
  if (size?.[1]) constraints.push(hardConstraint('screen-size', 'screenSizeInch', Number(size[1])));
  if (/\b4k\b|\buhd\b/i.test(question)) constraints.push(hardConstraint('resolution-4k', 'resolution', '4K'));
  if (/(이동식|이동형|무빙|스탠바이미형|스탠바이미\s*(?:대체|스타일)?)/i.test(question)) {
    constraints.push(hardConstraint('portable-stand', 'portableStand', true));
  }
  return constraints;
}

function beddingConstraints(question: string): ShoppingConstraint[] {
  const constraints: ShoppingConstraint[] = [];
  if (/(퀸|queen|(?:^|\s)q(?:\s|$))/i.test(question)) {
    constraints.push(hardConstraint('bed-size-queen', 'bedSize', ['Q', 'QUEEN'], 'includes'));
  }
  if (/사계절/i.test(question)) constraints.push(hardConstraint('all-season', 'allSeason', true));
  if (/차렵/i.test(question)) constraints.push(hardConstraint('bedding-type-comforter', 'beddingType', 'comforter'));
  return constraints;
}

function preferencesFor(categoryId: ShoppingCategoryId, question: string): ShoppingPreference[] {
  const preferences: ShoppingPreference[] = [];
  const add = (dimension: string, evidence: string, weight = 1): void => {
    if (!preferences.some((item) => item.dimension === dimension)) preferences.push({ dimension, evidence, weight });
  };

  if (/가성비|가격\s*대비|value/i.test(question)) add('value', '가성비/가격 대비 가치 우선', 1.5);

  if (categoryId === 'portable_display') {
    if (/(화질|화면|밝기|명암|패널)/i.test(question)) add('displayQuality', '화질 관련 우선순위', 1.35);
    if (/(이동성|이동|바퀴|스탠드)/i.test(question)) add('mobility', '이동성/스탠드 우선순위', 1.35);
    if (/(스마트|ott|넷플릭스|유튜브|에어플레이|크롬캐스트)/i.test(question)) add('smartFeatures', '스마트 기능 우선순위', 1.2);
    if (/(a\/s|as|보증|서비스)/i.test(question)) add('serviceWarranty', 'A/S·보증 우선순위', 1.2);
  }

  if (categoryId === 'bedding') {
    if (/(세탁|관리|건조기)/i.test(question)) add('care', '세탁·관리 편의 우선순위', 1.35);
    if (/(촉감|부드|포근)/i.test(question)) add('tactileComfort', '촉감 우선순위', 1.35);
    if (/(원단|소재|충전재|충전량|순면|모달|구스)/i.test(question)) add('fabricFillQuality', '원단·충전재 품질 우선순위', 1.25);
    if (/(내구|보풀|오래|장기)/i.test(question)) add('durability', '내구성 우선순위', 1.2);
    if (/(알러지|알레르기|먼지)/i.test(question)) add('allergySafety', '알레르기·먼지 우선순위', 1.2);
  }

  return preferences;
}

function weightedDimensions(categoryId: ShoppingCategoryId, preferences: ShoppingPreference[]): Record<string, number> {
  const schema = getShoppingCategorySchema(categoryId);
  const weights = { ...schema.defaultWeights };
  for (const preference of preferences) {
    if (weights[preference.dimension] === undefined) continue;
    weights[preference.dimension] = weights[preference.dimension]! * preference.weight;
  }
  return normalizeDimensionWeights(weights);
}

function uniqueQueries(queries: DiscoveryQuery[]): DiscoveryQuery[] {
  const seen = new Set<string>();
  return queries.filter((item) => {
    const query = compact(item.query);
    if (!query || seen.has(query.toLowerCase())) return false;
    seen.add(query.toLowerCase());
    item.query = query;
    return true;
  });
}

function portableDisplayQueries(question: string): DiscoveryQuery[] {
  const size = question.match(/(\d{2,3})\s*(?:인치|inch|형)/i)?.[1] ?? '43';
  const resolution = /\b4k\b|\buhd\b/i.test(question) ? '4K' : 'UHD';
  const base = `${size}인치 ${resolution} 이동식 TV`;
  return uniqueQueries([
    { id: 'display-general', query: base, maxHits: 10, sourceGroup: 'general' },
    { id: 'display-smart', query: `${size}인치 UHD 이동형 스마트 TV`, maxHits: 10, sourceGroup: 'general' },
    { id: 'display-standbyme', query: `${size}인치 스탠바이미 대체 이동식 TV`, maxHits: 10, sourceGroup: 'general' },
    { id: 'display-naver', query: `${base} site:shopping.naver.com`, maxHits: 10, sourceGroup: 'market' },
    { id: 'display-danawa', query: `${base} site:danawa.com`, maxHits: 10, sourceGroup: 'market' },
    { id: 'display-coupang', query: `${base} site:coupang.com`, maxHits: 8, sourceGroup: 'market' },
    { id: 'display-review', query: `${base} 리뷰 단점 장기 사용`, maxHits: 8, sourceGroup: 'review' },
  ]);
}

function beddingQueries(question: string): DiscoveryQuery[] {
  const size = /(퀸|queen|(?:^|\s)q(?:\s|$))/i.test(question) ? '퀸' : '퀸';
  const season = /사계절/i.test(question) ? '사계절 ' : '';
  const type = /차렵/i.test(question) ? '차렵이불' : '이불';
  const base = `${size} ${season}${type}`;
  return uniqueQueries([
    { id: 'bedding-general', query: base, maxHits: 10, sourceGroup: 'general' },
    { id: 'bedding-q', query: `Q 퀸 ${season}${type}`, maxHits: 10, sourceGroup: 'general' },
    { id: 'bedding-care', query: `${base} 세탁 촉감 가성비`, maxHits: 10, sourceGroup: 'general' },
    { id: 'bedding-naver', query: `${base} site:shopping.naver.com`, maxHits: 10, sourceGroup: 'market' },
    { id: 'bedding-coupang', query: `${base} site:coupang.com`, maxHits: 8, sourceGroup: 'market' },
    { id: 'bedding-review', query: `${base} 후기 단점 세탁 내구성`, maxHits: 8, sourceGroup: 'review' },
  ]);
}

function discoveryQueries(categoryId: ShoppingCategoryId, mode: ShoppingMode, question: string): DiscoveryQuery[] {
  if (mode === 'EXACT_PRODUCT') return [];
  if (categoryId === 'portable_display') return portableDisplayQueries(question);
  if (categoryId === 'bedding') return beddingQueries(question);
  return [{ id: 'general', query: compact(question), maxHits: 10, sourceGroup: 'general' }];
}

export function planShoppingResearch(question: string): ShoppingResearchPlan {
  const normalizedQuestion = compact(question);
  const mode = classifyMode(normalizedQuestion);
  const categoryId = inferCategory(normalizedQuestion);
  const budget = parseBudget(normalizedQuestion);
  const hardConstraints = categoryId === 'portable_display'
    ? portableDisplayConstraints(normalizedQuestion)
    : categoryId === 'bedding'
      ? beddingConstraints(normalizedQuestion)
      : [];
  const preferences = preferencesFor(categoryId, normalizedQuestion);

  const plan: ShoppingResearchPlan = {
    mode,
    categoryId,
    hardConstraints,
    preferences,
    dimensionWeights: weightedDimensions(categoryId, preferences),
    discoveryQueries: discoveryQueries(categoryId, mode, normalizedQuestion),
    limits: { ...DEFAULT_LIMITS },
  };
  if (budget) plan.budget = budget;
  return plan;
}
