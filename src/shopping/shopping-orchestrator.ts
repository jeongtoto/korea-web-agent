import type { PurchaseContext } from '../core/types.ts';
import type { DirectPageResult } from '../providers/direct-page.ts';
import type { SearchHit } from '../providers/index.ts';
import { normalizeShoppingCandidates } from './candidate-normalizer.ts';
import { deepResearchCandidates } from './deep-research.ts';
import { discoverShoppingCandidates } from './discovery.ts';
import { lightEnrichCandidates } from './light-enrichment.ts';
import {
  verifyFinalistPrices,
  type ShoppingPriceVerifier,
} from './price-verification-adapter.ts';
import { planShoppingResearch } from './query-planner.ts';
import { rankShoppingCandidates, type CandidateAssessment } from './ranking.ts';
import type { ShoppingCandidate, ShoppingResearchPlan } from './types.ts';

export type ShoppingResearchStage =
  | 'PLANNING'
  | 'DISCOVERY'
  | 'NORMALIZATION'
  | 'LIGHT_ENRICHMENT'
  | 'DEEP_RESEARCH'
  | 'PRICE_VERIFICATION'
  | 'RANKING'
  | 'COMPLETE';

export interface ShoppingResearchProgress {
  rawHits: number;
  normalizedCandidates: number;
  eligibleCandidates: number;
  lightEnrichmentTotal: number;
  deepResearchCompleted: number;
  deepResearchTotal: number;
  priceVerificationCompleted: number;
  priceVerificationTotal: number;
}

export interface ShoppingResearchDependencies {
  publicSearch: (query: string) => Promise<SearchHit[]>;
  directPage: (url: string) => Promise<DirectPageResult>;
  priceVerifier: ShoppingPriceVerifier;
  now: () => Date;
  personalizationAvailable?: boolean;
}

export interface ShoppingResearchResult {
  plan: ShoppingResearchPlan;
  stage: ShoppingResearchStage;
  stageHistory: ShoppingResearchStage[];
  progress: ShoppingResearchProgress;
  candidates: ShoppingCandidate[];
  assessments: CandidateAssessment[];
  errors: string[];
  partial: boolean;
}

function stage(history: ShoppingResearchStage[], value: ShoppingResearchStage): void {
  if (history.at(-1) !== value) history.push(value);
}

function emptyProgress(): ShoppingResearchProgress {
  return {
    rawHits: 0,
    normalizedCandidates: 0,
    eligibleCandidates: 0,
    lightEnrichmentTotal: 0,
    deepResearchCompleted: 0,
    deepResearchTotal: 0,
    priceVerificationCompleted: 0,
    priceVerificationTotal: 0,
  };
}

function preliminaryOrder(candidates: ShoppingCandidate[], limit: number): ShoppingCandidate[] {
  return candidates
    .filter((candidate) => candidate.constraintState !== 'EXCLUDED')
    .sort((a, b) => {
      if (a.constraintState !== b.constraintState) return a.constraintState === 'ELIGIBLE' ? -1 : 1;
      return b.discoveryScore - a.discoveryScore || a.key.localeCompare(b.key);
    })
    .slice(0, limit);
}

export async function runShoppingResearch(
  query: string,
  purchaseContext: PurchaseContext | undefined,
  deps: ShoppingResearchDependencies,
): Promise<ShoppingResearchResult> {
  const stageHistory: ShoppingResearchStage[] = [];
  const progress = emptyProgress();
  const errors: string[] = [];

  stage(stageHistory, 'PLANNING');
  const plan = planShoppingResearch(query, purchaseContext);

  stage(stageHistory, 'DISCOVERY');
  const rawHits = await discoverShoppingCandidates(plan, deps.publicSearch);
  progress.rawHits = rawHits.length;

  stage(stageHistory, 'NORMALIZATION');
  const normalized = normalizeShoppingCandidates(rawHits, plan);
  progress.normalizedCandidates = normalized.length;

  stage(stageHistory, 'LIGHT_ENRICHMENT');
  const enrichmentTargets = normalized
    .filter((candidate) => candidate.constraintState !== 'EXCLUDED')
    .slice(0, plan.limits.lightEnrichment);
  progress.lightEnrichmentTotal = enrichmentTargets.length;
  const enriched = await lightEnrichCandidates(plan, normalized, {
    publicSearch: deps.publicSearch,
    directPage: async (url) => {
      try {
        return await deps.directPage(url);
      } catch (error) {
        errors.push(`light_enrichment:${url}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },
  });
  progress.eligibleCandidates = enriched.filter((candidate) => candidate.constraintState === 'ELIGIBLE').length;

  const shortlist = preliminaryOrder(enriched, plan.limits.shortlist);
  const finalists = shortlist.slice(0, plan.limits.deepResearch);

  stage(stageHistory, 'DEEP_RESEARCH');
  progress.deepResearchTotal = finalists.length;
  const deep = await deepResearchCandidates(plan, finalists, {
    publicSearch: deps.publicSearch,
    now: deps.now,
  });
  progress.deepResearchCompleted = deep.researchedCandidateKeys.length;
  errors.push(...deep.errors.map((error) => `deep_research:${error}`));

  for (const candidate of finalists) {
    const urls = deep.sourceUrlsByCandidate[candidate.key] ?? [];
    for (const url of urls) {
      if (!candidate.sourceUrls.includes(url)) candidate.sourceUrls.push(url);
    }
  }

  const beforePrice = rankShoppingCandidates({
    plan,
    candidates: finalists,
    reviews: deep.reviewEvidence,
    offers: [],
    personalizationAvailable: Boolean(deps.personalizationAvailable),
  });

  stage(stageHistory, 'PRICE_VERIFICATION');
  const verified = await verifyFinalistPrices(beforePrice, deps.priceVerifier);
  progress.priceVerificationTotal = verified.length;
  progress.priceVerificationCompleted = verified.length;
  const offers = verified.flatMap((item) => item.offers);
  for (const item of verified) {
    errors.push(...item.errors.map((error) => `price_verification:${item.candidateKey}: ${error}`));
  }

  stage(stageHistory, 'RANKING');
  const assessments = rankShoppingCandidates({
    plan,
    candidates: finalists,
    reviews: deep.reviewEvidence,
    offers,
    personalizationAvailable: Boolean(deps.personalizationAvailable),
  });

  stage(stageHistory, 'COMPLETE');
  return {
    plan,
    stage: 'COMPLETE',
    stageHistory,
    progress,
    candidates: enriched,
    assessments,
    errors,
    partial: errors.length > 0,
  };
}
