import { assertPublicUrl } from '../core/policy.ts';
import type { CanonicalProductIdentity, NormalizedTarget } from '../core/types.ts';
import type { SearchHit } from './index.ts';
import type { MarketProviderId, SellerCandidate } from './market-provider.ts';
import { canonicalizeSellerUrl } from './offer-dedupe.ts';

const NON_SELLER_HOST_SUFFIXES = [
  'danawa.com',
  'enuri.com',
  'shopping.naver.com',
  'blog.naver.com',
  'cafe.naver.com',
  'reddit.com',
  'dcinside.com',
  'clien.net',
  'ruliweb.com',
  'ppomppu.co.kr',
  'fmkorea.com',
] as const;

function compact(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function pushUnique(tokens: string[], value: string | undefined): void {
  const token = compact(value);
  if (!token) return;
  const normalized = token.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '');
  if (!normalized) return;
  const existing = tokens.some((item) => item.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '') === normalized);
  if (!existing) tokens.push(token);
}

export function buildSellerFallbackQuery(input: {
  target: NormalizedTarget;
  canonicalIdentity: CanonicalProductIdentity;
}): string {
  const tokens: string[] = [];
  pushUnique(tokens, input.target.brand ?? input.canonicalIdentity.brand);
  pushUnique(tokens, input.canonicalIdentity.primary.model ?? input.target.model);
  pushUnique(tokens, input.canonicalIdentity.primary.size);
  pushUnique(tokens, input.canonicalIdentity.primary.generation);
  for (const component of input.canonicalIdentity.requiredComponents) {
    pushUnique(tokens, component.model);
    pushUnique(tokens, component.version);
  }
  pushUnique(tokens, input.target.variant);
  return tokens.join(' ');
}

function isExcludedHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return NON_SELLER_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function sellerUrlFromHit(hit: SearchHit): string | undefined {
  try {
    const safe = assertPublicUrl(hit.url);
    if (isExcludedHost(safe)) return undefined;
    return canonicalizeSellerUrl(safe.toString());
  } catch {
    return undefined;
  }
}

export async function discoverFallbackSellers(input: {
  providerId: MarketProviderId;
  comparisonUrl: string;
  target: NormalizedTarget;
  canonicalIdentity: CanonicalProductIdentity;
  search: (query: string) => Promise<SearchHit[]>;
  limit: number;
  retrievedAt: string;
}): Promise<SellerCandidate[]> {
  if (input.limit <= 0) return [];
  const query = buildSellerFallbackQuery({
    target: input.target,
    canonicalIdentity: input.canonicalIdentity,
  });
  if (!query) return [];

  const hits = await input.search(query);
  const candidates: SellerCandidate[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (candidates.length >= input.limit) break;
    const sellerUrl = sellerUrlFromHit(hit);
    if (!sellerUrl) continue;
    const key = sellerUrl.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      providerId: input.providerId,
      discoveredFrom: [input.providerId],
      comparisonUrl: input.comparisonUrl,
      sellerUrl,
      resolutionMethod: 'fallback_search',
      originalSellerUrl: sellerUrl,
      verificationTrace: {
        comparisonSource: input.providerId,
        comparisonUrl: input.comparisonUrl,
        resolutionMethod: 'fallback_search',
        originalSellerUrl: sellerUrl,
        resolvedSellerUrl: sellerUrl,
        rejectionReasons: [],
        retrievedAt: input.retrievedAt,
      },
    });
  }
  return candidates;
}
