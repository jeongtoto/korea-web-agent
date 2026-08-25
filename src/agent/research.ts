import { classifyResearchIntent } from '../core/intent.ts';
import { matchEvidenceToProduct } from '../core/product-match.ts';
import { assertPublicUrl, isRelayDomainAllowed } from '../core/policy.ts';
import type {
  CanonicalProductIdentity,
  EvidenceClass,
  NormalizedTarget,
  PriceSnapshot,
  MarketOffer,
  BestOffers,
  MarketCoverage,
  ProductRecommendation,
  ManualCheck,
  PurchaseContext,
  PurchaseContextApplied,
  ReliabilityIssue,
  ProductCandidate,
  ProductConfidenceDimensions,
  ProductSpecificity,
  ReportDecision,
  ResearchContext,
  ResearchIntent,
  ResearchJob,
  ResearchJobStatus,
  ResearchRequest,
  PriceHistoryReport,
  MembershipScenariosReport,
  EventWindowReport,
  StandardPriceRowReport,
} from '../core/types.ts';
import { resolveProduct } from '../orchestrator/product-resolver.ts';
import type { SearchHit } from '../providers/index.ts';
import { buildShoppingPresentation, type ShoppingPresentation } from '../report/shopping-presentation.ts';

export interface AgentResearchInput {
  query: string;
  url?: string;
  purchaseContext?: PurchaseContext;
}

export interface AgentResearchDependencies {
  publicSearch: (query: string) => Promise<SearchHit[]>;
  cloudResearch: (request: ResearchRequest, context: ResearchContext) => Promise<ResearchJob>;
}

export interface AgentEvidenceSummary {
  claim: string;
  sourceUrl: string;
  evidenceClass: EvidenceClass;
  confidence: number;
  specificity?: ProductSpecificity;
}

export interface AgentProductIdentity extends NormalizedTarget {
  identityConfidence: number;
  ambiguous: boolean;
  candidates: ProductCandidate[];
}

export interface AgentRelaySummary {
  requested: boolean;
  available: boolean;
  used: boolean;
  mode: 'offline' | 'public_only' | 'local_authenticated';
  message?: string;
}

export interface AgentSourceCoverage {
  attempted: number;
  succeeded: number;
  failed: number;
  evidenceCount: number;
}

export interface AgentResearchResult {
  status: ResearchJobStatus;
  jobId?: string;
  pollUrl?: string;
  query: string;
  intent: ResearchIntent;
  product: AgentProductIdentity;
  canonicalIdentity?: CanonicalProductIdentity;
  decision: ReportDecision;
  confidence: number;
  confidenceDimensions?: ProductConfidenceDimensions;
  price?: PriceSnapshot;
  personalizedPrice?: PriceSnapshot;
  offers?: MarketOffer[];
  bestOffers?: BestOffers;
  marketCoverage?: MarketCoverage[];
  recommendations?: ProductRecommendation[];
  manualChecks?: ManualCheck[];
  priceHistory?: PriceHistoryReport;
  membershipScenarios?: MembershipScenariosReport;
  eventWindow?: EventWindowReport;
  standardPriceRows?: StandardPriceRowReport[];
  presentation?: ShoppingPresentation;
  validationWarnings?: ReliabilityIssue[];
  relay: AgentRelaySummary;
  summary: string;
  reasons: string[];
  strengths: string[];
  weaknesses: string[];
  missingInformation: string[];
  evidence: AgentEvidenceSummary[];
  sourceCoverage: AgentSourceCoverage;
  purchaseContextApplied?: PurchaseContextApplied | PurchaseContext;
  errors: string[];
}

