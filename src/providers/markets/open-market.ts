import { candidateIdentityFromText, compareCanonicalIdentity } from '../../core/identity-match.ts';
import type { CanonicalIdentityMatch, MarketOffer, PromotionState } from '../../core/types.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  MarketProviderId,
  VerificationCandidate,
  VerifiedCandidate,
} from '../market-provider.ts';
import { providerDefinitionById } from '../provider-registry.ts';
import {
  directPageIdentityMatch,
  verifiedSellerOfferFromPage,
} from '../seller-expansion.ts';

export type OpenMarketProviderId = '11st' | 'gmarket' | 'auction';

function requireDefinition(id: OpenMarketProviderId) {
  const value = providerDefinitionById(id);
  if (!value) throw new Error(`${id} provider definition is missing`);
  return value;
}

function compact(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function identityText(context: MarketProviderContext): string {
  return [
    context.target.brand,
    context.target.name,
    context.target.model,
    context.target.variant,
    context.target.productId,
  ].map(compact).filter(Boolean).join(' ');
}

function identifyCandidate(
  candidate: VerificationCandidate,
  context: MarketProviderContext,
): CanonicalIdentityMatch {
  const text = 'title' in candidate
    ? `${candidate.title} ${candidate.snippet}`
    : `${candidate.sellerName ?? ''}`;
  return compareCanonicalIdentity(context.canonicalIdentity, candidateIdentityFromText(text));
}

function candidateUrl(candidate: VerificationCandidate): string {
  return 'sellerUrl' in candidate ? candidate.sellerUrl : candidate.url;
}

function discoveredBy(candidate: VerificationCandidate, providerId: MarketProviderId): string[] {
  return 'discoveredFrom' in candidate ? candidate.discoveredFrom : [providerId];
}

function krwAmount(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.match(/(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/i);
  if (!match?.[1]) return undefined;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function paymentMethod(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (/토스\s*페이/i.test(text)) return '토스페이';
  if (/카카오\s*페이/i.test(text)) return '카카오페이';
  if (/네이버\s*페이|N\s*PAY/i.test(text)) return '네이버페이';
  if (/PAYCO|페이코/i.test(text)) return 'PAYCO';
  if (/삼성\s*페이/i.test(text)) return '삼성페이';
  if (/애플\s*페이/i.test(text)) return '애플페이';
  return undefined;
}

function applyPublicPromotion(
  offer: MarketOffer,
  promotion: PromotionState | undefined,
): MarketOffer {
  if (!promotion || promotion.type === 'none') return offer;
  if (promotion.active !== true || promotion.accountRequired === true) return offer;

  const amount = krwAmount(promotion.condition);
  if (amount === undefined) return offer;

  const next: MarketOffer = {
    ...offer,
    fieldVerification: {
      ...(offer.fieldVerification ?? {
        identity: 'page_verified',
        price: 'page_verified',
        shipping: 'unverified',
      }),
      payment: 'page_verified',
    },
    promotion: { ...promotion },
    conditions: promotion.condition
      ? [...new Set([...offer.conditions, promotion.condition])]
      : [...offer.conditions],
  };

  if (promotion.type === 'public_coupon') {
    next.couponPrice = amount;
    return next;
  }

  const method = paymentMethod(promotion.condition);
  if (method) {
    next.paymentPrice = amount;
    next.paymentMethod = method;
  } else {
    next.couponPrice = amount;
  }
  return next;
}

function extractOpenMarketOffer(
  providerId: OpenMarketProviderId,
  verified: VerifiedCandidate,
  context: MarketProviderContext,
): MarketOffer | null {
  const candidate = verified.candidate;
  const pageSeller = verified.page.sellerInfo;
  const base = verifiedSellerOfferFromPage({
    page: verified.page,
    target: context.target,
    canonicalIdentity: context.canonicalIdentity,
    constraints: context.constraints,
    retrievedAt: verified.retrievedAt,
    discoveredBy: discoveredBy(candidate, providerId),
    ...('sellerName' in candidate && candidate.sellerName
      ? { sellerName: candidate.sellerName }
      : pageSeller?.name ? { sellerName: pageSeller.name } : {}),
    ...('sellerProductId' in candidate && candidate.sellerProductId
      ? { sellerProductId: candidate.sellerProductId }
      : pageSeller?.productId ? { sellerProductId: pageSeller.productId } : {}),
  });
  if (!base) return null;
  return applyPublicPromotion(base, verified.page.promotion);
}

export function createOpenMarketProvider(id: OpenMarketProviderId): MarketProvider {
  const definition = requireDefinition(id);
  return {
    id: definition.id,
    market: definition.market,
    budget: definition.budget,
    async discover(context) {
      const hits = await context.publicSearch(definition.query(identityText(context)));
      return hits.slice(0, definition.budget.discovery).map((hit) => ({
        providerId: definition.id,
        market: definition.market,
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        discoveredAt: context.now().toISOString(),
      } satisfies DiscoveryCandidate));
    },
    identify: identifyCandidate,
    async verify(candidate, context) {
      const page = await context.directPage(candidateUrl(candidate));
      return {
        candidate,
        page,
        identity: directPageIdentityMatch(context.canonicalIdentity, page),
        retrievedAt: context.now().toISOString(),
      };
    },
    extractOffer(verified, context) {
      return extractOpenMarketOffer(id, verified, context);
    },
  };
}
