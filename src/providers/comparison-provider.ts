import { candidateIdentityFromText, compareCanonicalIdentity } from '../core/identity-match.ts';
import type { CanonicalIdentityMatch } from '../core/types.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  MarketProviderDefinition,
  VerificationCandidate,
} from './market-provider.ts';
import {
  directPageIdentityMatch,
  sellerCandidatesFromComparisonPage,
  verifiedSellerOfferFromPage,
} from './seller-expansion.ts';

export { extractComparisonSellerLinks } from './comparison-links.ts';

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

export function createComparisonMarketProvider(
  definition: Readonly<MarketProviderDefinition>,
): MarketProvider {
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
    async expandSellers(candidate, context) {
      const page = await context.directPage(candidate.url);
      const identity = directPageIdentityMatch(context.canonicalIdentity, page);
      if (identity.verdict !== 'exact') return [];
      return sellerCandidatesFromComparisonPage(this, candidate, page);
    },
    async verify(candidate, context) {
      const url = 'sellerUrl' in candidate ? candidate.sellerUrl : candidate.url;
      const page = await context.directPage(url);
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
        discoveredBy: 'discoveredFrom' in candidate ? candidate.discoveredFrom : [definition.id],
        ...('sellerName' in candidate && candidate.sellerName ? { sellerName: candidate.sellerName } : {}),
        ...('sellerProductId' in candidate && candidate.sellerProductId ? { sellerProductId: candidate.sellerProductId } : {}),
      });
    },
  };
}
