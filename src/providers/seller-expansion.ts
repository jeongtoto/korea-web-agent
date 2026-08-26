import { constraintEligibility, evaluateProductConstraints } from '../core/constraints.ts';
import { candidateIdentityFromText, compareCanonicalIdentity } from '../core/identity-match.ts';
import { assertPublicUrl } from '../core/policy.ts';
import type {
  CanonicalIdentityMatch,
  CanonicalProductIdentity,
  MarketOffer,
  NormalizedTarget,
  ProductConstraint,
} from '../core/types.ts';
import type { DirectPageResult } from './direct-page.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  SellerCandidate,
} from './market-provider.ts';
import { resolveSellerCandidatesFromPage } from './seller-resolution.ts';
import type { VerificationCache } from './verification-cache.ts';

export function directPageIdentityText(page: DirectPageResult): string {
  return [
    page.facts?.name,
    page.facts?.brand,
    page.facts?.sku,
    page.facts?.model,
    page.facts?.description,
    page.product?.name,
    page.product?.brand,
    page.product?.sku,
    page.product?.model,
    page.title,
    page.description,
  ].filter(Boolean).join(' ');
}

export function directPageIdentityMatch(
  canonicalIdentity: CanonicalProductIdentity,
  page: DirectPageResult,
): CanonicalIdentityMatch {
  return compareCanonicalIdentity(canonicalIdentity, candidateIdentityFromText(directPageIdentityText(page)));
}

function unavailable(value: string | undefined): boolean {
  return Boolean(value && /(out[_ -]?of[_ -]?stock|sold[_ -]?out|discontinued|ended|품절|판매\s*종료|종료)/i.test(value));
}

export function marketFromSellerUrl(input: string): string {
  try {
    const host = new URL(input).hostname.toLowerCase();
    if (host === '11st.co.kr' || host.endsWith('.11st.co.kr')) return '11번가';
    if (host === 'gmarket.co.kr' || host.endsWith('.gmarket.co.kr')) return 'G마켓';
    if (host === 'auction.co.kr' || host.endsWith('.auction.co.kr')) return '옥션';
    if (host === 'coupang.com' || host.endsWith('.coupang.com')) return '쿠팡';
    if (host === 'ssg.com' || host.endsWith('.ssg.com')) return 'SSG';
    if (host === 'lotteon.com' || host.endsWith('.lotteon.com')) return '롯데ON';
    if (host === 'e-himart.co.kr' || host.endsWith('.e-himart.co.kr')) return '롯데하이마트';
    if (host === 'naver.com' || host.endsWith('.naver.com')) return '네이버쇼핑';
    return host;
  } catch {
    return 'unknown';
  }
}

export interface VerifiedSellerOfferInput {
  page: DirectPageResult;
  target: NormalizedTarget;
  canonicalIdentity: CanonicalProductIdentity;
  constraints: ProductConstraint[];
  retrievedAt: string;
  discoveredBy: string[];
  sellerName?: string;
  sellerProductId?: string;
  verificationTrace?: SellerCandidate['verificationTrace'];
}

