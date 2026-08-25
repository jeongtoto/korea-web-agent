import {
  constraintEligibility,
  evaluateProductConstraints,
} from '../core/constraints.ts';
import {
  candidateIdentityFromText,
  compareCanonicalIdentity,
} from '../core/identity-match.ts';
import { buildMarketOffer } from '../core/offer-engine.ts';
import { providerFailureKind } from '../core/provider-attempt.ts';
import { withRetry } from '../core/retry.ts';
import { deriveExplicitSearchSignals } from '../core/search-signals.ts';
import type {
  CanonicalProductIdentity,
  EvidenceItem,
  IdentityVerdict,
  MarketOffer,
  NormalizedTarget,
  ProductConstraint,
  ProviderAttempt,
} from '../core/types.ts';
import {
  createKeyedSemaphore,
  createSemaphore,
  mapWithConcurrency,
  withDeadline,
  type DeadlineRunner,
} from '../providers/concurrency.ts';
import type { DirectPageResult } from '../providers/direct-page.ts';
import type { SearchHit } from '../providers/index.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  SellerCandidate,
  VerificationCandidate,
} from '../providers/market-provider.ts';
import { deduplicateSellerOffers } from '../providers/offer-dedupe.ts';
import { createVerificationCache } from '../providers/verification-cache.ts';
import type { SourceQuery } from '../providers/source-plan.ts';

export interface ProviderPipelineInput {
  source: SourceQuery;
  target: NormalizedTarget;
  canonicalIdentity: CanonicalProductIdentity;
  constraints: ProductConstraint[];
  publicSearch: (query: string) => Promise<SearchHit[]>;
  directPage: (url: string) => Promise<DirectPageResult>;
  now: () => Date;
}

export interface ProviderPipelineResult {
  evidence: EvidenceItem[];
  offers: MarketOffer[];
  attempt: ProviderAttempt;
}

function marketName(source: SourceQuery): string {
  return source.market ?? source.sourceType;
}

function preliminaryOffer(
  hit: SearchHit,
  target: NormalizedTarget,
  retrievedAt: string,
  verdict: IdentityVerdict,
): MarketOffer | null {
  if (verdict === 'different') return null;
  const offer = buildMarketOffer(hit, target, retrievedAt);
  if (!offer) return null;
  offer.verification = 'search_metadata';
  offer.eligible = false;
  offer.identityVerdict = verdict;
  offer.constraintStatus = 'preliminary';
  offer.fieldVerification = {
    identity: 'search_metadata',
    price: 'search_metadata',
    shipping: offer.shippingFee !== undefined ? 'search_metadata' : 'unverified',
  };
  if (!offer.exclusionReasons.includes('search_metadata_requires_page_verification')) {
    offer.exclusionReasons.push('search_metadata_requires_page_verification');
  }
  return offer;
}

function searchEvidence(
  source: SourceQuery,
  hit: SearchHit,
  target: NormalizedTarget,
  retrievedAt: string,
  verdict: IdentityVerdict,
  score: number,
  offer: MarketOffer | null,
): EvidenceItem {
  const signals = deriveExplicitSearchSignals(hit, source.evidenceClass, target);
  return {
    claim: [hit.title, hit.snippet].filter(Boolean).join(' — '),
    sourceUrl: hit.url,
    sourceType: source.sourceType,
    retrievedAt,
    acquisitionMethod: 'search_metadata',
    evidenceClass: source.evidenceClass,
    independenceKey: `search:${hit.url}`,
    confidence: verdict === 'exact' ? Math.min(0.62, 0.42 + score * 0.2) : 0.34,
    specificity: verdict === 'exact' ? 'exact_product' : 'category',
    notes: `Discovery-only retailer metadata. Canonical identity verdict: ${verdict}. Direct page verification is required before decisive ranking.`,
    data: {
      identityVerdict: verdict,
      identityScore: score,
      discoveryOnly: true,
      ...signals,
      ...(offer ? { marketOffer: offer } : {}),
    },
  };
}

