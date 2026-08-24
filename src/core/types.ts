export const EVIDENCE_CLASSES = [
  'official_record', 'accredited_test', 'peer_reviewed_research', 'manufacturer_spec', 'retailer_listing',
  'verified_purchase_review', 'community_report', 'editorial_review', 'sponsored_content', 'inferred_analysis',
] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const ACQUISITION_METHODS = ['official_api', 'search_metadata', 'static_html', 'structured_data', 'crawler', 'playwright', 'ai_browser', 'local_relay'] as const;
export type AcquisitionMethod = (typeof ACQUISITION_METHODS)[number];
export const REPORT_DECISIONS = ['BUY', 'WAIT', 'SKIP', 'INSUFFICIENT'] as const;
export type ReportDecision = (typeof REPORT_DECISIONS)[number];
export type ProductSpecificity = 'exact_product' | 'category' | 'general_mechanism';
export type ProductMatchLevel = 'exact_product' | 'probable_product' | 'category' | 'general_mechanism' | 'unrelated';
export type ResearchMode = 'exact_product' | 'category_recommendation';

export interface ResearchIntent { productResearch: boolean; purchaseDecision: boolean; priceSensitive: boolean; personalizedPriceUseful: boolean; specOnly: boolean }
export interface EvidenceItem { claim: string; sourceUrl: string; sourceType: string; publishedAt?: string; retrievedAt: string; acquisitionMethod: AcquisitionMethod; evidenceClass: EvidenceClass; independenceKey: string; confidence: number; notes?: string; specificity?: ProductSpecificity; sponsored?: boolean; data?: Record<string, unknown> }
export interface NormalizedTarget { kind: 'product' | 'place' | 'service' | 'unknown'; brand?: string; name?: string; model?: string; variant?: string; productId?: string; liveId?: string; sourceHost?: string; canonicalUrl?: string }
export interface ProductMatchResult { level: ProductMatchLevel; score: number; matchedTokens: string[]; missingTokens: string[] }
export interface ProductCandidate { target: NormalizedTarget; score: number; sourceUrls: string[]; title: string }
export interface ProductResolution { target: NormalizedTarget; confidence: number; ambiguous: boolean; candidates: ProductCandidate[]; identityEvidence: Array<{ title: string; url: string; score: number }> }
export interface ResearchContext { intent?: ResearchIntent; identityConfidence?: number; resolvedTarget?: NormalizedTarget; resolutionAmbiguous?: boolean; recommendationMode?: boolean; recommendationCandidates?: ProductCandidate[]; assumptions?: string[]; clarificationQuestions?: string[] }
export interface ResearchRequest { question: string; url?: string; category?: 'product' | 'place' | 'service' | 'auto'; includeLocalRelay?: boolean; purchaseContext?: PurchaseContext; relayCandidates?: RelayCandidate[] }
export interface PurchaseContext { ownedCards?: string[]; memberships?: string[]; budget?: number; region?: string; preferences?: string[] }

export type OfferCondition = 'new' | 'refurbished' | 'open_box' | 'display' | 'used' | 'unknown';
export type OfferVerification = 'checkout_verified' | 'page_verified' | 'search_metadata' | 'unverified';
export type OfferPriceBasis = 'cash' | 'owned_card' | 'advertised_payment' | 'effective' | 'alternative_condition';
export type PromotionValidityStatus = 'active' | 'upcoming' | 'expired' | 'unknown';

