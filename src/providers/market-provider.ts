import type {
  CanonicalIdentityMatch,
  CanonicalProductIdentity,
  MarketOffer,
  NormalizedTarget,
  ProductConstraint,
  SellerResolutionMethod,
  SellerVerificationTrace,
} from '../core/types.ts';
import type { DirectPageResult } from './direct-page.ts';
import type { SearchHit } from './index.ts';
import type { SellerRedirectResult } from './seller-redirect.ts';

export type MarketProviderId =
  | 'naver-shopping'
  | 'coupang'
  | 'danawa'
  | 'enuri'
  | '11st'
  | 'gmarket'
  | 'auction'
  | 'ssg'
  | 'lotteon'
  | 'himart'
  | 'official'
  | 'kakao-talkdeal'
  | 'toss-shopping';

export interface ProviderBudget {
  discovery: number;
  verification: number;
  sellerExpansion: number;
}

export interface MarketProviderDefinition {
  id: MarketProviderId;
  market: string;
  sourceType: string;
  budget: ProviderBudget;
  query: (identity: string) => string;
}

export interface DiscoveryCandidate {
  providerId: MarketProviderId;
  market: string;
  title: string;
  url: string;
  snippet: string;
  discoveredAt: string;
}

export interface SellerCandidate {
  providerId: MarketProviderId;
  discoveredFrom: string[];
  comparisonUrl?: string;
  sellerName?: string;
  sellerUrl: string;
  sellerProductId?: string;
  advertisedPrice?: number;
  advertisedShipping?: number;
  resolutionMethod?: SellerResolutionMethod;
  originalSellerUrl?: string;
  verificationTrace?: SellerVerificationTrace;
}

export type VerificationCandidate = DiscoveryCandidate | SellerCandidate;

export interface VerifiedCandidate {
  candidate: VerificationCandidate;
  page: DirectPageResult;
  identity: CanonicalIdentityMatch;
  retrievedAt: string;
}

export interface MarketProviderContext {
  target: NormalizedTarget;
  canonicalIdentity: CanonicalProductIdentity;
  constraints: ProductConstraint[];
  publicSearch: (query: string) => Promise<SearchHit[]>;
  directPage: (url: string) => Promise<DirectPageResult>;
  resolveSellerRedirect?: (url: string) => Promise<SellerRedirectResult>;
  now: () => Date;
}

export interface MarketProvider {
  readonly id: MarketProviderId;
  readonly market: string;
  readonly budget: ProviderBudget;
  discover(context: MarketProviderContext): Promise<DiscoveryCandidate[]>;
  identify(candidate: VerificationCandidate, context: MarketProviderContext): CanonicalIdentityMatch;
  expandSellers?(candidate: DiscoveryCandidate, context: MarketProviderContext): Promise<SellerCandidate[]>;
  fallbackSellers?(candidate: DiscoveryCandidate, context: MarketProviderContext): Promise<SellerCandidate[]>;
  verify(candidate: VerificationCandidate, context: MarketProviderContext): Promise<VerifiedCandidate>;
  extractOffer(
    candidate: VerifiedCandidate,
    context: MarketProviderContext,
  ): Promise<MarketOffer | null> | MarketOffer | null;
}
