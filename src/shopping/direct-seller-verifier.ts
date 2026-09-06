import type {
  CanonicalProductIdentity,
  MarketOffer,
  NormalizedTarget,
} from '../core/types.ts';
import { isComparisonPortalHost } from '../providers/comparison-links.ts';
import type { DirectPageResult } from '../providers/direct-page.ts';
import { verifiedSellerOfferFromPage } from '../providers/seller-expansion.ts';

export interface DirectSellerCandidateInput {
  page: DirectPageResult;
  target: NormalizedTarget;
  canonicalIdentity: CanonicalProductIdentity;
  retrievedAt: string;
}

export function verifyDirectSellerCandidate(
  input: DirectSellerCandidateInput,
): MarketOffer | null {
  let pageUrl: URL;
  try {
    pageUrl = new URL(input.page.url);
  } catch {
    return null;
  }

  if (isComparisonPortalHost(pageUrl)) return null;

  return verifiedSellerOfferFromPage({
    page: input.page,
    target: input.target,
    canonicalIdentity: input.canonicalIdentity,
    constraints: [],
    retrievedAt: input.retrievedAt,
    discoveredBy: ['direct_candidate'],
    ...(input.page.sellerInfo?.name ? { sellerName: input.page.sellerInfo.name } : {}),
    ...(input.page.sellerInfo?.productId ? { sellerProductId: input.page.sellerInfo.productId } : {}),
  });
}