export function validateAgentResearchInput(value: unknown): AgentResearchInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object is required');
  const object = value as Record<string, unknown>;
  if (typeof object.query !== 'string' || !object.query.trim()) throw new Error('query is required');
  const query = object.query.trim();
  if (query.length > 2_000) throw new Error('query is too long');
  const input: AgentResearchInput = { query };
  if (object.url !== undefined) {
    if (typeof object.url !== 'string' || !object.url.trim() || object.url.length > 4_000) throw new Error('url is invalid');
    input.url = assertPublicUrl(object.url.trim()).toString();
  }
  if (object.purchaseContext !== undefined) {
    if (!object.purchaseContext || typeof object.purchaseContext !== 'object' || Array.isArray(object.purchaseContext)) throw new Error('purchaseContext is invalid');
    const raw = object.purchaseContext as Record<string, unknown>;
    const allowed = new Set(['ownedCards', 'paymentMethods', 'memberships', 'budget', 'region', 'preferences']);
    if (Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('purchaseContext contains unsupported fields');
    const context: PurchaseContext = {};
    for (const key of ['ownedCards', 'paymentMethods', 'memberships', 'preferences'] as const) {
      const value = raw[key];
      if (value === undefined) continue;
      if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 200)) throw new Error(`purchaseContext.${key} is invalid`);
      const containsSensitiveNumber = value.some((item) => /(?:\d[ -]?){12,19}/.test(item as string));
      if (key === 'ownedCards' && containsSensitiveNumber) {
        throw new Error('purchaseContext.ownedCards accepts card names only, never card numbers');
      }
      if (key === 'paymentMethods' && containsSensitiveNumber) {
        throw new Error('purchaseContext.paymentMethods accepts payment method names only, never card or account numbers');
      }
      context[key] = value.map((item) => (item as string).trim());
    }
    if (raw.budget !== undefined) {
      if (typeof raw.budget !== 'number' || !Number.isFinite(raw.budget) || raw.budget <= 0) throw new Error('purchaseContext.budget is invalid');
      context.budget = raw.budget;
    }
    if (raw.region !== undefined) {
      if (typeof raw.region !== 'string' || !raw.region.trim() || raw.region.length > 200) throw new Error('purchaseContext.region is invalid');
      context.region = raw.region.trim();
    }
    input.purchaseContext = context;
  }
  return input;
}

function compactEvidence(job: ResearchJob): AgentEvidenceSummary[] {
  return job.evidence
    .slice()
    .sort((a, b) => {
      const aExact = a.specificity === 'exact_product' ? 1 : 0;
      const bExact = b.specificity === 'exact_product' ? 1 : 0;
      return (bExact - aExact) || (b.confidence - a.confidence);
    })
    .slice(0, 20)
    .map((item) => {
      const summary: AgentEvidenceSummary = {
        claim: item.claim,
        sourceUrl: item.sourceUrl,
        evidenceClass: item.evidenceClass,
        confidence: item.confidence,
      };
      if (item.specificity) summary.specificity = item.specificity;
      return summary;
    });
}

function sourceCoverage(job: ResearchJob): AgentSourceCoverage {
  return {
    attempted: job.sourceResults.length,
    succeeded: job.sourceResults.filter((source) => source.success).length,
    failed: job.sourceResults.filter((source) => !source.success).length,
    evidenceCount: job.evidence.length,
  };
}

function productIdentity(job: ResearchJob): AgentProductIdentity {
  const identityConfidence = job.researchContext?.identityConfidence
    ?? job.report?.confidenceDimensions.identity
    ?? 0;
  return {
    ...job.target,
    identityConfidence,
    ambiguous: Boolean(job.researchContext?.resolutionAmbiguous),
    candidates: job.researchContext?.recommendationCandidates?.slice(0, 5) ?? [],
  };
}