function pageText(page: DirectPageResult): string {
  return [
    page.facts?.name,
    page.facts?.brand,
    page.facts?.sku,
    page.facts?.model,
    page.facts?.description,
    page.title,
    page.description,
  ].filter(Boolean).join(' ');
}

function unavailable(value: string | undefined): boolean {
  return Boolean(value && /(outofstock|soldout|discontinued|품절|판매종료|종료)/i.test(value.replace(/\s+/g, '')));
}

function offerFromPage(
  input: ProviderPipelineInput,
  page: DirectPageResult,
  retrievedAt: string,
): MarketOffer | null {
  const facts = page.facts;
  const price = facts?.price ?? page.product?.offers?.price;
  if (price === undefined || !Number.isFinite(price) || price <= 0) return null;

  const candidate = candidateIdentityFromText(pageText(page));
  const identity = compareCanonicalIdentity(input.canonicalIdentity, candidate);
  const constraintEvaluations = evaluateProductConstraints(input.constraints, facts?.attributes ?? {});
  const constraintStatus = constraintEligibility(constraintEvaluations);
  const shippingFee = facts?.shippingFee ?? page.product?.offers?.shippingFee;
  const availability = facts?.availability ?? page.product?.offers?.availability;
  const condition = candidate.condition === 'any' ? 'unknown' : candidate.condition;
  const eligible = identity.verdict === 'exact'
    && constraintStatus === 'eligible'
    && shippingFee !== undefined
    && !unavailable(availability);
  const exclusionReasons: string[] = [];
  if (identity.verdict !== 'exact') exclusionReasons.push(`identity:${identity.verdict}`);
  if (constraintStatus !== 'eligible') exclusionReasons.push(`constraints:${constraintStatus}`);
  if (shippingFee === undefined) exclusionReasons.push('shipping:unknown');
  if (unavailable(availability)) exclusionReasons.push('availability:unavailable');

  const offer: MarketOffer = {
    id: `${marketName(input.source)}:${page.url}`,
    market: marketName(input.source),
    title: facts?.name ?? page.product?.name ?? page.title ?? input.target.name ?? '상품',
    url: page.url,
    currency: page.product?.offers?.currency ?? 'KRW',
    retrievedAt,
    verification: 'page_verified',
    condition,
    identityScore: identity.confidence,
    identityVerdict: identity.verdict,
    constraintStatus,
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: shippingFee !== undefined ? 'page_verified' : 'unverified',
    },
    bundleComplete: identity.verdict === 'exact' || identity.verdict === 'same_except_condition',
    eligible,
    salePrice: price,
    ...(shippingFee !== undefined ? { shippingFee } : {}),
    ...(shippingFee !== undefined ? { totalCashPrice: Math.round(price + shippingFee) } : {}),
    ...(availability ? { availability } : {}),
    conditions: [],
    riskFlags: [],
    exclusionReasons,
  };
  return offer;
}

function initialAttempt(input: ProviderPipelineInput): ProviderAttempt {
  return {
    market: marketName(input.source),
    attemptedAt: input.now().toISOString(),
    discovery: { attempted: true, hitCount: 0 },
    identity: { exact: 0, uncertain: 0, different: 0 },
    verification: { attempted: 0, succeeded: 0, failed: 0 },
    offers: { extracted: 0, eligible: 0 },
    status: 'no_match',
  };
}

function usableVerifiedOffer(offer: MarketOffer): boolean {
  return offer.eligible || (
    offer.identityVerdict === 'same_except_condition'
      && offer.constraintStatus === 'eligible'
      && offer.shippingFee !== undefined
      && !unavailable(offer.availability)
  );
}

