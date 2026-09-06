import { candidateIdentityFromText, compareCanonicalIdentity } from '../core/identity-match.ts';
import type { CanonicalIdentityMatch } from '../core/types.ts';
import { discoverFallbackSellers } from './seller-fallback-discovery.ts';
import type {
  DiscoveryCandidate,
  MarketProvider,
  MarketProviderContext,
  MarketProviderDefinition,
  SellerCandidate,
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

function comparisonDomainSuffix(providerId: MarketProviderDefinition['id']): string | null {
  if (providerId === 'danawa') return 'danawa.com';
  if (providerId === 'enuri') return 'enuri.com';
  if (providerId === 'naver-shopping') return 'naver.com';
  return null;
}

function isComparisonBridgeUrl(input: string, providerId: MarketProviderDefinition['id']): boolean {
  const suffix = comparisonDomainSuffix(providerId);
  if (!suffix) return false;
  try {
    const host = new URL(input).hostname.toLowerCase();
    return host === suffix || host.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
}

export async function resolveComparisonBridgeCandidates(
  candidates: SellerCandidate[],
  context: MarketProviderContext,
  providerId: MarketProviderDefinition['id'],
): Promise<SellerCandidate[]> {
  if (!context.resolveSellerRedirect) return candidates;
  const resolved: SellerCandidate[] = [];
  for (const candidate of candidates) {
    if (!isComparisonBridgeUrl(candidate.sellerUrl, providerId)) {
      resolved.push(candidate);
      continue;
    }
    try {
      const redirect = await context.resolveSellerRedirect(candidate.sellerUrl);
      if (redirect.status === 'not_redirect') {
        continue;
      }
      if (redirect.status !== 'resolved' || !redirect.resolvedUrl) continue;
      resolved.push({
        ...candidate,
        sellerUrl: redirect.resolvedUrl,
        originalSellerUrl: candidate.sellerUrl,
        resolutionMethod: 'redirect_resolution',
        verificationTrace: {
          ...(candidate.verificationTrace ?? {
            rejectionReasons: [],
            retrievedAt: context.now().toISOString(),
          }),
          resolutionMethod: 'redirect_resolution',
          originalSellerUrl: candidate.sellerUrl,
          resolvedSellerUrl: redirect.resolvedUrl,
        },
      });
    } catch {
      // Comparison bridge resolution fails closed; an unresolved bridge is not a seller page.
    }
  }
  return resolved;
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
      const retrievedAt = context.now().toISOString();
      const sellers = sellerCandidatesFromComparisonPage(this, candidate, page, retrievedAt);
      const resolved = await resolveComparisonBridgeCandidates(sellers, context, definition.id);
      return resolved.slice(0, definition.budget.sellerExpansion);
    },
    async fallbackSellers(candidate, context) {
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
        ...('verificationTrace' in candidate && candidate.verificationTrace ? { verificationTrace: candidate.verificationTrace } : {}),
      });
    },
  };
}
