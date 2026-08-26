export const EVIDENCE_CLASSES = [
  'official_record',
  'accredited_test',
  'peer_reviewed_research',
  'manufacturer_spec',
  'retailer_listing',
  'verified_purchase_review',
  'community_report',
  'editorial_review',
  'sponsored_content',
  'inferred_analysis',
] as const;

export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const ACQUISITION_METHODS = [
  'official_api',
  'search_metadata',
  'static_html',
  'structured_data',
  'crawler',
  'playwright',
  'ai_browser',
  'local_relay',
] as const;

export type AcquisitionMethod = (typeof ACQUISITION_METHODS)[number];

export const REPORT_DECISIONS = ['BUY', 'WAIT', 'SKIP', 'INSUFFICIENT'] as const;
export type ReportDecision = (typeof REPORT_DECISIONS)[number];

export type ProductSpecificity = 'exact_product' | 'category' | 'general_mechanism';
export type ProductMatchLevel = 'exact_product' | 'probable_product' | 'category' | 'general_mechanism' | 'unrelated';

export interface ResearchIntent {
  productResearch: boolean;
  purchaseDecision: boolean;
  priceSensitive: boolean;
  personalizedPriceUseful: boolean;
  specOnly: boolean;
}

export interface EvidenceItem {
  claim: string;
  sourceUrl: string;
  sourceType: string;
  publishedAt?: string;
  retrievedAt: string;
  acquisitionMethod: AcquisitionMethod;
  evidenceClass: EvidenceClass;
  independenceKey: string;
  confidence: number;
  notes?: string;
  specificity?: ProductSpecificity;
  sponsored?: boolean;
  data?: Record<string, unknown>;
}

export interface NormalizedTarget {
  kind: 'product' | 'place' | 'service' | 'unknown';
  brand?: string;
  name?: string;
  model?: string;
  variant?: string;
  productId?: string;
  liveId?: string;
  sourceHost?: string;
  canonicalUrl?: string;
}

export interface CanonicalComponent {
  type: string;
  model?: string;
  version?: string;
  quantity?: number;
  aliases?: string[];
}

export interface CanonicalProductIdentity {
  kind: 'product';
  brand?: string;
  family?: string;
  primary: {
    model?: string;
    size?: string;
    generation?: string;
    capacity?: string;
    color?: string;
  };
  requiredComponents: CanonicalComponent[];
  optionalComponents: CanonicalComponent[];
  condition: OfferCondition | 'any';
  domesticModel?: boolean;
  installationType?: string;
  source: {
    question: string;
    url?: string;
    confidence: number;
  };
}

export type IdentityVerdict = 'exact' | 'same_except_condition' | 'uncertain' | 'different';

export interface CanonicalIdentityMatch {
  verdict: IdentityVerdict;
  matched: string[];
  missing: string[];
  conflicts: string[];
  confidence: number;
}

export type RequirementStrength = 'hard' | 'soft';
export type ConstraintVerification = 'verified_pass' | 'verified_fail' | 'unknown';

export interface ProductConstraint {
  id: string;
  label: string;
  strength: RequirementStrength;
  kind: 'dimension_min' | 'boolean_required' | 'enum_allowed' | 'text_required';
  field: string;
  expected: string | number | boolean | string[];
  source: 'user' | 'resolved_identity';
}

export interface ConstraintEvaluation {
  constraint: ProductConstraint;
  status: ConstraintVerification;
  evidence?: string;
}

export interface ProductMatchResult {
  level: ProductMatchLevel;
  score: number;
  matchedTokens: string[];
  missingTokens: string[];
}

export interface ProductCandidate {
  target: NormalizedTarget;
  score: number;
  sourceUrls: string[];
  title: string;
  verifiedFacts?: Record<string, unknown>;
}

export interface ProductResolution {
  target: NormalizedTarget;
  confidence: number;
  ambiguous: boolean;
  candidates: ProductCandidate[];
  identityEvidence: Array<{ title: string; url: string; score: number }>;
  canonicalIdentity?: CanonicalProductIdentity;
}

