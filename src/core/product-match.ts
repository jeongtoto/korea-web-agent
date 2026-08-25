import type { NormalizedTarget, ProductMatchResult } from './types.ts';
import type { SearchHit } from '../providers/index.ts';

const GENERIC_TOKENS = new Set([
  '제품', '상품', '리뷰', '후기', '추천', '스마트', '스마트tv', 'tv', '모니터', '스탠드', '이동식',
  'uhd', '4k', '구매', '가격', '공식', '스토어', '쇼핑', '인치', '형',
]);

function normalized(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/([0-9]+)\s*(?:inch|인치|형)/gi, '$1인치')
    .replace(/[^0-9a-z가-힣]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string | undefined): string[] {
  return normalized(value).split(' ').filter(Boolean);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function meaningfulNameTokens(target: NormalizedTarget): string[] {
  const reserved = new Set([
    ...tokens(target.brand),
    ...tokens(target.model),
    ...tokens(target.variant),
  ]);
  return unique(tokens(target.name).filter((token) => !reserved.has(token) && !GENERIC_TOKENS.has(token)));
}

function includesNormalized(haystack: string, needle: string | undefined): boolean {
  const n = normalized(needle);
  return Boolean(n && normalized(haystack).includes(n));
}

function hitText(hit: SearchHit): string {
  let decodedUrl = hit.url;
  try { decodedUrl = decodeURIComponent(hit.url); } catch { /* keep raw URL */ }
  return `${hit.title} ${hit.snippet} ${decodedUrl}`;
}

/**
 * Broad discovery/evidence scorer only. A result labeled exact_product here is
 * not sufficient for purchase ranking; decisive offer eligibility must use
 * the canonical identity comparator after bundle/option verification.
 */
export function matchEvidenceToProduct(target: NormalizedTarget, hit: SearchHit): ProductMatchResult {
  const text = hitText(hit);
  if (target.productId && text.includes(target.productId)) {
    return {
      level: 'exact_product',
      score: 1,
      matchedTokens: [target.productId],
      missingTokens: [],
    };
  }

  const matchedTokens: string[] = [];
  const missingTokens: string[] = [];
  let score = 0;

  const brandKnown = Boolean(normalized(target.brand));
  const modelKnown = Boolean(normalized(target.model));
  const variantKnown = Boolean(normalized(target.variant));

  const brandMatch = brandKnown && includesNormalized(text, target.brand);
  const modelMatch = modelKnown && includesNormalized(text, target.model);
  const variantMatch = variantKnown && includesNormalized(text, target.variant);

  if (brandKnown) (brandMatch ? matchedTokens : missingTokens).push(target.brand!);
  if (modelKnown) (modelMatch ? matchedTokens : missingTokens).push(target.model!);
  if (variantKnown) (variantMatch ? matchedTokens : missingTokens).push(target.variant!);

  if (brandMatch) score += 0.30;
  if (modelMatch) score += 0.35;
  if (variantMatch) score += 0.20;

  const nameTokens = meaningfulNameTokens(target);
  if (nameTokens.length) {
    const textTokenSet = new Set(tokens(text));
    const matchingNameTokens = nameTokens.filter((token) => textTokenSet.has(token));
    matchedTokens.push(...matchingNameTokens);
    missingTokens.push(...nameTokens.filter((token) => !textTokenSet.has(token)));
    score += 0.15 * (matchingNameTokens.length / nameTokens.length);
  }

  score = Math.max(0, Math.min(1, score));

  if (score >= 0.80 || (brandMatch && modelMatch && (!variantKnown || variantMatch))) {
    return { level: 'exact_product', score, matchedTokens: unique(matchedTokens), missingTokens: unique(missingTokens) };
  }
  if (score >= 0.45 || (modelMatch && (brandMatch || variantMatch))) {
    return { level: 'probable_product', score, matchedTokens: unique(matchedTokens), missingTokens: unique(missingTokens) };
  }

  const targetCategoryTokens = tokens(target.name).filter((token) => GENERIC_TOKENS.has(token));
  const hitTokenSet = new Set(tokens(text));
  const categoryOverlap = targetCategoryTokens.filter((token) => hitTokenSet.has(token)).length;
  if (categoryOverlap >= 2) {
    return { level: 'category', score: Math.max(score, 0.25), matchedTokens: unique(matchedTokens), missingTokens: unique(missingTokens) };
  }

  return { level: 'unrelated', score, matchedTokens: unique(matchedTokens), missingTokens: unique(missingTokens) };
}