function finishAttempt(attempt: ProviderAttempt, now: () => Date): void {
  attempt.completedAt = now().toISOString();
  if (attempt.offers.eligible > 0) attempt.status = 'verified';
  else if (attempt.verification.failed > 0 && attempt.failureKind) attempt.status = 'failed';
  else if (attempt.identity.exact + attempt.identity.uncertain > 0 || attempt.offers.extracted > 0) attempt.status = 'found_unverified';
  else attempt.status = 'no_match';
}

function verdictPriority(verdict: 'exact' | 'same_except_condition' | 'uncertain'): number {
  if (verdict === 'exact') return 0;
  if (verdict === 'same_except_condition') return 1;
  return 2;
}

/**
 * v0.6.1-compatible bounded generic fallback. Provider v2 orchestration below
 * intentionally does not use this function's fixed top-three verification path.
 */
export async function researchProviderSource(
  input: ProviderPipelineInput,
): Promise<ProviderPipelineResult> {
  const evidence: EvidenceItem[] = [];
  const offers: MarketOffer[] = [];
  const attempt = initialAttempt(input);

  let hits: SearchHit[];
  try {
    const result = await withRetry(() => input.publicSearch(input.source.query));
    hits = result.value.slice(0, input.source.maxHits);
  } catch (error) {
    attempt.failureKind = providerFailureKind(error);
    attempt.failureMessage = error instanceof Error ? error.message : String(error);
    attempt.status = 'failed';
    attempt.completedAt = input.now().toISOString();
    return { evidence, offers, attempt };
  }

  attempt.discovery.hitCount = hits.length;
  const promising: Array<{ hit: SearchHit; verdict: 'exact' | 'same_except_condition' | 'uncertain'; score: number }> = [];
  for (const hit of hits) {
    const candidate = candidateIdentityFromText(`${hit.title} ${hit.snippet}`);
    const match = compareCanonicalIdentity(input.canonicalIdentity, candidate);
    if (match.verdict === 'exact') attempt.identity.exact += 1;
    else if (match.verdict === 'uncertain' || match.verdict === 'same_except_condition') attempt.identity.uncertain += 1;
    else attempt.identity.different += 1;

    const retrievedAt = input.now().toISOString();
    const discoveryOffer = preliminaryOffer(hit, input.target, retrievedAt, match.verdict);
    if (discoveryOffer) {
      offers.push(discoveryOffer);
      attempt.offers.extracted += 1;
    }
    evidence.push(searchEvidence(input.source, hit, input.target, retrievedAt, match.verdict, match.confidence, discoveryOffer));

    if (match.verdict === 'exact' || match.verdict === 'same_except_condition' || match.verdict === 'uncertain') {
      promising.push({ hit, verdict: match.verdict, score: match.confidence });
    }
  }

  promising.sort((a, b) => verdictPriority(a.verdict) - verdictPriority(b.verdict) || b.score - a.score);
  for (const candidate of promising.slice(0, 3)) {
    attempt.verification.attempted += 1;
    try {
      const result = await withRetry(() => input.directPage(candidate.hit.url));
      const page = result.value;
      attempt.verification.succeeded += 1;
      evidence.push(...page.evidence);
      const offer = offerFromPage(input, page, input.now().toISOString());
      if (offer) {
        offers.push(offer);
        attempt.offers.extracted += 1;
        if (usableVerifiedOffer(offer)) attempt.offers.eligible += 1;
      }
    } catch (error) {
      attempt.verification.failed += 1;
      if (!attempt.failureKind) attempt.failureKind = providerFailureKind(error);
      if (!attempt.failureMessage) attempt.failureMessage = error instanceof Error ? error.message : String(error);
    }
  }

  finishAttempt(attempt, input.now);
  return { evidence, offers, attempt };
}

export const PROVIDER_CONCURRENCY = Object.freeze({
  discovery: 5,
  verification: 4,
  sellerExpansion: 3,
  sameDomain: 2,
} as const);

