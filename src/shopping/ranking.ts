import type { MarketOffer } from '../core/types.ts';
import {
  aggregateReviewConsensus,
  deduplicateReviewEvidence,
  type ReviewConsensus,
  type ReviewEvidence,
} from './review-intelligence.ts';
import type { ShoppingCandidate, ShoppingResearchPlan } from './types.ts';
import { assessValue, type PriceStatus } from './value-model.ts';

export interface ShoppingConfidenceDimensions {
  identity: number;
  hardConstraints: number;
  officialSpecs: number;
  reviewConsensus: number;
  negativeCoverage: number;
  priceVerification: number;
  durability: number;
  serviceWarranty: number;
  personalization: number;
}

export interface CandidateAssessment {
  candidate: ShoppingCandidate;
  dimensionScores: Record<string, number>;
  recommendationScore: number;
  evidenceConfidence: number;
  confidenceDimensions: ShoppingConfidenceDimensions;
  strengths: string[];
  tradeoffs: string[];
  negativeSignals: string[];
  evidenceUrls: string[];
  verifiedCashPrice?: number;
}

export interface RankShoppingInput {
  plan: ShoppingResearchPlan;
  candidates: ShoppingCandidate[];
  reviews: ReviewEvidence[];
  offers?: MarketOffer[];
  personalizationAvailable?: boolean;
}

