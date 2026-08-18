import { normalizeEvidence } from '../core/evidence.ts';
import { matchEvidenceToProduct } from '../core/product-match.ts';
import { deriveExplicitSearchSignals } from '../core/search-signals.ts';
import type {
  EvidenceItem,
  NormalizedTarget,
  PriceSnapshot,
  ResearchContext,
  ResearchJob,
  ResearchRequest,
  ResearchSourceResult,
  RelayStatus,
} from '../core/types.ts';
import { parseNaverProductUrl } from '../adapters/naver-product.ts';
import { buildProductReport } from '../report/product-report.ts';
import { fetchDirectPage, type DirectPageResult } from '../providers/direct-page.ts';
import { searchDuckDuckGo } from '../providers/duckduckgo.ts';
import { searchCrossref } from '../providers/crossref.ts';
import type { SearchHit } from '../providers/index.ts';
import { buildSourcePlan, shouldUseAcademicResearch, type SourceQuery } from '../providers/source-plan.ts';

export interface RelayClient {
  isAvailable(): Promise<boolean>;
  extract(url: string): Promise<PriceSnapshot>;
}

export interface ResearchDependencies {
  directPage: (url: string) => Promise<DirectPageResult>;
  publicSearch: (query: string) => Promise<SearchHit[]>;
  academicSearch?: (query: string) => Promise<SearchHit[]>;
  relayClient: RelayClient | null;
  now: () => Date;
  idFactory: () => string;
}

export function createDefaultResearchDependencies(overrides: Partial<ResearchDependencies> = {}): ResearchDependencies {
  return {
    directPage: (url) => fetchDirectPage(url),
    publicSearch: (query) => searchDuckDuckGo(query),
    academicSearch: (query) => searchCrossref(query),
    relayClient: null,
    now: () => new Date(),
    idFactory: () => crypto.randomUUID(),
    ...overrides,
  };
}

function timestamp(deps: ResearchDependencies): string {
  return deps.now().toISOString();
}

function targetFromRequest(request: ResearchRequest): NormalizedTarget {
  if (request.url) {
    const naver = parseNaverProductUrl(request.url);
    if (naver) return naver;
    try {
      const url = new URL(request.url);
      return {
        kind: request.category === 'place' ? 'place' : request.category === 'service' ? 'service' : request.category === 'product' ? 'product' : 'unknown',
        sourceHost: url.hostname,
        canonicalUrl: url.toString(),
      };
    } catch {
      return { kind: 'unknown' };
    }
  }
  if (request.category && request.category !== 'auto') return { kind: request.category };
  return { kind: 'unknown' };
}

function classifySearchHit(hit: SearchHit): EvidenceItem['evidenceClass'] {
  try {
    const host = new URL(hit.url).hostname.toLowerCase();
    if (host.includes('reddit.com')) return 'community_report';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'editorial_review';
    if (host.includes('blog.naver.com') || host.includes('cafe.naver.com')) return 'community_report';
    if (host.includes('gov.') || host.endsWith('.go.kr')) return 'official_record';
    return 'editorial_review';
  } catch {
    return 'editorial_review';
  }
}

function evidenceClassForSearch(source: SourceQuery | undefined, hit: SearchHit): EvidenceItem['evidenceClass'] {
  if (!source) return classifySearchHit(hit);
  switch (source.id) {
    case 'naver-shopping':
    case 'coupang':
    case 'danawa':
      return 'retailer_listing';
    case 'naver-blog':
    case 'naver-cafe':
    case 'reddit':
    case 'instagram':
      return 'community_report';
    case 'youtube':
    case 'news':
      return 'editorial_review';
    case 'official':
    case 'general':
      return classifySearchHit(hit);
    default:
      return source.evidenceClass;
  }
}

