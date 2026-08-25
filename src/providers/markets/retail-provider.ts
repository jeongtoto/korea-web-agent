import { candidateIdentityFromText, compareCanonicalIdentity } from '../../core/identity-match.ts';
import type { CanonicalIdentityMatch, MarketOffer } from '../../core/types.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  VerificationCandidate,
  VerifiedCandidate,
} from '../market-provider.ts';
import { providerDefinitionById } from '../provider-registry.ts';
import {
  directPageIdentityMatch,
  verifiedSellerOfferFromPage,
} from '../seller-expansion.ts';

export type RetailProviderId = 'ssg' | 'lotteon' | 'himart';

function requireDefinition(id: RetailProviderId) {
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

function discoveredBy(candidate: VerificationCandidate, providerId: RetailProviderId): string[] {
  return 'discoveredFrom' in candidate ? candidate.discoveredFrom : [providerId];
}

function finiteFee(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function unresolvedFulfillment(attributes: Record<string, string | number | boolean>): boolean {
  const value = attributes.fulfillmentCondition;
  return typeof value === 'string' && /unresolved|미확정|매장\s*선택|픽업\s*선택|배송지\s*선택/i.test(value);
}

function applyRetailMandatoryCosts(offer: MarketOffer, verified: VerifiedCandidate): MarketOffer {
  const attributes = verified.page.facts?.attributes ?? {};
  const next: MarketOffer = {
    ...offer,
    conditions: [...offer.conditions],
    riskFlags: [...offer.riskFlags],
    exclusionReasons: [...offer.exclusionReasons],
    fieldVerification: offer.fieldVerification ? { ...offer.fieldVerification } : undefined,
  };

  if (unresolvedFulfillment(attributes)) {
    next.eligible = false;
    delete next.shippingFee;
    next.shipping = { status: 'unknown', verification: 'unverified' };
    delete next.totalCashPrice;
    if (next.fieldVerification) next.fieldVerification.shipping = 'unverified';
    if (!next.exclusionReasons.includes('fulfillment:unresolved')) next.exclusionReasons.push('fulfillment:unresolved');
    if (!next.riskFlags.includes('매장·픽업·배송 조건이 확정되지 않아 총 현금 결제액을 계산할 수 없습니다.')) {
      next.riskFlags.push('매장·픽업·배송 조건이 확정되지 않아 총 현금 결제액을 계산할 수 없습니다.');
    }
  }

  const installationRequired = attributes.installationRequired === true;
  if (!installationRequired) return next;

  const installationFee = finiteFee(attributes.installationFee);
  const explicitlyUnknown = attributes.installationFeeUnknown === true;
  if (installationFee === undefined) {
    next.eligible = false;
    delete next.installationFee;
    delete next.totalCashPrice;
    if (!next.exclusionReasons.includes('installation:unknown')) next.exclusionReasons.push('installation:unknown');
    if (!next.riskFlags.includes('필수 설치비가 확인되지 않아 총 현금 결제액을 계산할 수 없습니다.')) {
      next.riskFlags.push('필수 설치비가 확인되지 않아 총 현금 결제액을 계산할 수 없습니다.');
    }
    if (explicitlyUnknown && !next.conditions.includes('필수 설치비 미확정')) next.conditions.push('필수 설치비 미확정');
    return next;
  }

  next.installationFee = installationFee;
  if (next.salePrice !== undefined && next.shippingFee !== undefined) {
    next.totalCashPrice = Math.round(next.salePrice + next.shippingFee + installationFee);
  } else {
    delete next.totalCashPrice;
  }
  if (!next.conditions.includes(`필수 설치비 ${installationFee}원 포함`)) {
    next.conditions.push(`필수 설치비 ${installationFee}원 포함`);
  }
  return next;
}

function extractRetailOffer(
  providerId: RetailProviderId,
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
  return base ? applyRetailMandatoryCosts(base, verified) : null;
}

export function createRetailProvider(id: RetailProviderId): MarketProvider {
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
      return extractRetailOffer(id, verified, context);
    },
  };
}