export interface MarketProviderCoverageInput {
  providers: readonly MarketProvider[];
  target: NormalizedTarget;
  canonicalIdentity: CanonicalProductIdentity;
  constraints: ProductConstraint[];
  publicSearch: (query: string) => Promise<SearchHit[]>;
  directPage: (url: string) => Promise<DirectPageResult>;
  now: () => Date;
  nowMs?: () => number;
  totalDeadlineMs?: number;
  operationTimeoutMs?: number;
  deadlineRunner?: DeadlineRunner;
  legacyFallback?: (provider: MarketProvider) => Promise<ProviderPipelineResult | null>;
}

export interface MarketProviderCoverageResult {
  evidence: EvidenceItem[];
  offers: MarketOffer[];
  attempts: ProviderAttempt[];
}

type ProviderAttemptDiagnostics = ProviderAttempt & {
  providerId?: string;
  comparisonPages?: number;
  expandedSellers?: number;
  exactOffers?: number;
  eligibleSellers?: number;
};

function providerAttempt(provider: MarketProvider, now: () => Date, attempted: boolean): ProviderAttemptDiagnostics {
  return {
    providerId: provider.id,
    market: provider.market,
    attemptedAt: now().toISOString(),
    discovery: { attempted, hitCount: 0 },
    identity: { exact: 0, uncertain: 0, different: 0 },
    verification: { attempted: 0, succeeded: 0, failed: 0 },
    offers: { extracted: 0, eligible: 0 },
    comparisonPages: 0,
    expandedSellers: 0,
    exactOffers: 0,
    eligibleSellers: 0,
    status: attempted ? 'no_match' : 'not_attempted',
  };
}

function finishProviderAttempt(attempt: ProviderAttemptDiagnostics, now: () => Date): void {
  attempt.completedAt = now().toISOString();
  if (attempt.offers.eligible > 0) attempt.status = 'verified';
  else if (attempt.failureKind && (attempt.verification.failed > 0 || attempt.failureMessage)) attempt.status = 'failed';
  else if (attempt.identity.exact + attempt.identity.uncertain > 0 || attempt.offers.extracted > 0) attempt.status = 'found_unverified';
  else attempt.status = 'no_match';
}

function directCandidateUrl(candidate: VerificationCandidate): string {
  return 'sellerUrl' in candidate ? candidate.sellerUrl : candidate.url;
}

function hostname(input: string): string {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return 'invalid-host';
  }
}

function providerSource(provider: MarketProvider): SourceQuery {
  return {
    id: provider.id,
    query: '',
    sourceType: provider.id,
    // Discovery metadata is never authoritative official evidence. The official
    // adapter verifies the resolved official host before an offer can be trusted.
    evidenceClass: 'retailer_listing',
    specificity: 'exact_product',
    maxHits: provider.budget.discovery,
    market: provider.market,
  };
}

function discoveryAsHit(candidate: DiscoveryCandidate): SearchHit {
  return {
    title: candidate.title,
    url: candidate.url,
    snippet: candidate.snippet,
  };
}

function rememberFailure(attempt: ProviderAttemptDiagnostics, error: unknown, verificationFailure = false): void {
  if (verificationFailure) attempt.verification.failed += 1;
  if (!attempt.failureKind) attempt.failureKind = providerFailureKind(error);
  if (!attempt.failureMessage) attempt.failureMessage = error instanceof Error ? error.message : String(error);
}

function canUseLegacyFallback(kind: ReturnType<typeof providerFailureKind>): boolean {
  return kind === 'unknown' || kind === 'parse_failed';
}

function alternativeVerified(offer: MarketOffer): boolean {
  return offer.identityVerdict === 'same_except_condition'
    && offer.constraintStatus === 'eligible'
    && (offer.shippingFee !== undefined || Boolean(offer.shipping && offer.shipping.status !== 'unknown'))
    && !unavailable(offer.availability);
}