export function shapeAgentResearchJob(job: ResearchJob): AgentResearchResult {
  const intent = job.researchContext?.intent ?? classifyResearchIntent(job.request.question);
  const report = job.report;
  const relay: AgentRelaySummary = {
    requested: Boolean(job.request.includeLocalRelay),
    available: job.relay.available,
    used: job.relay.used,
    mode: job.relay.mode,
  };
  if (job.relay.message) relay.message = job.relay.message;

  const result: AgentResearchResult = {
    status: job.status,
    jobId: job.id,
    query: job.request.question,
    intent,
    product: productIdentity(job),
    decision: report?.decision ?? 'INSUFFICIENT',
    confidence: report?.confidence ?? 0,
    relay,
    summary: report?.summary ?? '조사 결과를 완성할 근거가 부족합니다.',
    reasons: report?.reasons ?? [],
    strengths: report?.strengths ?? [],
    weaknesses: report?.weaknesses ?? [],
    missingInformation: report?.missingInformation ?? ['제품 조사 결과가 충분하지 않습니다.'],
    evidence: compactEvidence(job),
    sourceCoverage: sourceCoverage(job),
    errors: [...job.errors],
  };
  if (job.status === 'running' || job.status === 'queued') result.pollUrl = `/api/agent/job?jobId=${encodeURIComponent(job.id)}`;
  if (job.researchContext?.canonicalIdentity) result.canonicalIdentity = job.researchContext.canonicalIdentity;
  if (report?.confidenceDimensions) result.confidenceDimensions = report.confidenceDimensions;
  if (report?.price) result.price = report.price;
  if (report?.personalizedPrice) result.personalizedPrice = report.personalizedPrice;
  if (report?.offers) result.offers = report.offers;
  if (report?.bestOffers) result.bestOffers = report.bestOffers;
  if (report?.marketCoverage) result.marketCoverage = report.marketCoverage;
  if (report?.recommendations) result.recommendations = report.recommendations;
  if (report?.manualChecks) result.manualChecks = report.manualChecks;
  if (report?.priceHistory) result.priceHistory = report.priceHistory;
  if (report?.membershipScenarios) result.membershipScenarios = report.membershipScenarios;
  if (report?.eventWindow) result.eventWindow = report.eventWindow;
  if (report?.standardPriceRows) result.standardPriceRows = report.standardPriceRows;
  if (report?.validationWarnings) result.validationWarnings = report.validationWarnings;
  if (report?.purchaseContextApplied) result.purchaseContextApplied = report.purchaseContextApplied;
  else if (job.request.purchaseContext) result.purchaseContextApplied = job.request.purchaseContext;
  if (report && job.status !== 'queued' && job.status !== 'running') {
    result.presentation = buildShoppingPresentation(report, {
      ...(job.researchContext?.canonicalIdentity ? { canonicalIdentity: job.researchContext.canonicalIdentity } : {}),
      fallbackName: job.target.name ?? job.target.model,
      relay: job.relay,
    });
  }
  return result;
}

function isCategoryRecommendation(question: string): boolean {
  const text = question.toLowerCase().replace(/\s+/g, ' ');
  return /(추천|베스트|best|골라|뭐로\s*살|무엇을\s*살|어떤\s*(제품|이불|침구|가구|가전))/.test(text);
}

function ambiguousResult(query: string, intent: ResearchIntent, confidence: number, candidates: ProductCandidate[]): AgentResearchResult {
  return {
    status: 'completed',
    query,
    intent,
    product: {
      kind: 'unknown',
      identityConfidence: Math.min(confidence, 0.64),
      ambiguous: true,
      candidates: candidates.slice(0, 5),
    },
    decision: 'INSUFFICIENT',
    confidence: Math.min(confidence, 0.35),
    relay: { requested: false, available: false, used: false, mode: 'public_only', message: 'Product identity is ambiguous, so authenticated price lookup was not started.' },
    summary: '제품을 정확히 특정하지 못해 구매 판단을 진행하지 않았습니다.',
    reasons: [],
    strengths: [],
    weaknesses: [],
    missingInformation: ['제품명이 여러 후보와 겹칩니다. 정확한 모델 또는 상품 URL이 필요합니다.'],
    evidence: [],
    sourceCoverage: { attempted: 1, succeeded: 1, failed: 0, evidenceCount: 0 },
    errors: [],
  };
}

function relayEligible(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return isRelayDomainAllowed(assertPublicUrl(url).hostname);
  } catch {
    return false;
  }
}

function relayDiscoveryQueries(target: NormalizedTarget): string[] {
  const identity = [...new Set([target.brand, target.model, target.variant, target.name].filter((value): value is string => Boolean(value?.trim())))]
    .join(' ')
    .trim();
  if (!identity) return [];
  return [
    'site:naver.com',
    'site:coupang.com',
    'site:kream.co.kr',
    'site:danawa.com',
    'site:enuri.com',
    'site:11st.co.kr',
    'site:gmarket.co.kr',
    'site:auction.co.kr',
  ].map((site) => `${identity} 가격 카드 쿠폰 토스페이 카카오페이 네이버페이 ${site}`);
}

function marketName(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith('kream.co.kr')) return 'KREAM';
  if (host.endsWith('coupang.com')) return '쿠팡';
  if (host.endsWith('naver.com')) return '네이버';
  if (host.endsWith('danawa.com')) return '다나와';
  if (host.endsWith('enuri.com')) return '에누리';
  if (host.endsWith('11st.co.kr')) return '11번가';
  if (host.endsWith('gmarket.co.kr')) return 'G마켓';
  if (host.endsWith('auction.co.kr')) return '옥션';
  return host;
}