export interface MarketOffer {
  id: string; market: string; title: string; url: string; currency: string; retrievedAt: string; verification: OfferVerification;
  condition: OfferCondition; identityScore: number; bundleComplete: boolean; eligible: boolean; seller?: string; bundleItems?: string[];
  listPrice?: number; salePrice?: number; couponPrice?: number; membershipPrice?: number; cardPrice?: number; cardName?: string;
  paymentMethod?: string; paymentPrice?: number; membershipName?: string; nonMemberPrice?: number; memberPoints?: number; nonMemberPoints?: number;
  points?: number; shippingFee?: number; installationFee?: number; totalCashPrice?: number; effectivePrice?: number; availability?: string;
  warranty?: string; returnPolicy?: string; conditions: string[]; riskFlags: string[]; exclusionReasons: string[];
  observedAt?: string; startsAt?: string; endsAt?: string; timeZone?: string; validityStatus?: PromotionValidityStatus;
}
export interface RelayCandidate { url: string; market: string; targetHint?: Partial<Pick<NormalizedTarget, 'brand' | 'name' | 'model' | 'variant' | 'productId' | 'liveId'>> }
export interface RankedOffer { basis: OfferPriceBasis; rank: number; amount: number; offer: MarketOffer; reasons: string[] }
export interface BestOffers { cash?: RankedOffer; ownedCard?: RankedOffer; advertisedPayment?: RankedOffer; effective?: RankedOffer; alternativeCondition?: RankedOffer }
export interface PaymentPromotion { method: string; amount: number; market: string; url: string; verification: OfferVerification; retrievedAt: string; conditions: string[]; startsAt?: string; endsAt?: string; validityStatus?: PromotionValidityStatus }
export interface MembershipScenario { member: boolean; membership?: string; market: string; url: string; paymentPrice?: number; expectedPoints?: number; effectivePrice?: number; verification: OfferVerification; retrievedAt: string; notes: string[] }
export interface MarketCoverage { market: string; attempted: boolean; found: number; verified: number; status: 'verified' | 'found_unverified' | 'no_match' | 'failed' | 'not_attempted'; message?: string }
export interface RecommendationScores { fit: number; quality: number; reviews: number; design: number; care: number; risk: number; value: number; overall: number }
export interface ProductRecommendation { rank: number; title: string; target: NormalizedTarget; scores: RecommendationScores; bestFor: string; reasons: string[]; tradeoffs: string[]; confidence: number; preliminary: boolean; bestOffer?: MarketOffer }
export interface ManualCheck { type: 'login' | 'captcha' | 'owned_card' | 'membership' | 'availability' | 'offline_quote' | 'used_condition'; message: string; url?: string }
export interface ResearchSourceResult { source: string; success: boolean; acquisitionMethod?: AcquisitionMethod; attemptedAt: string; completedAt: string; evidence: EvidenceItem[]; error?: string }
export interface RelayStatus { available: boolean; used: boolean; mode: 'offline' | 'public_only' | 'local_authenticated'; message?: string }

export interface PriceSnapshot {
  currency: string; listPrice?: number; salePrice?: number; couponPrice?: number; membershipPrice?: number; sellerInstantDiscount?: number;
  couponDiscount?: number; cardInstantDiscount?: number; cardStatementDiscount?: number; membershipDiscount?: number; cashPaymentPrice?: number;
  estimatedPoints?: number; basePoints?: number; membershipPoints?: number; liveSpecialPoints?: number; totalExpectedPoints?: number; effectivePrice?: number;
  shippingFee?: number; shippingEta?: string; selectedOption?: string; availability?: string; dealType?: string; liveId?: string; liveStatus?: string;
  liveEndAt?: string; sourceUrl?: string;
}
export interface PriceObservation { observedAt: string; amount: number; currency: string; market?: string; offerId?: string }
export type PriceHistoryPosition = 'new_low' | 'near_low' | 'below_average' | 'around_average' | 'above_average' | 'new_high' | 'insufficient_history';
export interface PriceHistorySummary { coverage: 'observed_only' | 'external_supported'; observationCount: number; firstObservedAt?: string; lastObservedAt?: string; currentPrice?: number; previousPrice?: number; changeFromPrevious?: number; minimum?: number; maximum?: number; mean?: number; median?: number; percentile?: number; position: PriceHistoryPosition }

export type ShoppingPresentationLabel = '현금 실결제가' | '보유카드가' | '광고 결제수단 최저가' | '회원 체감가' | '비회원 체감가' | '리퍼/반품/중고' | '180일 가격 위치';
export interface ShoppingPresentationRow { label: ShoppingPresentationLabel; amount?: number; market?: string; seller?: string; paymentMethod?: string; membership?: string; expectedPoints?: number; effectivePrice?: number; eventPeriod?: string; verification: OfferVerification | 'observed_history'; retrievedAt: string; notes: string[] }
export interface ShoppingPresentation { schemaVersion: '1'; rows: ShoppingPresentationRow[] }

export interface ProductConfidenceDimensions { identity: number; price: number; officialSpecs: number; reviews: number; negativeSignals: number; personalizedPrice: number }
export interface ProductReport {
  decision: ReportDecision; confidence: number; confidenceDimensions: ProductConfidenceDimensions; title: string; summary: string; reasons: string[];
  strengths: string[]; weaknesses: string[]; missingInformation: string[]; evidence: EvidenceItem[]; sourceCount: number; price?: PriceSnapshot;
  personalizedPrice?: PriceSnapshot; offers?: MarketOffer[]; bestOffers?: BestOffers; paymentPromotions?: PaymentPromotion[]; membershipScenarios?: MembershipScenario[];
  marketCoverage?: MarketCoverage[]; recommendations?: ProductRecommendation[]; manualChecks?: ManualCheck[]; priceHistory?: PriceHistorySummary; presentation?: ShoppingPresentation;
}
export type ResearchJobStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';
export interface ResearchJob { id: string; status: ResearchJobStatus; request: ResearchRequest; createdAt: string; updatedAt: string; completedAt?: string; target: NormalizedTarget; researchContext?: ResearchContext; sourceResults: ResearchSourceResult[]; evidence: EvidenceItem[]; relay: RelayStatus; report?: ProductReport; errors: string[] }