function searchHitEvidence(
  hit: SearchHit,
  retrievedAt: string,
  target: NormalizedTarget,
  source?: SourceQuery,
): EvidenceItem | null {
  if (source?.specificity === 'general_mechanism') {
    return {
      claim: [hit.title, hit.snippet].filter(Boolean).join(' — '),
      sourceUrl: hit.url,
      sourceType: source.sourceType,
      retrievedAt,
      acquisitionMethod: 'search_metadata',
      evidenceClass: source.evidenceClass,
      independenceKey: `search:${hit.url}`,
      confidence: hit.snippet ? 0.4 : 0.32,
      specificity: 'general_mechanism',
      notes: `General-mechanism search-index evidence from ${source.id}; it is not direct proof of the exact product.`,
    };
  }

  if (target.kind === 'product') {
    const match = matchEvidenceToProduct(target, hit);
    if (match.level === 'unrelated') return null;
    const specificity = match.level === 'exact_product' ? 'exact_product' : 'category';
    const confidence = match.level === 'exact_product'
      ? 0.45 + (0.2 * match.score)
      : 0.28 + (0.18 * match.score);
    const evidenceClass = evidenceClassForSearch(source, hit);
    const signals = match.level === 'exact_product'
      ? deriveExplicitSearchSignals(hit, evidenceClass, target)
      : {};
    return {
      claim: [hit.title, hit.snippet].filter(Boolean).join(' — '),
      sourceUrl: hit.url,
      sourceType: source?.sourceType ?? 'search_result',
      retrievedAt,
      acquisitionMethod: 'search_metadata',
      evidenceClass,
      independenceKey: `search:${hit.url}`,
      confidence,
      specificity,
      notes: `Identity match: ${match.level} (${match.score.toFixed(2)}). Search metadata is weaker than direct retrieval; source class is derived from the actual result host/source family, and sentiment/price signals are recorded only when explicit wording is present.`,
      data: { identityMatch: match.level, identityMatchScore: match.score, ...signals },
    };
  }

  return {
    claim: [hit.title, hit.snippet].filter(Boolean).join(' — '),
    sourceUrl: hit.url,
    sourceType: source?.sourceType ?? 'search_result',
    retrievedAt,
    acquisitionMethod: 'search_metadata',
    evidenceClass: evidenceClassForSearch(source, hit),
    independenceKey: `search:${hit.url}`,
    confidence: hit.snippet ? 0.45 : 0.35,
    specificity: source?.specificity ?? 'category',
    notes: source
      ? `Search-index evidence from ${source.id}; direct retrieval may increase confidence.`
      : 'Search-index evidence only; direct retrieval may increase confidence.',
  };
}

function academicHitEvidence(hit: SearchHit, retrievedAt: string): EvidenceItem {
  return {
    claim: [hit.title, hit.snippet].filter(Boolean).join(' — '),
    sourceUrl: hit.url,
    sourceType: 'crossref',
    retrievedAt,
    acquisitionMethod: 'official_api',
    evidenceClass: 'peer_reviewed_research',
    independenceKey: `academic:${hit.url}`,
    confidence: 0.68,
    specificity: 'general_mechanism',
    notes: 'Peer-reviewed publication metadata can support the general mechanism, not prove this exact product performs the same way.',
  };
}

function sourceResult(
  source: string,
  success: boolean,
  startedAt: string,
  completedAt: string,
  evidence: EvidenceItem[],
  error?: string,
): ResearchSourceResult {
  const result: ResearchSourceResult = { source, success, attemptedAt: startedAt, completedAt, evidence };
  if (evidence[0]) result.acquisitionMethod = evidence[0].acquisitionMethod;
  if (error) result.error = error;
  return result;
}

function mergeTargetFromPage(target: NormalizedTarget, page: DirectPageResult): NormalizedTarget {
  const merged: NormalizedTarget = { ...target };
  if (page.product?.name) merged.name = page.product.name;
  else if (!merged.name && page.title) merged.name = page.title;
  if (page.product?.brand) merged.brand = page.product.brand;
  if (page.product?.sku) merged.model = page.product.sku;
  if (!merged.canonicalUrl) merged.canonicalUrl = page.url;
  try {
    if (!merged.sourceHost) merged.sourceHost = new URL(page.url).hostname;
  } catch {
    // Keep existing target when the provider returns a malformed URL.
  }
  if (merged.kind === 'unknown' && page.product) merged.kind = 'product';
  return merged;
}

function relayEvidence(url: string, price: PriceSnapshot, retrievedAt: string): EvidenceItem {
  const bits: string[] = [];
  if (price.salePrice !== undefined) bits.push(`판매가 ${price.salePrice} ${price.currency}`);
  if (price.membershipPrice !== undefined) bits.push(`멤버십 가격 ${price.membershipPrice} ${price.currency}`);
  if (price.couponPrice !== undefined) bits.push(`쿠폰가 ${price.couponPrice} ${price.currency}`);
  if (price.estimatedPoints !== undefined) bits.push(`예상 적립 ${price.estimatedPoints} ${price.currency}`);
  if (price.shippingFee !== undefined) bits.push(`배송비 ${price.shippingFee} ${price.currency}`);
  if (price.shippingEta) bits.push(`배송 예정 ${price.shippingEta}`);
  return {
    claim: bits.length ? bits.join(' / ') : '로그인 세션에서 개인화 가격·배송 정보를 확인함',
    sourceUrl: url,
    sourceType: 'local_authenticated_price',
    retrievedAt,
    acquisitionMethod: 'local_relay',
    evidenceClass: 'retailer_listing',
    independenceKey: `local-relay:${url}`,
    confidence: 0.82,
    specificity: 'exact_product',
    data: { priceSnapshot: price },
  };
}

