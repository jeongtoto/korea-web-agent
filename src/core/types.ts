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
  sourceHost?: string;
  canonicalUrl?: string;
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
}

export interface ProductResolution {
  target: NormalizedTarget;
  confidence: number;
  ambiguous: boolean;
  candidates: ProductCandidate[];
  identityEvidence: Array<{ title: string; url: string; score: number }>;
}

export interface ResearchRequest {
  question: string;
  url?: string;
  category?: 'product' | 'place' | 'service' | 'auto';
  includeLocalRelay?: boolean;
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
  estimatedPoints?: number;
  shippingFee?: number;
  shippingEta?: string;
  selectedOption?: string;
  availability?: string;
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
  sourceResults: ResearchSourceResult[];
  evidence: EvidenceItem[];
  relay: RelayStatus;
  report?: ProductReport;
  errors: string[];
}
