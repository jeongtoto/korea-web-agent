import { candidateIdentityFromText, compareCanonicalIdentity } from '../../core/identity-match.ts';
import type { CanonicalIdentityMatch, MarketOffer, PromotionState } from '../../core/types.ts';
import { isCurrentPublicPromotion } from '../promotion.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  VerificationCandidate,
} from '../market-provider.ts';
import { providerDefinitionById } from '../provider-registry.ts';
import {
  directPageIdentityMatch,
  verifiedSellerOfferFromPage,
} from '../seller-expansion.ts';

function requireDefinition() {
  const value = providerDefinitionById('toss-shopping');
  if (!value) throw new Error('Toss Shopping provider definition is missing');
  return value;
}

const definition = requireDefinition();

function compact(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function identityText(context: MarketProviderContext): string {
  return [context.target.brand, context.target.name, context.target.model, context.target.variant, context.target.productId]
    .map(compact).filter(Boolean).join(' ');
}

function identifyCandidate(candidate: VerificationCandidate, context: MarketProviderContext): CanonicalIdentityMatch {
  const text = 'title' in candidate ? `${candidate.title} ${candidate.snippet}` : `${candidate.sellerName ?? ''}`;
  return compareCanonicalIdentity(context.canonicalIdentity, candidateIdentityFromText(text));
}

function candidateUrl(candidate: VerificationCandidate): string {
  return 'sellerUrl' in candidate ? candidate.sellerUrl : candidate.url;
}

function discoveredBy(candidate: VerificationCandidate): string[] {
  return 'discoveredFrom' in candidate ? candidate.discoveredFrom : [definition.id];
}

function krwAmount(text: string | undefined): number | undefined {
  const match = text?.match(/(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/i);
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
  return undefined;
}

function applyPromotion(base: MarketOffer, promotion: PromotionState | undefined): MarketOffer {
  if (!promotion || promotion.type === 'none') return promotion ? { ...base, promotion: { ...promotion } } : base;

  const next: MarketOffer = {
    ...base,
    promotion: { ...promotion },
    conditions: [...base.conditions],
    riskFlags: [...base.riskFlags],
    exclusionReasons: [...base.exclusionReasons],
    ...(base.fieldVerification ? { fieldVerification: { ...base.fieldVerification } } : {}),
  };

  if (promotion.accountRequired === true) {
    next.eligible = false;
    if (!next.exclusionReasons.includes('promotion:account_required')) next.exclusionReasons.push('promotion:account_required');
    return next;
  }
  if (!isCurrentPublicPromotion(promotion)) {
    next.eligible = false;
    if (!next.exclusionReasons.includes('promotion:not_current')) next.exclusionReasons.push('promotion:not_current');
    return next;
  }
  if (promotion.type === 'time_deal') return next;

  const amount = krwAmount(promotion.condition);
  if (amount === undefined) return next;
  const method = paymentMethod(promotion.condition);
  if (method) {
    next.paymentPrice = amount;
    next.paymentMethod = method;
  } else {
    next.couponPrice = amount;
  }
  if (next.fieldVerification) next.fieldVerification.payment = 'page_verified';
  if (promotion.condition && !next.conditions.includes(promotion.condition)) next.conditions.push(promotion.condition);
  return next;
}

export const tossShoppingProvider: MarketProvider = {
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
    const candidate = verified.candidate;
    const pageSeller = verified.page.sellerInfo;
    const base = verifiedSellerOfferFromPage({
      page: verified.page,
      target: context.target,
      canonicalIdentity: context.canonicalIdentity,
      constraints: context.constraints,
      retrievedAt: verified.retrievedAt,
      discoveredBy: discoveredBy(candidate),
      ...('sellerName' in candidate && candidate.sellerName
        ? { sellerName: candidate.sellerName }
        : pageSeller?.name ? { sellerName: pageSeller.name } : {}),
      ...('sellerProductId' in candidate && candidate.sellerProductId
        ? { sellerProductId: candidate.sellerProductId }
        : pageSeller?.productId ? { sellerProductId: pageSeller.productId } : {}),
    });
    if (!base) return null;
    return applyPromotion({ ...base, id: `${definition.market}:${base.url}`, market: definition.market }, verified.page.promotion);
  },
};