export async function runResearch(
  request: ResearchRequest,
  deps: ResearchDependencies = createDefaultResearchDependencies(),
  context: ResearchContext = {},
): Promise<ResearchJob> {
  const question = request.question.trim();
  if (!question) throw new Error('Research question is required');

  const createdAt = timestamp(deps);
  let target = context.resolvedTarget ? { ...context.resolvedTarget } : targetFromRequest(request);
  const evidence: EvidenceItem[] = [];
  const sourceResults: ResearchSourceResult[] = [];
  const errors: string[] = [];
  let personalizedPrice: PriceSnapshot | undefined;

  const relay: RelayStatus = {
    available: false,
    used: false,
    mode: 'public_only',
    message: request.includeLocalRelay ? 'Local relay not checked yet.' : 'Public-only research requested.',
  };

  if (request.url) {
    const startedAt = timestamp(deps);
    try {
      const page = await deps.directPage(request.url);
      target = mergeTargetFromPage(target, page);
      evidence.push(...page.evidence);
      sourceResults.push(sourceResult('direct_page', true, startedAt, timestamp(deps), page.evidence));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`direct_page: ${message}`);
      sourceResults.push(sourceResult('direct_page', false, startedAt, timestamp(deps), [], message));
    }
  }

  const sourcePlan = buildSourcePlan(target, request.question);
  if (sourcePlan.length) {
    const searchOutcomes = await Promise.all(sourcePlan.map(async (source) => {
      const startedAt = timestamp(deps);
      const sourceName = source.id === 'general' ? 'public_search' : source.id;
      try {
        const hits = await deps.publicSearch(source.query);
        const searchEvidence = hits
          .slice(0, source.maxHits)
          .map((hit) => searchHitEvidence(hit, timestamp(deps), target, source))
          .filter((item): item is EvidenceItem => item !== null);
        return { sourceName, startedAt, searchEvidence } as const;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { sourceName, startedAt, searchEvidence: [] as EvidenceItem[], error: message } as const;
      }
    }));

    for (const outcome of searchOutcomes) {
      if (outcome.error) {
        errors.push(`${outcome.sourceName}: ${outcome.error}`);
        sourceResults.push(sourceResult(outcome.sourceName, false, outcome.startedAt, timestamp(deps), [], outcome.error));
      } else {
        evidence.push(...outcome.searchEvidence);
        sourceResults.push(sourceResult(outcome.sourceName, true, outcome.startedAt, timestamp(deps), outcome.searchEvidence));
      }
    }
  }

  if (deps.academicSearch && shouldUseAcademicResearch(request.question) && (target.kind === 'product' || request.category === 'product' || request.category === 'auto')) {
    const startedAt = timestamp(deps);
    const academicQuery = [request.question, target.name ? 'product ergonomics safety performance' : 'ergonomics product safety']
      .filter(Boolean)
      .join(' ')
      .slice(0, 260);
    try {
      const academicHits = await deps.academicSearch(academicQuery);
      const academicEvidence = academicHits.slice(0, 6).map((hit) => academicHitEvidence(hit, timestamp(deps)));
      evidence.push(...academicEvidence);
      sourceResults.push(sourceResult('crossref', true, startedAt, timestamp(deps), academicEvidence));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`crossref: ${message}`);
      sourceResults.push(sourceResult('crossref', false, startedAt, timestamp(deps), [], message));
    }
  }

  if (request.includeLocalRelay && request.url && deps.relayClient) {
    try {
      relay.available = await deps.relayClient.isAvailable();
      if (relay.available) {
        const startedAt = timestamp(deps);
        personalizedPrice = await deps.relayClient.extract(request.url);
        const localEvidence = relayEvidence(request.url, personalizedPrice, timestamp(deps));
        evidence.push(localEvidence);
        sourceResults.push(sourceResult('local_relay', true, startedAt, timestamp(deps), [localEvidence]));
        relay.used = true;
        relay.mode = 'local_authenticated';
        relay.message = 'Personalized fields were read from the local authenticated browser.';
      } else {
        relay.message = 'Local relay is offline; public-only evidence was used.';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`local_relay: ${message}`);
      relay.message = 'Local relay failed; public-only evidence was used.';
    }
  } else if (request.includeLocalRelay) {
    relay.message = 'Local relay is not configured; public-only evidence was used.';
  }

  const normalized = normalizeEvidence(evidence);
  const completedAt = timestamp(deps);
  const status: ResearchJob['status'] = normalized.length === 0
    ? (errors.length ? 'failed' : 'completed')
    : (errors.length ? 'partial' : 'completed');

  const job: ResearchJob = {
    id: deps.idFactory(),
    status,
    request: { ...request, question },
    createdAt,
    updatedAt: completedAt,
    completedAt,
    target,
    sourceResults,
    evidence: normalized,
    relay,
    errors,
  };
  if (Object.keys(context).length) job.researchContext = { ...context, resolvedTarget: { ...target } };

  if (target.kind === 'product' || request.url) {
    job.report = buildProductReport({
      target: target.kind === 'unknown' ? { ...target, kind: 'product' } : target,
      evidence: normalized,
      ...(personalizedPrice ? { personalizedPrice } : {}),
      ...(context.intent ? { intent: context.intent } : {}),
      ...(context.identityConfidence !== undefined ? { identityConfidence: context.identityConfidence } : {}),
    });
  }

  return job;
}