interface CandidateEconomics {
  verifiedCashPrice?: number;
  indicativePrice?: number;
  priceStatus: PriceStatus;
  priceConfidence: number;
  offerUrls: string[];
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function numericFact(candidate: ShoppingCandidate, field: string): number | undefined {
  const value = candidate.facts[field]?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanFact(candidate: ShoppingCandidate, field: string): boolean | undefined {
  const value = candidate.facts[field]?.value;
  return typeof value === 'boolean' ? value : undefined;
}

function stringFact(candidate: ShoppingCandidate, field: string): string | undefined {
  const value = candidate.facts[field]?.value;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function reviewMap(reviews: ReviewEvidence[]): Map<string, ReviewConsensus> {
  return new Map(aggregateReviewConsensus(reviews).map((item) => [item.topic, item]));
}

function reviewDirection(consensus: ReviewConsensus | undefined): number {
  if (!consensus) return 0;
  const total = consensus.positiveWeight + consensus.negativeWeight;
  if (total <= 0) return 0;
  return clamp(consensus.positiveWeight / total) * 2 - 1;
}

function reviewQuality(consensus: ReviewConsensus | undefined, fallback = 0.5): number {
  if (!consensus) return fallback;
  const direction = reviewDirection(consensus);
  return clamp(fallback + direction * 0.32 * Math.max(0.35, consensus.confidence));
}

function comparableText(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
}

function offerMatchesCandidate(offer: MarketOffer, candidate: ShoppingCandidate): boolean {
  if (offer.condition !== candidate.condition && !(offer.condition === 'unknown' && candidate.condition === 'new')) return false;
  const haystack = comparableText(`${offer.title} ${offer.url}`);
  const model = comparableText(candidate.model);
  if (model) return haystack.includes(model);
  const titleTokens = comparableText(candidate.title).slice(0, 16);
  return Boolean(titleTokens && haystack.includes(titleTokens));
}

function exactEnoughOffer(offer: MarketOffer): boolean {
  if (offer.verification !== 'page_verified' && offer.verification !== 'checkout_verified') return false;
  if (offer.identityVerdict && offer.identityVerdict !== 'exact') return false;
  if (offer.identityScore < 0.8 || !offer.bundleComplete) return false;
  if (offer.constraintStatus === 'excluded') return false;
  return true;
}

function decisiveCashOffer(offer: MarketOffer): boolean {
  if (!exactEnoughOffer(offer) || !offer.eligible) return false;
  if (offer.shipping?.status === 'unknown') return false;
  if (offer.fieldVerification?.shipping === 'search_metadata' || offer.fieldVerification?.price === 'search_metadata') return false;
  return typeof offer.totalCashPrice === 'number' && Number.isFinite(offer.totalCashPrice) && offer.totalCashPrice > 0;
}

function publicIndicativePrice(offer: MarketOffer): number | undefined {
  if (!exactEnoughOffer(offer)) return undefined;
  const values = [offer.totalCashPrice, offer.salePrice, offer.couponPrice, offer.listPrice]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  return values[0];
}

function economicsFor(candidate: ShoppingCandidate, offers: MarketOffer[]): CandidateEconomics {
  const matching = offers.filter((offer) => offerMatchesCandidate(offer, candidate));
  const decisive = matching
    .filter(decisiveCashOffer)
    .sort((a, b) => (a.totalCashPrice ?? Infinity) - (b.totalCashPrice ?? Infinity))[0];
  const indicative = matching
    .map((offer) => ({ offer, amount: publicIndicativePrice(offer) }))
    .filter((item): item is { offer: MarketOffer; amount: number } => item.amount !== undefined)
    .sort((a, b) => a.amount - b.amount)[0];

  if (decisive?.totalCashPrice !== undefined) {
    return {
      verifiedCashPrice: decisive.totalCashPrice,
      ...(indicative ? { indicativePrice: indicative.amount } : {}),
      priceStatus: 'verified',
      priceConfidence: 0.95,
      offerUrls: [...new Set(matching.map((offer) => offer.url))],
    };
  }
  if (indicative) {
    return {
      indicativePrice: indicative.amount,
      priceStatus: 'indicative',
      priceConfidence: 0.45,
      offerUrls: [...new Set(matching.map((offer) => offer.url))],
    };
  }
  return {
    priceStatus: 'unknown',
    priceConfidence: 0,
    offerUrls: [...new Set(matching.map((offer) => offer.url))],
  };
}

function portableDisplayScores(
  candidate: ShoppingCandidate,
  reviews: Map<string, ReviewConsensus>,
  value: number,
): Record<string, number> {
  const fit = candidate.constraintState === 'ELIGIBLE' ? 1 : 0.62;
  const resolution = stringFact(candidate, 'resolution')?.toUpperCase();
  const brightness = numericFact(candidate, 'brightnessNits');
  const refresh = numericFact(candidate, 'refreshRateHz');
  let displayQuality = resolution === '4K' ? 0.67 : resolution ? 0.42 : 0.55;
  if (brightness !== undefined) displayQuality += brightness >= 500 ? 0.18 : brightness >= 350 ? 0.1 : brightness < 300 ? -0.08 : 0;
  if (refresh !== undefined) displayQuality += refresh >= 120 ? 0.12 : refresh >= 60 ? 0.04 : 0;
  displayQuality = clamp(displayQuality * 0.82 + reviewQuality(reviews.get('display_quality'), 0.55) * 0.18);

  let mobility = booleanFact(candidate, 'portableStand') === true ? 0.78 : 0.52;
  mobility = clamp(mobility * 0.72 + reviewQuality(reviews.get('stand_stability'), 0.55) * 0.28);

  const smartFeatures = booleanFact(candidate, 'smartOs') === true ? 0.86 : 0.55;
  const durabilityReview = reviews.get('durability');
  const standReview = reviews.get('stand_stability');
  const buildDurability = clamp(reviewQuality(durabilityReview, 0.56) * 0.65 + reviewQuality(standReview, 0.56) * 0.35);

  const warrantyMonths = numericFact(candidate, 'warrantyMonths');
  const serviceReview = reviews.get('service_quality');
  let warrantyBase = warrantyMonths !== undefined ? (warrantyMonths >= 24 ? 0.9 : warrantyMonths >= 12 ? 0.74 : 0.58) : 0.48;
  warrantyBase = clamp(warrantyBase * 0.8 + reviewQuality(serviceReview, 0.55) * 0.2);

  const reviewConsensus = aggregateCategoryReviewScore(reviews);
  return { fit, displayQuality, mobility, smartFeatures, buildDurability, serviceWarranty: warrantyBase, reviewConsensus, value };
}

function beddingScores(
  candidate: ShoppingCandidate,
  reviews: Map<string, ReviewConsensus>,
  value: number,
): Record<string, number> {
  const fit = candidate.constraintState === 'ELIGIBLE' ? 1 : 0.62;
  const fabric = stringFact(candidate, 'fabric')?.toLowerCase() ?? '';
  const fill = stringFact(candidate, 'fillMaterial')?.toLowerCase() ?? '';
  let fabricFillQuality = 0.55;
  if (/(모달|tencel|텐셀|고밀도|순면|cotton|구스|down)/i.test(`${fabric} ${fill}`)) fabricFillQuality += 0.18;
  if (numericFact(candidate, 'fillWeightG') !== undefined) fabricFillQuality += 0.06;
  fabricFillQuality = clamp(fabricFillQuality);

  const tactileComfort = reviewQuality(reviews.get('fabric_softness'), 0.56);
  const seasonalComfort = booleanFact(candidate, 'allSeason') === true ? 0.82 : 0.55;
  const washingReview = reviews.get('washing_durability');
  const care = clamp((booleanFact(candidate, 'machineWashable') === true ? 0.82 : 0.58) * 0.65 + reviewQuality(washingReview, 0.56) * 0.35);
  const durability = clamp(reviewQuality(washingReview, 0.56) * 0.55 + reviewQuality(reviews.get('durability'), 0.56) * 0.45);
  const allergySafety = booleanFact(candidate, 'allergyFriendly') === true ? 0.82 : reviewQuality(reviews.get('dust_shedding'), 0.52);
  const reviewConsensus = aggregateCategoryReviewScore(reviews);
  return { fit, fabricFillQuality, tactileComfort, seasonalComfort, care, durability, allergySafety, reviewConsensus, value };
}

function aggregateCategoryReviewScore(consensus: Map<string, ReviewConsensus>): number {
  if (!consensus.size) return 0.5;
  const values = [...consensus.values()].map((item) => reviewQuality(item, 0.5));
  return clamp(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function weightedScore(weights: Record<string, number>, dimensions: Record<string, number>): number {
  let weighted = 0;
  let weight = 0;
  for (const [dimension, configuredWeight] of Object.entries(weights)) {
    const score = dimensions[dimension];
    if (score === undefined) continue;
    weighted += score * configuredWeight;
    weight += configuredWeight;
  }
  return weight > 0 ? clamp(weighted / weight) : 0;
}

function meritScore(weights: Record<string, number>, dimensions: Record<string, number>): number {
  return weightedScore(
    Object.fromEntries(Object.entries(weights).filter(([dimension]) => dimension !== 'value')),
    dimensions,
  );
}

function confidenceDimensions(
  candidate: ShoppingCandidate,
  candidateReviews: ReviewEvidence[],
  economics: CandidateEconomics,
  personalizationAvailable: boolean,
): ShoppingConfidenceDimensions {
  const deduped = deduplicateReviewEvidence(candidateReviews);
  const consensus = aggregateReviewConsensus(deduped);
  const reviewConfidence = consensus.length
    ? clamp(consensus.reduce((sum, item) => sum + item.confidence, 0) / consensus.length)
    : 0;
  const verifiedFacts = Object.values(candidate.facts).filter((fact) => fact.verification !== 'search_metadata');
  const officialFacts = verifiedFacts.filter((fact) => fact.verification === 'official');
  const officialSpecs = verifiedFacts.length
    ? clamp(0.45 + Math.min(0.5, verifiedFacts.length * 0.07) + Math.min(0.15, officialFacts.length * 0.05))
    : 0;
  const negativeIndependent = deduped.filter((item) => item.polarity === 'negative').length;
  const durabilityEvidence = deduped.filter((item) => ['durability', 'washing_durability', 'stand_stability'].includes(item.topic));
  const serviceFact = candidate.facts.warrantyMonths;
  const serviceReviews = deduped.filter((item) => item.topic === 'service_quality');

  return {
    identity: candidate.model ? clamp(0.82 + Math.min(0.12, candidate.sourceUrls.length * 0.03)) : clamp(0.5 + candidate.discoveryScore * 0.25),
    hardConstraints: candidate.constraintState === 'ELIGIBLE' ? 1 : candidate.constraintState === 'PRELIMINARY' ? 0.45 : 0,
    officialSpecs,
    reviewConsensus: reviewConfidence,
    negativeCoverage: clamp(negativeIndependent >= 3 ? 0.9 : negativeIndependent === 2 ? 0.75 : negativeIndependent === 1 ? 0.45 : deduped.length ? 0.3 : 0),
    priceVerification: economics.priceConfidence,
    durability: durabilityEvidence.length >= 2 ? 0.78 : durabilityEvidence.length === 1 ? 0.5 : 0.15,
    serviceWarranty: serviceFact?.verification === 'official' ? 0.9 : serviceFact ? 0.68 : serviceReviews.length ? 0.5 : 0.15,
    personalization: personalizationAvailable ? 0.9 : 0,
  };
}

function overallEvidenceConfidence(dimensions: ShoppingConfidenceDimensions): number {
  return clamp(
    dimensions.identity * 0.18 +
    dimensions.hardConstraints * 0.18 +
    dimensions.officialSpecs * 0.17 +
    dimensions.reviewConsensus * 0.17 +
    dimensions.negativeCoverage * 0.08 +
    dimensions.priceVerification * 0.08 +
    dimensions.durability * 0.07 +
    dimensions.serviceWarranty * 0.07,
  );
}

function productEvidenceConfidence(dimensions: ShoppingConfidenceDimensions): number {
  const weighted =
    dimensions.identity * 0.18 +
    dimensions.hardConstraints * 0.18 +
    dimensions.officialSpecs * 0.17 +
    dimensions.reviewConsensus * 0.17 +
    dimensions.negativeCoverage * 0.08 +
    dimensions.durability * 0.07 +
    dimensions.serviceWarranty * 0.07;
  return clamp(weighted / 0.92);
}

function evidenceUrls(candidate: ShoppingCandidate, reviews: ReviewEvidence[], economics: CandidateEconomics): string[] {
  return [...new Set([
    ...candidate.sourceUrls,
    ...Object.values(candidate.facts).map((fact) => fact.sourceUrl),
    ...reviews.map((review) => review.sourceUrl),
    ...economics.offerUrls,
  ].filter(Boolean))];
}

function explanation(
  dimensions: Record<string, number>,
  reviews: Map<string, ReviewConsensus>,
  economics: CandidateEconomics,
): { strengths: string[]; tradeoffs: string[]; negativeSignals: string[] } {
  const strengths = Object.entries(dimensions)
    .filter(([dimension, score]) => dimension !== 'value' && score >= 0.72)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([dimension]) => dimension);
  const negativeSignals = [...reviews.values()]
    .filter((item) => item.negativeWeight > item.positiveWeight && item.independentSources >= 2)
    .sort((a, b) => b.confidence - a.confidence)
    .map((item) => item.topic);
  const tradeoffs: string[] = [];
  if (economics.priceStatus !== 'verified') tradeoffs.push('verified_cash_price_unavailable');
  if (!reviews.size) tradeoffs.push('independent_review_evidence_sparse');
  if (negativeSignals.length) tradeoffs.push(...negativeSignals.map((topic) => `negative:${topic}`));
  return { strengths, tradeoffs, negativeSignals };
}

export function rankShoppingCandidates(input: RankShoppingInput): CandidateAssessment[] {
  const candidates = input.candidates.filter((candidate) => candidate.constraintState === 'ELIGIBLE');
  const offers = input.offers ?? [];
  const dedupedReviews = deduplicateReviewEvidence(input.reviews);
  const economics = new Map(candidates.map((candidate) => [candidate.key, economicsFor(candidate, offers)]));
  const priceCohort = candidates
    .map((candidate) => {
      const item = economics.get(candidate.key);
      return item?.verifiedCashPrice ?? item?.indicativePrice;
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  const assessments = candidates.map((candidate): CandidateAssessment => {
    const candidateReviews = dedupedReviews.filter((review) => review.candidateKey === candidate.key);
    const consensus = reviewMap(candidateReviews);
    const candidateEconomics = economics.get(candidate.key)!;
    const confidence = confidenceDimensions(candidate, candidateReviews, candidateEconomics, Boolean(input.personalizationAvailable));
    const evidenceConfidence = overallEvidenceConfidence(confidence);

    const preliminaryDimensions = input.plan.categoryId === 'portable_display'
      ? portableDisplayScores(candidate, consensus, 0)
      : input.plan.categoryId === 'bedding'
        ? beddingScores(candidate, consensus, 0)
        : { fit: 1, quality: 0.55, reviewConsensus: aggregateCategoryReviewScore(consensus), serviceWarranty: 0.5, value: 0 };
    const merit = meritScore(input.plan.dimensionWeights, preliminaryDimensions);
    const visiblePrice = candidateEconomics.verifiedCashPrice ?? candidateEconomics.indicativePrice;
    // Purchase-price certainty is kept out of product merit. If the exact page exposes the
    // same item price but shipping is unresolved, recommendation merit remains unchanged;
    // only priceVerification confidence and best-value eligibility are downgraded later.
    const rankingValue = assessValue({
      merit,
      evidenceConfidence: productEvidenceConfidence(confidence),
      priceStatus: visiblePrice !== undefined ? 'verified' : 'unknown',
      ...(visiblePrice !== undefined ? { price: visiblePrice } : {}),
      cohortPrices: priceCohort,
    });
    const dimensionScores = { ...preliminaryDimensions, value: rankingValue.qualityAdjustedValue };
    const recommendationScore = weightedScore(input.plan.dimensionWeights, dimensionScores);
    const explanations = explanation(dimensionScores, consensus, candidateEconomics);
    const assessment: CandidateAssessment = {
      candidate,
      dimensionScores,
      recommendationScore,
      evidenceConfidence,
      confidenceDimensions: confidence,
      strengths: explanations.strengths,
      tradeoffs: explanations.tradeoffs,
      negativeSignals: explanations.negativeSignals,
      evidenceUrls: evidenceUrls(candidate, candidateReviews, candidateEconomics),
    };
    if (candidateEconomics.verifiedCashPrice !== undefined) assessment.verifiedCashPrice = candidateEconomics.verifiedCashPrice;
    return assessment;
  });

  return assessments
    .sort((a, b) => b.recommendationScore - a.recommendationScore || b.evidenceConfidence - a.evidenceConfidence || a.candidate.key.localeCompare(b.candidate.key))
    .slice(0, 5);
}
