import { parseNaverProductUrl } from '../adapters/naver-product.ts';
import { matchEvidenceToProduct } from '../core/product-match.ts';
import type { NormalizedTarget, ProductCandidate, ProductResolution, ResearchRequest } from '../core/types.ts';
import type { SearchHit } from '../providers/index.ts';

export interface ProductResolverDependencies {
  publicSearch: (query: string) => Promise<SearchHit[]>;
}

const QUERY_STOPWORDS = [
  '어때', '살만한지', '살만해', '사도 돼', '사도돼', '지금 사', '구매', '추천', '가성비',
  '가격', '최저가', '쿠폰', '멤버십', '적립', '배송', '특가', '알려줘', '봐줘',
] as const;

const GENERIC_BRAND_TOKENS = new Set(['43인치', '42인치', '55인치', '65인치', '4k', 'uhd', '스마트tv', '스마트모니터', 'tv', '모니터']);

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanQuestion(question: string): string {
  let cleaned = question.toLowerCase();
  for (const stopword of QUERY_STOPWORDS) cleaned = cleaned.replaceAll(stopword, ' ');
  return compact(cleaned.replace(/[?!.~,;:()[\]{}<>"']/g, ' '));
}

function textTokens(value: string): string[] {
  return value.toLowerCase().match(/[0-9a-z가-힣]+/gi) ?? [];
}

function extractModel(value: string): string | undefined {
  return textTokens(value).find((token) => /^[a-z]+[-_]?\d+[a-z0-9-]*$/i.test(token));
}

function extractVariant(value: string): string | undefined {
  const match = value.match(/\b(\d+(?:\.\d+)?)\s*(인치|inch|형|gb|tb)\b/i);
  if (!match) return undefined;
  const unit = match[2]!.toLowerCase() === 'inch' ? '인치' : match[2]!.toLowerCase();
  return `${match[1]}${unit}`;
}

function extractBrand(value: string): string | undefined {
  for (const token of textTokens(value)) {
    if (/^\d/.test(token)) continue;
    if (/^[a-z]+\d+$/i.test(token)) continue;
    if (GENERIC_BRAND_TOKENS.has(token)) continue;
    if (['스탠드', '이동식', '스마트', '제품'].includes(token)) continue;
    return token;
  }
  return undefined;
}

function querySeed(question: string): NormalizedTarget {
  const name = cleanQuestion(question);
  const target: NormalizedTarget = { kind: 'product', name };
  const brand = extractBrand(name);
  const model = extractModel(name);
  const variant = extractVariant(name);
  if (brand) target.brand = brand;
  if (model) target.model = model;
  if (variant) target.variant = variant;
  return target;
}

function inferCandidateTarget(hit: SearchHit, seed: NormalizedTarget): NormalizedTarget {
  const parsed = parseNaverProductUrl(hit.url);
  const target: NormalizedTarget = {
    kind: 'product',
    name: compact(hit.title),
  };

  const inferredBrand = extractBrand(hit.title);
  const inferredModel = extractModel(hit.title);
  const inferredVariant = extractVariant(hit.title) ?? seed.variant;

  if (seed.brand && hit.title.toLowerCase().includes(seed.brand.toLowerCase())) target.brand = seed.brand;
  else if (inferredBrand) target.brand = inferredBrand;
  if (seed.model && hit.title.toLowerCase().includes(seed.model.toLowerCase())) target.model = seed.model;
  else if (inferredModel) target.model = inferredModel;
  if (inferredVariant) target.variant = inferredVariant;

  try {
    const url = new URL(hit.url);
    target.sourceHost = url.hostname;
    target.canonicalUrl = parsed?.canonicalUrl ?? url.toString();
  } catch {
    // Search provider already validates URLs; leave optional URL fields absent if malformed.
  }
  if (parsed?.productId) target.productId = parsed.productId;
  return target;
}

function lexicalScore(query: string, hit: SearchHit): number {
  const queryTokens = [...new Set(textTokens(query).filter((token) => token.length > 1))];
  if (!queryTokens.length) return 0;
  const haystack = new Set(textTokens(`${hit.title} ${hit.snippet}`));
  return queryTokens.filter((token) => haystack.has(token)).length / queryTokens.length;
}

function candidateKey(target: NormalizedTarget): string {
  return [target.brand, target.model, target.variant]
    .map((value) => value?.toLowerCase().trim() ?? '')
    .join('|') || target.name?.toLowerCase() || target.canonicalUrl || crypto.randomUUID();
}

function groupCandidates(seed: NormalizedTarget, query: string, hits: SearchHit[]): ProductCandidate[] {
  const grouped = new Map<string, { candidate: ProductCandidate; count: number }>();

  for (const hit of hits) {
    const match = matchEvidenceToProduct(seed, hit);
    const lexical = lexicalScore(query, hit);
    const baseScore = Math.max(match.score, lexical * 0.75);
    const target = inferCandidateTarget(hit, seed);
    const key = candidateKey(target);
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.candidate.score = Math.min(1, Math.max(existing.candidate.score, baseScore) + 0.12);
      if (!existing.candidate.sourceUrls.includes(hit.url)) existing.candidate.sourceUrls.push(hit.url);
    } else {
      grouped.set(key, {
        count: 1,
        candidate: {
          target,
          score: Math.min(1, baseScore),
          sourceUrls: [hit.url],
          title: hit.title,
        },
      });
    }
  }

  return [...grouped.values()]
    .map(({ candidate, count }) => ({ ...candidate, score: Math.min(1, candidate.score + Math.min(0.08, Math.max(0, count - 1) * 0.04)) }))
    .sort((a, b) => b.score - a.score);
}

export async function resolveProduct(
  request: ResearchRequest,
  deps: ProductResolverDependencies,
): Promise<ProductResolution> {
  if (request.url) {
    const parsed = parseNaverProductUrl(request.url);
    if (parsed) {
      return {
        target: parsed,
        confidence: parsed.productId ? 0.9 : 0.75,
        ambiguous: false,
        candidates: [{ target: parsed, score: parsed.productId ? 0.9 : 0.75, sourceUrls: [request.url], title: parsed.name ?? parsed.productId ?? 'product' }],
        identityEvidence: [{ title: parsed.name ?? parsed.productId ?? 'product', url: request.url, score: parsed.productId ? 0.9 : 0.75 }],
      };
    }
  }

  const query = cleanQuestion(request.question);
  if (!query) {
    return { target: { kind: 'unknown' }, confidence: 0, ambiguous: true, candidates: [], identityEvidence: [] };
  }

  const seed = querySeed(request.question);
  const hits = await deps.publicSearch(query);
  const candidates = groupCandidates(seed, query, hits.slice(0, 12));
  const top = candidates[0];
  const second = candidates[1];
  if (!top) {
    return { target: { kind: 'unknown' }, confidence: 0, ambiguous: true, candidates: [], identityEvidence: [] };
  }

  const margin = top.score - (second?.score ?? 0);
  const strongSeed = Boolean(seed.brand && seed.model);
  const resolved = top.score >= 0.65 && (strongSeed || margin >= 0.12);
  const confidence = resolved ? top.score : Math.min(top.score, 0.64);

  return {
    target: resolved ? top.target : { kind: 'unknown' },
    confidence,
    ambiguous: !resolved,
    candidates,
    identityEvidence: candidates.slice(0, 5).flatMap((candidate) =>
      candidate.sourceUrls.map((url) => ({ title: candidate.title, url, score: candidate.score }))),
  };
}
