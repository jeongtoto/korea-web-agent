import type { OfferCondition } from '../core/types.ts';
import type { PriceStatus } from './value-model.ts';

export type ShoppingMode = 'EXACT_PRODUCT' | 'COMPARISON' | 'RECOMMENDATION';

export type ShoppingCategoryId = 'portable_display' | 'bedding' | 'unknown';

export type ShoppingConstraintState = 'ELIGIBLE' | 'PRELIMINARY' | 'EXCLUDED';

export type ShoppingConstraintOperator = 'eq' | 'min' | 'max' | 'includes';

export type RecommendationTier =
  | 'STRONG_RECOMMENDATION'
  | 'RECOMMENDED'
  | 'PROMISING_NEEDS_VERIFICATION'
  | 'CAUTION';

export interface RecommendationRationale {
  whyItRanks: string[];
  bestFor: string[];
  tradeoffs: string[];
  evidenceGaps: string[];
  repeatedNegativeTopics: string[];
  priceStatus: PriceStatus;
  bestValueEligible: boolean;
}

export interface ShoppingConstraint {
  id: string;
  field: string;
  operator: ShoppingConstraintOperator;
  expected: string | number | boolean | string[];
  strength: 'hard' | 'soft';
}

export interface ShoppingPreference {
  dimension: string;
  weight: number;
  evidence: string;
}

export interface DiscoveryQuery {
  id: string;
  query: string;
  maxHits: number;
  sourceGroup: 'general' | 'market' | 'official' | 'review';
}

export interface ShoppingStageLimits {
  rawHits: number;
  normalizedCandidates: number;
  lightEnrichment: number;
  shortlist: number;
  deepResearch: number;
  fullPriceVerification: number;
}

export interface ShoppingResearchPlan {
  mode: ShoppingMode;
  categoryId: ShoppingCategoryId;
  budget?: {
    max: number;
    strength: 'hard' | 'soft';
  };
  hardConstraints: ShoppingConstraint[];
  preferences: ShoppingPreference[];
  dimensionWeights: Record<string, number>;
  discoveryQueries: DiscoveryQuery[];
  limits: ShoppingStageLimits;
}

export interface ShoppingRawHit {
  queryId: string;
  title: string;
  url: string;
  snippet: string;
  sourceGroup: DiscoveryQuery['sourceGroup'];
}

export interface FactValue {
  value: string | number | boolean | string[];
  verification: 'search_metadata' | 'page_verified' | 'official';
  sourceUrl: string;
}

export interface ShoppingCandidate {
  key: string;
  family?: string;
  brand?: string;
  model?: string;
  variant: Record<string, string | number | boolean>;
  bundle: string[];
  condition: OfferCondition;
  title: string;
  sourceUrls: string[];
  discoveryScore: number;
  facts: Record<string, FactValue>;
  constraintState: ShoppingConstraintState;
}
