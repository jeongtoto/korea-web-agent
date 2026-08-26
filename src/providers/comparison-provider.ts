import { candidateIdentityFromText, compareCanonicalIdentity } from '../core/identity-match.ts';
import type { CanonicalIdentityMatch } from '../core/types.ts';
import type { ExtractedSellerLink } from './market-extractor.ts';
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

function attr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  return pattern.exec(attrs)?.[1];
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function numericWon(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*(?:원|KRW)?/i);
  if (!match?.[1]) return undefined;
  const number = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

export function extractComparisonSellerLinks(
  html: string,
  baseUrl: URL,
): ExtractedSellerLink[] {
  const links: ExtractedSellerLink[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    const attrs = `${match[1] ?? ''} ${match[3] ?? ''}`;
    const rawHref = match[2];
    if (!rawHref) continue;
    let url: URL;
    try {
      url = new URL(rawHref.replace(/&amp;/gi, '&'), baseUrl);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    const sameHost = url.hostname.toLowerCase() === baseUrl.hostname.toLowerCase();
    if (sameHost && !/(bridge|redirect|outlink|seller|shop|linkprice|mall)/i.test(`${url.pathname}${url.search}`)) continue;
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const label = stripTags(match[4] ?? '');
    const sellerName = attr(attrs, 'data-seller-name') ?? attr(attrs, 'data-mall-name') ?? attr(attrs, 'title');
    const advertisedPrice = numericWon(attr(attrs, 'data-price')) ?? numericWon(label);
    links.push({
      url: key,
      ...(sellerName ? { sellerName } : {}),
      ...(advertisedPrice !== undefined ? { advertisedPrice } : {}),
    });
  }
  return links;
}