export interface ResearchContext {
  intent?: ResearchIntent;
  identityConfidence?: number;
  resolvedTarget?: NormalizedTarget;
  canonicalIdentity?: CanonicalProductIdentity;
  resolutionAmbiguous?: boolean;
  recommendationMode?: boolean;
  recommendationCandidates?: ProductCandidate[];
}

export interface ResearchRequest {
  question: string;
  url?: string;
  category?: 'product' | 'place' | 'service' | 'auto';
  includeLocalRelay?: boolean;
  purchaseContext?: PurchaseContext;
  relayCandidates?: RelayCandidate[];
}

export interface PurchaseContext {
  ownedCards?: string[];
  paymentMethods?: string[];
  memberships?: string[];
  budget?: number;
  region?: string;
  preferences?: string[];
}

export interface PurchaseContextApplied {
  ownedCards: string[];
  paymentMethods: string[];
  memberships: string[];
  budget?: number;
  region?: string;
  preferences: string[];
}

export type ReliabilityIssueSeverity = 'blocker' | 'warning';
export type ReliabilityIssueCode =
  | 'IDENTITY_INCOMPLETE_IN_WINNER'
  | 'HARD_CONSTRAINT_UNKNOWN_IN_WINNER'
  | 'HARD_CONSTRAINT_FAILED_IN_WINNER'
  | 'SEARCH_METADATA_AS_DECISIVE'
  | 'UNKNOWN_SHIPPING_IN_WINNER'
  | 'ALTERNATIVE_SKU_MISMATCH'
  | 'PERSONALIZED_IDENTITY_MISMATCH'
  | 'HISTORY_IDENTITY_MISMATCH'
  | 'UNOWNED_CARD_IN_OWNED_RANKING'
  | 'POINTS_AS_CASH'
  | 'EXPIRED_PROMOTION'
  | 'MARKET_COVERAGE_INCONSISTENT'
  | 'PURCHASE_CONTEXT_NOT_APPLIED';

export interface ReliabilityIssue {
  code: ReliabilityIssueCode;
  severity: ReliabilityIssueSeverity;
  message: string;
}

export type OfferCondition = 'new' | 'refurbished' | 'open_box' | 'display' | 'used' | 'unknown';
export type OfferVerification = 'checkout_verified' | 'page_verified' | 'search_metadata' | 'unverified';
export type OfferPriceBasis = 'cash' | 'owned_card' | 'conditional_payment' | 'public_conditional' | 'effective' | 'alternative_condition';

export type ShippingStatus = 'free' | 'paid' | 'conditional_free' | 'unknown';

export const SELLER_RESOLUTION_METHODS = [
  'static_link',
  'embedded_metadata',
  'redirect_resolution',
  'fallback_search',
] as const;
export type SellerResolutionMethod = (typeof SELLER_RESOLUTION_METHODS)[number];

export const MANDATORY_FEE_STATUSES = ['required', 'not_applicable', 'unknown'] as const;
export type MandatoryFeeStatus = (typeof MANDATORY_FEE_STATUSES)[number];

export interface SellerVerificationTrace {
  comparisonSource?: string;
  comparisonUrl?: string;
  resolutionMethod?: SellerResolutionMethod;
  originalSellerUrl?: string;
  resolvedSellerUrl?: string;
  identityVerdict?: IdentityVerdict;
  bundleVerdict?: 'complete' | 'incomplete' | 'unknown';
  priceStatus?: OfferVerification | 'missing';
  shippingStatus?: ShippingStatus;
  availabilityStatus?: 'available' | 'unavailable' | 'unknown';
  mandatoryFeeStatus?: MandatoryFeeStatus;
  comparisonAdvertisedPrice?: number;
  sellerVerifiedPrice?: number;
  mandatoryPurchaseFee?: number;
  totalCashPrice?: number;
  rejectionReasons: string[];
  retrievedAt: string;
}

export interface ShippingQuote {
  status: ShippingStatus;
  baseFee?: number;
  threshold?: number;
  verification: OfferVerification;
  remoteAreaExtraUnknown?: boolean;
}

export type PromotionType = 'time_deal' | 'public_coupon' | 'instant_discount' | 'none';

