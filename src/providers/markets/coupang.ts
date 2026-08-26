import { candidateIdentityFromText, compareCanonicalIdentity } from '../../core/identity-match.ts';
import type { CanonicalIdentityMatch } from '../../core/types.ts';
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
  const value = providerDefinitionById('coupang');
  if (!value) throw new Error('Coupang provider definition is missing');
  return value;
}

const definition = requireDefinition();

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

function discoveredBy(candidate: VerificationCandidate): string[] {
  return 'discoveredFrom' in candidate ? candidate.discoveredFrom : [definition.id];
}

export const coupangProvider: MarketProvider = {
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
    return verifiedSellerOfferFromPage({
      page: verified.page,
      target: context.target,
      canonicalIdentity: context.canonicalIdentity,
      constraints: context.constraints,
      retrievedAt: verified.retrievedAt,
      discoveredBy: discoveredBy(candidate),
      ...('sellerName' in candidate && candidate.sellerName ? { sellerName: candidate.sellerName } : {}),
      ...('sellerProductId' in candidate && candidate.sellerProductId ? { sellerProductId: candidate.sellerProductId } : {}),
    });
  },
};
