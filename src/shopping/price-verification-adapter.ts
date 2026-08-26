import type { MarketOffer } from '../core/types.ts';
import type { CandidateAssessment } from './ranking.ts';

export type ShoppingPriceVerificationScope = 'targeted' | 'full';

export interface ShoppingPriceVerificationResult {
  candidateKey: string;
  scope: ShoppingPriceVerificationScope;
  offers: MarketOffer[];
  errors: string[];
}

export type ShoppingPriceVerifier = (
  assessment: CandidateAssessment,
  scope: ShoppingPriceVerificationScope,
) => Promise<ShoppingPriceVerificationResult>;

export interface FinalistPriceVerification {
  candidateKey: string;
  targeted?: ShoppingPriceVerificationResult;
  full?: ShoppingPriceVerificationResult;
  offers: MarketOffer[];
  errors: string[];
}

function mergeOffers(results: ShoppingPriceVerificationResult[]): MarketOffer[] {
  const byId = new Map<string, MarketOffer>();
  for (const result of results) {
    for (const offer of result.offers) {
      const key = offer.id || `${offer.market}|${offer.url}|${offer.totalCashPrice ?? offer.salePrice ?? ''}`;
      const current = byId.get(key);
      if (!current || (offer.verification === 'checkout_verified' && current.verification !== 'checkout_verified')) {
        byId.set(key, offer);
      }
    }
  }
  return [...byId.values()];
}

export function shouldExpandFullVerification(finalists: CandidateAssessment[]): boolean {
  if (finalists.length <= 3) return false;
  const top3 = finalists.slice(0, 3);
  const third = finalists[2];
  const fourth = finalists[3];
  const closeMargin = Boolean(third && fourth && (third.recommendationScore - fourth.recommendationScore) <= 0.05);
  const verifiedCashCount = top3.filter((item) => item.verifiedCashPrice !== undefined).length;
  const weakPriceConfidence = top3.some((item) => item.confidenceDimensions.priceVerification < 0.7);
  return closeMargin || verifiedCashCount < 2 || weakPriceConfidence;
}

async function safeVerify(
  assessment: CandidateAssessment,
  scope: ShoppingPriceVerificationScope,
  verifier: ShoppingPriceVerifier,
): Promise<ShoppingPriceVerificationResult> {
  try {
    const result = await verifier(assessment, scope);
    return {
      candidateKey: assessment.candidate.key,
      scope,
      offers: Array.isArray(result.offers) ? result.offers : [],
      errors: Array.isArray(result.errors) ? result.errors : [],
    };
  } catch (error) {
    return {
      candidateKey: assessment.candidate.key,
      scope,
      offers: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function verifyFinalistPrices(
  finalists: CandidateAssessment[],
  verifier: ShoppingPriceVerifier,
): Promise<FinalistPriceVerification[]> {
  const bounded = finalists.slice(0, 5);
  const targeted = await Promise.all(bounded.map((item) => safeVerify(item, 'targeted', verifier)));
  const fullCount = shouldExpandFullVerification(bounded) ? bounded.length : Math.min(3, bounded.length);
  const full = await Promise.all(bounded.slice(0, fullCount).map((item) => safeVerify(item, 'full', verifier)));

  return bounded.map((assessment) => {
    const targetedResult = targeted.find((item) => item.candidateKey === assessment.candidate.key);
    const fullResult = full.find((item) => item.candidateKey === assessment.candidate.key);
    const collected = [targetedResult, fullResult].filter((item): item is ShoppingPriceVerificationResult => Boolean(item));
    const result: FinalistPriceVerification = {
      candidateKey: assessment.candidate.key,
      offers: mergeOffers(collected),
      errors: collected.flatMap((item) => item.errors),
    };
    if (targetedResult) result.targeted = targetedResult;
    if (fullResult) result.full = fullResult;
    return result;
  });
}