export interface PromotionState {
  type: PromotionType;
  startsAt?: string;
  endsAt?: string;
  active: boolean | 'unknown';
  condition?: string;
  accountRequired?: boolean;
}

export interface FieldProvenance {
  sourceUrl: string;
  method: AcquisitionMethod | OfferVerification;
  verifiedAt: string;
}

export interface SellerInfo {
  name?: string;
  productId?: string;
  canonicalUrl?: string;
  discoveredBy?: string[];
}

export interface MarketOffer {
  id: string;
  market: string;
  title: string;
  url: string;
  currency: string;
  retrievedAt: string;
  verification: OfferVerification;
  condition: OfferCondition;
  identityScore: number;
  bundleComplete: boolean;
  eligible: boolean;
  identityVerdict?: IdentityVerdict;
  constraintStatus?: 'eligible' | 'preliminary' | 'excluded';
  fieldVerification?: {
    identity: OfferVerification;
    price: OfferVerification;
    shipping: OfferVerification;
    payment?: OfferVerification;
  };
  seller?: string;
  sellerInfo?: SellerInfo;
  bundleItems?: string[];
  listPrice?: number;
  salePrice?: number;
  couponPrice?: number;
  membershipPrice?: number;
  cardPrice?: number;
  cardName?: string;
  paymentPrice?: number;
  paymentMethod?: string;
  points?: number;
  shippingFee?: number;
  shipping?: ShippingQuote;
  installationFee?: number;
  mandatoryFees?: number[];
  mandatoryPurchaseFee?: number;
  mandatoryFeeStatus?: MandatoryFeeStatus;
  verificationTrace?: SellerVerificationTrace;
  promotion?: PromotionState;
  provenance?: {
    identity?: FieldProvenance;
    price?: FieldProvenance;
    shipping?: FieldProvenance;
    availability?: FieldProvenance;
  };
  totalCashPrice?: number;
  effectivePrice?: number;
  availability?: string;
  warranty?: string;
  returnPolicy?: string;
  conditions: string[];
  riskFlags: string[];
  exclusionReasons: string[];
}

export interface RelayCandidate {
  url: string;
  market: string;
  targetHint?: Partial<Pick<NormalizedTarget, 'brand' | 'name' | 'model' | 'variant' | 'productId' | 'liveId'>>;
}

export interface RankedOffer {
  basis: OfferPriceBasis;
  rank: number;
  amount: number;
  offer: MarketOffer;
  reasons: string[];
}

export interface BestOffers {
  cash?: RankedOffer;
  ownedCard?: RankedOffer;
  conditionalPayment?: RankedOffer;
  publicConditional?: RankedOffer;
  effective?: RankedOffer;
  alternativeCondition?: RankedOffer;
}

export interface MarketCoverage {
  providerId?: string;
  market: string;
  attempted: boolean;
  found: number;
  verified: number;
  status: 'verified' | 'found_unverified' | 'no_match' | 'failed' | 'not_attempted';
  comparisonPages?: number;
  expandedSellers?: number;
  exactOffers?: number;
  eligibleSellers?: number;
  failureKind?: ProviderFailureKind;
  message?: string;
}

export type ProviderFailureKind =
  | 'captcha'
  | 'login_required'
  | 'rate_limited'
  | 'network_transient'
  | 'blocked_by_site'
  | 'not_found'
  | 'region_required'
  | 'stock_check_required'
  | 'parse_failed'
  | 'relay_offline'
  | 'unknown';

export interface ProviderAttempt {
  providerId?: string;
  market: string;
  attemptedAt: string;
  completedAt?: string;
  discovery: { attempted: boolean; hitCount: number };
  identity: { exact: number; uncertain: number; different: number };
  verification: { attempted: number; succeeded: number; failed: number };
  offers: { extracted: number; eligible: number };
  comparisonPages?: number;
  expandedSellers?: number;
  exactOffers?: number;
  eligibleSellers?: number;
  failureKind?: ProviderFailureKind;
  failureMessage?: string;
  status: MarketCoverage['status'];
}

export interface RecommendationScores {
  fit: number;
  quality: number;
  reviews: number;
  design: number;
  care: number;
  risk: number;
  value: number;
  overall: number;
}