async function discoverRelayEligibleUrls(target: NormalizedTarget, deps: AgentResearchDependencies): Promise<string[]> {
  const queries = relayDiscoveryQueries(target);
  if (!queries.length) return [];
  const outcomes = await Promise.all(queries.map(async (query) => {
    try {
      return await deps.publicSearch(query);
    } catch {
      return [];
    }
  }));
  const urls: string[] = [];
  for (const hits of outcomes) {
    for (const hit of hits.slice(0, 8)) {
      if (!relayEligible(hit.url)) continue;
      if (!['exact_product', 'probable_product'].includes(matchEvidenceToProduct(target, hit).level)) continue;
      const url = assertPublicUrl(hit.url).toString();
      if (!urls.includes(url)) urls.push(url);
      if (urls.length >= 8) return urls;
    }
  }
  return urls;
}

export async function runAgentResearch(
  rawInput: AgentResearchInput,
  deps: AgentResearchDependencies,
): Promise<AgentResearchResult> {
  const input = validateAgentResearchInput(rawInput);
  const intent = classifyResearchIntent(input.query);
  const resolutionRequest: ResearchRequest = { question: input.query, category: 'product' };
  if (input.url) resolutionRequest.url = input.url;
  const resolution = await resolveProduct(resolutionRequest, { publicSearch: deps.publicSearch });
  const recommendationMode = isCategoryRecommendation(input.query);

  if ((resolution.ambiguous || resolution.target.kind !== 'product') && !(recommendationMode && resolution.candidates.length)) {
    return ambiguousResult(input.query, intent, resolution.confidence, resolution.candidates);
  }

  const target: NormalizedTarget = resolution.target.kind === 'product'
    ? { ...resolution.target }
    : { ...resolution.candidates[0]!.target, kind: 'product' };
  let url = input.url ?? target.canonicalUrl;
  const discoveredRelayUrls = intent.personalizedPriceUseful ? await discoverRelayEligibleUrls(target, deps) : [];
  const recommendationRelayCandidates = recommendationMode
    ? resolution.candidates.flatMap((candidate) => candidate.sourceUrls
        .filter(relayEligible)
        .map((candidateUrl) => ({ url: assertPublicUrl(candidateUrl).toString(), market: marketName(candidateUrl), candidate: candidate.target })))
    : [];
  if (!input.url && !relayEligible(url)) {
    url = recommendationRelayCandidates[0]?.url ?? discoveredRelayUrls[0] ?? url;
  }
  const wantsRelay = Boolean(intent.personalizedPriceUseful && (relayEligible(url) || recommendationRelayCandidates.length));
  const request: ResearchRequest = {
    question: input.query,
    category: 'product',
    includeLocalRelay: wantsRelay,
  };
  if (input.purchaseContext) request.purchaseContext = input.purchaseContext;
  if (wantsRelay) {
    const entries = [
      ...(url ? [{ url, market: marketName(url), candidate: target }] : []),
      ...recommendationRelayCandidates,
      ...discoveredRelayUrls.map((candidateUrl) => ({ url: candidateUrl, market: marketName(candidateUrl), candidate: target })),
    ].filter((entry, index, values) => values.findIndex((value) => value.url === entry.url) === index).slice(0, 8);
    request.relayCandidates = entries.map((entry) => ({
      url: entry.url,
      market: entry.market,
      targetHint: {
        ...(entry.candidate.brand ? { brand: entry.candidate.brand } : {}),
        ...(entry.candidate.name ? { name: entry.candidate.name } : {}),
        ...(entry.candidate.model ? { model: entry.candidate.model } : {}),
        ...(entry.candidate.variant ? { variant: entry.candidate.variant } : {}),
        ...(entry.candidate.productId ? { productId: entry.candidate.productId } : {}),
        ...(entry.candidate.liveId ? { liveId: entry.candidate.liveId } : {}),
      },
    }));
  }
  if (url) request.url = assertPublicUrl(url).toString();

  const context: ResearchContext = {
    intent,
    identityConfidence: resolution.confidence,
    resolvedTarget: target,
    resolutionAmbiguous: false,
    ...(resolution.canonicalIdentity ? { canonicalIdentity: resolution.canonicalIdentity } : {}),
    ...(recommendationMode ? { recommendationMode: true, recommendationCandidates: resolution.candidates.slice(0, 8) } : {}),
  };
  const job = await deps.cloudResearch(request, context);
  if (!job.researchContext) job.researchContext = context;
  return shapeAgentResearchJob(job);
}
