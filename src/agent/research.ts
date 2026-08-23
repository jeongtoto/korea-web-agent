import { classifyResearchIntent } from '../core/intent.ts';
import { matchEvidenceToProduct } from '../core/product-match.ts';
import { assertPublicUrl, isRelayDomainAllowed } from '../core/policy.ts';
import type {
  EvidenceClass,
  NormalizedTarget,
  PriceSnapshot,
  ProductCandidate,
  ProductConfidenceDimensions,
  ProductSpecificity,
  ReportDecision,
  ResearchContext,
  ResearchIntent,
  ResearchJob,
  ResearchJobStatus,
  ResearchRequest,
} from '../core/types.ts';
import { resolveProduct } from '../orchestrator/product-resolver.ts';
import type { SearchHit } from '../providers/index.ts';

export interface AgentResearchInput {
  query: string;
  url?: string;
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
  decision: ReportDecision;
  confidence: number;
  confidenceDimensions?: ProductConfidenceDimensions;
  price?: PriceSnapshot;
  personalizedPrice?: PriceSnapshot;
  relay: AgentRelaySummary;
  summary: string;
  reasons: string[];
  strengths: string[];
  weaknesses: string[];
  missingInformation: string[];
  evidence: AgentEvidenceSummary[];
  sourceCoverage: AgentSourceCoverage;
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
    candidates: [],
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
  if (job.status === 'running') result.pollUrl = `/api/agent/job?jobId=${encodeURIComponent(job.id)}`;
  if (report?.confidenceDimensions) result.confidenceDimensions = report.confidenceDimensions;
  if (report?.price) result.price = report.price;
  if (report?.personalizedPrice) result.personalizedPrice = report.personalizedPrice;
  return result;
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

function relayDiscoveryQuery(target: NormalizedTarget): string {
  const identity = [...new Set([target.brand, target.model, target.variant, target.name].filter((value): value is string => Boolean(value?.trim())))]
    .join(' ')
    .trim();
  return identity ? `${identity} site:naver.com OR site:coupang.com` : '';
}

async function discoverRelayEligibleUrl(target: NormalizedTarget, deps: AgentResearchDependencies): Promise<string | undefined> {
  const query = relayDiscoveryQuery(target);
  if (!query) return undefined;
  try {
    const hits = await deps.publicSearch(query);
    for (const hit of hits.slice(0, 12)) {
      if (!relayEligible(hit.url)) continue;
      if (matchEvidenceToProduct(target, hit).level !== 'exact_product') continue;
      return assertPublicUrl(hit.url).toString();
    }
  } catch {
    // Public research should remain usable if a relay-specific discovery query fails.
  }
  return undefined;
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

  if (resolution.ambiguous || resolution.target.kind !== 'product') {
    return ambiguousResult(input.query, intent, resolution.confidence, resolution.candidates);
  }

  const target: NormalizedTarget = { ...resolution.target };
  let url = input.url ?? target.canonicalUrl;
  if (!input.url && intent.personalizedPriceUseful && !relayEligible(url)) {
    url = await discoverRelayEligibleUrl(target, deps) ?? url;
  }
  const wantsRelay = Boolean(intent.personalizedPriceUseful && relayEligible(url));
  const request: ResearchRequest = {
    question: input.query,
    category: 'product',
    includeLocalRelay: wantsRelay,
  };
  if (url) request.url = assertPublicUrl(url).toString();

  const context: ResearchContext = {
    intent,
    identityConfidence: resolution.confidence,
    resolvedTarget: target,
    resolutionAmbiguous: false,
  };
  const job = await deps.cloudResearch(request, context);
  if (!job.researchContext) job.researchContext = context;
  return shapeAgentResearchJob(job);
}