export async function runMarketProviderCoverage(
  input: MarketProviderCoverageInput,
): Promise<MarketProviderCoverageResult> {
  const nowMs = input.nowMs ?? Date.now;
  const totalDeadlineMs = input.totalDeadlineMs ?? 45_000;
  const operationTimeoutMs = input.operationTimeoutMs ?? 10_000;
  const deadlineRunner = input.deadlineRunner ?? withDeadline;
  const startedAtMs = nowMs();
  const deadlineAtMs = startedAtMs + Math.max(0, totalDeadlineMs);
  const verificationCache = createVerificationCache<DirectPageResult>();
  const verificationSemaphore = createSemaphore(PROVIDER_CONCURRENCY.verification);
  const sellerExpansionSemaphore = createSemaphore(PROVIDER_CONCURRENCY.sellerExpansion);
  const sameDomainSemaphore = createKeyedSemaphore(PROVIDER_CONCURRENCY.sameDomain);

  const remainingMs = (): number => deadlineAtMs - nowMs();
  const timed = async <T>(task: () => Promise<T>): Promise<T> => {
    const remaining = remainingMs();
    if (remaining <= 0) throw new Error('ETIMEDOUT provider total deadline exceeded');
    return deadlineRunner(task, Math.min(operationTimeoutMs, remaining));
  };

  const cachedDirectPage = (url: string): Promise<DirectPageResult> => verificationCache.getOrLoad(
    url,
    () => verificationSemaphore.run(
      () => sameDomainSemaphore.run(hostname(url), () => timed(() => input.directPage(url))),
    ),
  );

  const results = await mapWithConcurrency(
    input.providers,
    PROVIDER_CONCURRENCY.discovery,
    async (provider): Promise<MarketProviderCoverageResult> => {
      if (remainingMs() <= 0) {
        const attempt = providerAttempt(provider, input.now, false);
        attempt.completedAt = input.now().toISOString();
        return { evidence: [], offers: [], attempts: [attempt] };
      }

      const attempt = providerAttempt(provider, input.now, true);
      const evidence: EvidenceItem[] = [];
      const offers: MarketOffer[] = [];
      const context: MarketProviderContext = {
        target: input.target,
        canonicalIdentity: input.canonicalIdentity,
        constraints: input.constraints,
        publicSearch: input.publicSearch,
        directPage: cachedDirectPage,
        now: input.now,
      };

      let discovered: DiscoveryCandidate[];
      try {
        discovered = (await timed(() => provider.discover(context))).slice(0, provider.budget.discovery);
      } catch (error) {
        const kind = providerFailureKind(error);
        if (input.legacyFallback && canUseLegacyFallback(kind)) {
          try {
            const fallback = await timed(() => input.legacyFallback!(provider));
            if (fallback) {
              const fallbackAttempt = fallback.attempt as ProviderAttemptDiagnostics;
              fallbackAttempt.providerId = provider.id;
              return {
                evidence: fallback.evidence,
                offers: deduplicateSellerOffers(fallback.offers),
                attempts: [fallbackAttempt],
              };
            }
          } catch (fallbackError) {
            rememberFailure(attempt, fallbackError);
            finishProviderAttempt(attempt, input.now);
            return { evidence, offers, attempts: [attempt] };
          }
        }
        rememberFailure(attempt, error);
        finishProviderAttempt(attempt, input.now);
        return { evidence, offers, attempts: [attempt] };
      }

      attempt.discovery.hitCount = discovered.length;
      const source = providerSource(provider);
      const ranked: Array<{ candidate: DiscoveryCandidate; verdict: 'exact' | 'same_except_condition' | 'uncertain'; score: number }> = [];

      for (const candidate of discovered) {
        let match;
        try {
          match = provider.identify(candidate, context);
        } catch (error) {
          rememberFailure(attempt, error);
          continue;
        }
        if (match.verdict === 'exact') attempt.identity.exact += 1;
        else if (match.verdict === 'uncertain' || match.verdict === 'same_except_condition') attempt.identity.uncertain += 1;
        else attempt.identity.different += 1;

        const hit = discoveryAsHit(candidate);
        const retrievedAt = input.now().toISOString();
        const preliminary = preliminaryOffer(hit, input.target, retrievedAt, match.verdict);
        if (preliminary) {
          preliminary.market = provider.market;
          preliminary.id = `${provider.market}:${candidate.url}:discovery`;
          offers.push(preliminary);
          attempt.offers.extracted += 1;
        }
        evidence.push(searchEvidence(source, hit, input.target, retrievedAt, match.verdict, match.confidence, preliminary));

        if (match.verdict === 'exact' || match.verdict === 'same_except_condition' || match.verdict === 'uncertain') {
          ranked.push({ candidate, verdict: match.verdict, score: match.confidence });
        }
      }

      ranked.sort((a, b) => verdictPriority(a.verdict) - verdictPriority(b.verdict) || b.score - a.score);
      const verificationCandidates: VerificationCandidate[] = [];

      if (provider.expandSellers) {
        const expansionResults = await mapWithConcurrency(
          ranked.filter((item) => item.verdict === 'exact'),
          PROVIDER_CONCURRENCY.sellerExpansion,
          async (item): Promise<{ original: DiscoveryCandidate; sellers: SellerCandidate[] }> => {
            if (remainingMs() <= 0) return { original: item.candidate, sellers: [] };
            try {
              attempt.comparisonPages = (attempt.comparisonPages ?? 0) + 1;
              const sellers = await sellerExpansionSemaphore.run(
                () => timed(() => provider.expandSellers!(item.candidate, context)),
              );
              return { original: item.candidate, sellers: sellers.slice(0, provider.budget.sellerExpansion) };
            } catch (error) {
              rememberFailure(attempt, error);
              return { original: item.candidate, sellers: [] };
            }
          },
        );

        for (const expansion of expansionResults) {
          if (expansion.sellers.length) {
            attempt.expandedSellers = (attempt.expandedSellers ?? 0) + expansion.sellers.length;
            verificationCandidates.push(...expansion.sellers);
          } else if (provider.id !== 'danawa' && provider.id !== 'enuri') {
            verificationCandidates.push(expansion.original);
          }
        }
      } else {
        verificationCandidates.push(...ranked.map((item) => item.candidate));
      }

      const uniqueCandidates: VerificationCandidate[] = [];
      const candidateUrls = new Set<string>();
      for (const candidate of verificationCandidates) {
        const url = directCandidateUrl(candidate);
        if (candidateUrls.has(url)) continue;
        candidateUrls.add(url);
        uniqueCandidates.push(candidate);
      }

      const selected = uniqueCandidates.slice(0, provider.budget.verification);
      await mapWithConcurrency(selected, PROVIDER_CONCURRENCY.verification, async (candidate) => {
        if (remainingMs() <= 0) return;
        attempt.verification.attempted += 1;
        try {
          const verified = await timed(() => provider.verify(candidate, context));
          attempt.verification.succeeded += 1;
          evidence.push(...verified.page.evidence);
          const offer = await provider.extractOffer(verified, context);
          if (!offer) return;
          offers.push(offer);
          attempt.offers.extracted += 1;
          if (offer.identityVerdict === 'exact') attempt.exactOffers = (attempt.exactOffers ?? 0) + 1;
          if (offer.eligible || alternativeVerified(offer)) {
            attempt.offers.eligible += 1;
            attempt.eligibleSellers = (attempt.eligibleSellers ?? 0) + 1;
          }
        } catch (error) {
          rememberFailure(attempt, error, true);
        }
      });

      finishProviderAttempt(attempt, input.now);
      return { evidence, offers, attempts: [attempt] };
    },
  );

  return {
    evidence: results.flatMap((result) => result.evidence),
    offers: deduplicateSellerOffers(results.flatMap((result) => result.offers)),
    attempts: results.flatMap((result) => result.attempts),
  };
}