export function verifiedSellerOfferFromPage(input: VerifiedSellerOfferInput): MarketOffer | null {
  const facts = input.page.facts;
  const price = facts?.price ?? input.page.product?.offers?.price;
  if (price === undefined || !Number.isFinite(price) || price <= 0) return null;

  const candidateIdentity = candidateIdentityFromText(directPageIdentityText(input.page));
  const identity = compareCanonicalIdentity(input.canonicalIdentity, candidateIdentity);
  const constraintStatus = constraintEligibility(evaluateProductConstraints(input.constraints, facts?.attributes ?? {}));
  const shippingFee = facts?.shippingFee ?? input.page.product?.offers?.shippingFee;
  const availability = facts?.availability ?? input.page.product?.offers?.availability;
  const condition = candidateIdentity.condition === 'any' ? 'unknown' : candidateIdentity.condition;
  const eligible = identity.verdict === 'exact'
    && constraintStatus === 'eligible'
    && shippingFee !== undefined
    && !unavailable(availability);
  const exclusionReasons: string[] = [];
  if (identity.verdict !== 'exact') exclusionReasons.push(`identity:${identity.verdict}`);
  if (constraintStatus !== 'eligible') exclusionReasons.push(`constraints:${constraintStatus}`);
  if (shippingFee === undefined) exclusionReasons.push('shipping:unknown');
  if (unavailable(availability)) exclusionReasons.push('availability:unavailable');

  const sellerCanonicalUrl = assertPublicUrl(input.page.url).toString();
  return {
    id: `${marketFromSellerUrl(sellerCanonicalUrl)}:${sellerCanonicalUrl}`,
    market: marketFromSellerUrl(sellerCanonicalUrl),
    title: facts?.name ?? input.page.product?.name ?? input.page.title ?? input.target.name ?? '상품',
    url: sellerCanonicalUrl,
    currency: input.page.product?.offers?.currency ?? 'KRW',
    retrievedAt: input.retrievedAt,
    verification: 'page_verified',
    condition,
    identityScore: identity.confidence,
    identityVerdict: identity.verdict,
    constraintStatus,
    fieldVerification: {
      identity: 'page_verified',
      price: 'page_verified',
      shipping: shippingFee !== undefined ? 'page_verified' : 'unverified',
    },
    bundleComplete: identity.verdict === 'exact' || identity.verdict === 'same_except_condition',
    eligible,
    salePrice: price,
    ...(shippingFee !== undefined ? {
      shippingFee,
      shipping: {
        status: shippingFee === 0 ? 'free' : 'paid',
        ...(shippingFee > 0 ? { baseFee: shippingFee } : {}),
        verification: 'page_verified',
      },
      totalCashPrice: Math.round(price + shippingFee),
    } : {
      shipping: { status: 'unknown', verification: 'unverified' },
    }),
    ...(availability ? { availability } : {}),
    sellerInfo: {
      ...(input.sellerName ? { name: input.sellerName } : {}),
      ...(input.sellerProductId ? { productId: input.sellerProductId } : {}),
      canonicalUrl: sellerCanonicalUrl,
      discoveredBy: [...new Set(input.discoveredBy)],
    },
    provenance: {
      identity: { sourceUrl: sellerCanonicalUrl, method: 'page_verified', verifiedAt: input.retrievedAt },
      price: { sourceUrl: sellerCanonicalUrl, method: 'page_verified', verifiedAt: input.retrievedAt },
      shipping: { sourceUrl: sellerCanonicalUrl, method: shippingFee !== undefined ? 'page_verified' : 'unverified', verifiedAt: input.retrievedAt },
      availability: { sourceUrl: sellerCanonicalUrl, method: 'page_verified', verifiedAt: input.retrievedAt },
    },
    ...(input.verificationTrace ? {
      verificationTrace: {
        ...input.verificationTrace,
        resolvedSellerUrl: sellerCanonicalUrl,
        identityVerdict: identity.verdict,
        bundleVerdict: identity.verdict === 'exact' ? 'complete' : 'unknown',
        priceStatus: 'page_verified',
        shippingStatus: shippingFee === undefined ? 'unknown' : shippingFee === 0 ? 'free' : 'paid',
        availabilityStatus: unavailable(availability) ? 'unavailable' : availability ? 'available' : 'unknown',
        sellerVerifiedPrice: price,
        ...(shippingFee !== undefined ? { totalCashPrice: Math.round(price + shippingFee) } : {}),
        rejectionReasons: [...exclusionReasons],
        retrievedAt: input.retrievedAt,
      },
    } : {}),
    conditions: [],
    riskFlags: shippingFee === undefined ? ['배송비가 확인되지 않았습니다.'] : [],
    exclusionReasons,
  };
}

export function sellerCandidatesFromComparisonPage(
  provider: MarketProvider,
  comparison: DiscoveryCandidate,
  page: DirectPageResult,
  retrievedAt: string,
): SellerCandidate[] {
  return resolveSellerCandidatesFromPage({
    providerId: provider.id,
    comparisonUrl: comparison.url,
    staticLinks: page.sellerLinks ?? [],
    embeddedRecords: page.embeddedSellerRecords ?? [],
    limit: provider.budget.sellerExpansion,
    retrievedAt,
  });
}

export async function expandAndVerifySellers(
  provider: MarketProvider,
  comparison: DiscoveryCandidate,
  context: MarketProviderContext,
  cache: VerificationCache<DirectPageResult>,
): Promise<MarketOffer[]> {
  if (!provider.expandSellers) return [];
  const sellers = await provider.expandSellers(comparison, context);
  const cachedContext: MarketProviderContext = {
    ...context,
    directPage: (url) => cache.getOrLoad(url, () => context.directPage(url)),
  };
  const offers: MarketOffer[] = [];
  for (const seller of sellers.slice(0, provider.budget.sellerExpansion)) {
    try {
      const verified = await provider.verify(seller, cachedContext);
      const offer = await provider.extractOffer(verified, cachedContext);
      if (offer) offers.push(offer);
    } catch {
      // A downstream seller failure is isolated; other seller candidates remain usable.
    }
  }
  return offers;
}
