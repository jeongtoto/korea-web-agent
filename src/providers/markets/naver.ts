import { candidateIdentityFromText, compareCanonicalIdentity } from '../../core/identity-match.ts';
import type { CanonicalIdentityMatch } from '../../core/types.ts';
import { resolveComparisonBridgeCandidates } from '../comparison-provider.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  VerificationCandidate,
} from '../market-provider.ts';
import { providerDefinitionById } from '../provider-registry.ts';
import { discoverFallbackSellers } from '../seller-fallback-discovery.ts';
import {
  directPageIdentityMatch,
  sellerCandidatesFromComparisonPage,
  verifiedSellerOfferFromPage,
} from '../seller-expansion.ts';

function requireDefinition() {
  const value = providerDefinitionById('naver-shopping');
  if (!value) throw new Error('Naver Shopping provider definition is missing');
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

function isPortalUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.hostname === 'shopping.naver.com' || url.hostname.endsWith('.shopping.naver.com');
  } catch {
    return false;
  }
}

export const naverShoppingProvider: MarketProvider = {
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
    if (!isPortalUrl(candidate.url)) return [];
    const page = await context.directPage(candidate.url);
    const identity = directPageIdentityMatch(context.canonicalIdentity, page);
    if (identity.verdict !== 'exact') return [];
    const retrievedAt = context.now().toISOString();
    const sellers = sellerCandidatesFromComparisonPage(this, candidate, page, retrievedAt);
    const resolved = await resolveComparisonBridgeCandidates(sellers, context, definition.id);
    return resolved.slice(0, definition.budget.sellerExpansion);
  },
  async fallbackSellers(candidate, context) {
    if (!isPortalUrl(candidate.url)) return [];
    return discoverFallbackSellers({
      providerId: definition.id,
      comparisonUrl: candidate.url,
      target: context.target,
      canonicalIdentity: context.canonicalIdentity,
      search: context.publicSearch,
      limit: definition.budget.sellerExpansion,
      retrievedAt: context.now().toISOString(),
    });
  },
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
      ...('verificationTrace' in candidate && candidate.verificationTrace ? { verificationTrace: candidate.verificationTrace } : {}),
    });
  },
};