export interface ProductRecommendation {
  rank: number;
  title: string;
  target: NormalizedTarget;
  scores: RecommendationScores;
  bestFor: string;
  reasons: string[];
  tradeoffs: string[];
  confidence: number;
  preliminary: boolean;
  bestOffer?: MarketOffer;
}

export interface ManualCheck {
  type: 'login' | 'captcha' | 'owned_card' | 'membership' | 'availability' | 'offline_quote' | 'used_condition';
  message: string;
  url?: string;
}

export interface ResearchSourceResult {
  source: string;
  success: boolean;
  acquisitionMethod?: AcquisitionMethod;
  attemptedAt: string;
  completedAt: string;
  evidence: EvidenceItem[];
  error?: string;
}

export interface RelayStatus {
  available: boolean;
  used: boolean;
  mode: 'offline' | 'public_only' | 'local_authenticated';
  message?: string;
}

export interface PriceSnapshot {
  currency: string;
  listPrice?: number;
  salePrice?: number;
  couponPrice?: number;
  membershipPrice?: number;
  sellerInstantDiscount?: number;
  couponDiscount?: number;
  cardInstantDiscount?: number;
  cardStatementDiscount?: number;
  membershipDiscount?: number;
  cashPaymentPrice?: number;
  estimatedPoints?: number;
  basePoints?: number;
  membershipPoints?: number;
  liveSpecialPoints?: number;
  totalExpectedPoints?: number;
  effectivePrice?: number;
  shippingFee?: number;
  shippingEta?: string;
  selectedOption?: string;
  availability?: string;
  dealType?: string;
  liveId?: string;
  liveStatus?: string;
  liveEndAt?: string;
  sourceUrl?: string;
}

export interface ProductConfidenceDimensions {
  identity: number;
  price: number;
  officialSpecs: number;
  reviews: number;
  negativeSignals: number;
  personalizedPrice: number;
}

export interface PriceHistoryObservationReport {
  observedAt: string;
  cashPrice: number;
  sourceUrl?: string;
  market?: string;
}

export interface PriceHistoryReport {
  sku: string;
  observations: PriceHistoryObservationReport[];
  comparison: {
    direction: 'up' | 'down' | 'unchanged' | 'insufficient';
    previousPrice?: number;
    currentPrice?: number;
    absoluteChange?: number;
    percentageChange?: number;
  };
  position: {
    label: 'six_month_low' | 'below_average' | 'near_average' | 'above_average' | 'six_month_high' | 'insufficient';
    current: number;
    minimum?: number;
    maximum?: number;
    average?: number;
    sampleCount: number;
  };
}

export interface MembershipScenarioReport {
  paymentPrice: number;
  expectedPoints: number;
  membershipFee: number;
  effectivePrice: number;
}

export interface MembershipScenariosReport {
  membershipName?: string;
  withoutMembership: MembershipScenarioReport;
  withMembership: MembershipScenarioReport;
}

export interface EventWindowReport {
  startsOn?: string;
  endsOn?: string;
  status: 'upcoming' | 'active' | 'expired' | 'unknown';
}

export interface StandardPriceRowReport {
  key: 'cash' | 'card' | 'effective_without_membership' | 'effective_with_membership';
  label: string;
  amount?: number;
  condition?: string;
}

export interface ProductReport {
  decision: ReportDecision;
  confidence: number;
  confidenceDimensions: ProductConfidenceDimensions;
  title: string;
  summary: string;
  reasons: string[];
  strengths: string[];
  weaknesses: string[];
  missingInformation: string[];
  evidence: EvidenceItem[];
  sourceCount: number;
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
  purchaseContextApplied?: PurchaseContextApplied;
  validationWarnings?: ReliabilityIssue[];
}

export type ResearchJobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export interface ResearchJob {
  id: string;
  status: ResearchJobStatus;
  request: ResearchRequest;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  target: NormalizedTarget;
  researchContext?: ResearchContext;
  sourceResults: ResearchSourceResult[];
  evidence: EvidenceItem[];
  relay: RelayStatus;
  report?: ProductReport;
  errors: string[];
}
