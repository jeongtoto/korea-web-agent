export type PriceStatus = 'verified' | 'indicative' | 'unknown';

export interface ValueAssessment {
  priceStatus: PriceStatus;
  priceConfidence: number;
  priceBurden: number;
  qualityAdjustedValue: number;
  bestValueEligible: boolean;
}

export interface AssessValueInput {
  merit: number;
  evidenceConfidence: number;
  priceStatus: PriceStatus;
  price?: number;
  cohortPrices: number[];
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function validPrice(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function priceAdvantage(price: number | undefined, cohortPrices: number[]): number {
  if (!validPrice(price)) return 0.6;
  const cohort = cohortPrices.filter(validPrice);
  if (!cohort.length) return 0.8;
  const min = Math.min(...cohort);
  const max = Math.max(...cohort);
  if (max <= min) return 0.8;
  const relative = clamp((price - min) / (max - min));
  return clamp(1 - 0.4 * relative);
}

export function assessValue(input: AssessValueInput): ValueAssessment {
  const merit = clamp(input.merit);
  const evidenceConfidence = clamp(input.evidenceConfidence);
  const meritAdjusted = merit * (0.75 + 0.25 * evidenceConfidence);
  const advantage = priceAdvantage(input.price, input.cohortPrices);

  if (input.priceStatus === 'verified' && validPrice(input.price)) {
    return {
      priceStatus: 'verified',
      priceConfidence: 0.95,
      priceBurden: clamp(1 - advantage),
      qualityAdjustedValue: clamp(0.72 * meritAdjusted + 0.28 * advantage),
      bestValueEligible: true,
    };
  }

  if (input.priceStatus === 'indicative' && validPrice(input.price)) {
    return {
      priceStatus: 'indicative',
      priceConfidence: 0.45,
      priceBurden: clamp(1 - advantage),
      qualityAdjustedValue: clamp(0.82 * meritAdjusted + 0.18 * advantage),
      bestValueEligible: false,
    };
  }

  return {
    priceStatus: 'unknown',
    priceConfidence: 0,
    priceBurden: 1,
    qualityAdjustedValue: clamp(0.9 * meritAdjusted),
    bestValueEligible: false,
  };
}
