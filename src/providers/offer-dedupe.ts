import type { MarketOffer, OfferVerification } from '../core/types.ts';

const TRACKING_KEYS = new Set(['napm', 'n_media', 'n_query', 'n_rank']);

export function canonicalizeSellerUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_KEYS.has(lower)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return input.trim();
  }
}

function verificationStrength(value: OfferVerification): number {
  switch (value) {
    case 'checkout_verified': return 4;
    case 'page_verified': return 3;
    case 'search_metadata': return 2;
    default: return 1;
  }
}

function offerStrength(offer: MarketOffer): number {
  const identity = offer.identityVerdict === 'exact' ? 3 : offer.identityVerdict === 'same_except_condition' ? 2 : offer.identityVerdict === 'uncertain' ? 1 : 0;
  const shipping = offer.shippingFee !== undefined || (offer.shipping && offer.shipping.status !== 'unknown') ? 1 : 0;
  const total = offer.totalCashPrice !== undefined ? 1 : 0;
  return verificationStrength(offer.verification) * 100 + identity * 10 + shipping * 2 + total;
}

function dedupeKey(offer: MarketOffer): string {
  const canonicalProductKey = (offer as MarketOffer & { canonicalProductKey?: string }).canonicalProductKey ?? '';
  const sellerUrl = canonicalizeSellerUrl(offer.sellerInfo?.canonicalUrl ?? offer.url);
  const sellerProductId = offer.sellerInfo?.productId ?? '';
  const sellerName = offer.sellerInfo?.name ?? offer.seller ?? '';
  return [canonicalProductKey, sellerUrl, sellerProductId, sellerName, offer.condition].join('|').toLowerCase();
}

function discoveredBy(offers: MarketOffer[]): string[] | undefined {
  const values = [...new Set(offers.flatMap((offer) => offer.sellerInfo?.discoveredBy ?? []))];
  return values.length ? values : undefined;
}

function mergeGroup(group: MarketOffer[]): MarketOffer {
  const strongest = [...group].sort((a, b) => offerStrength(b) - offerStrength(a))[0]!;
  const sources = discoveredBy(group);
  const sellerInfo = strongest.sellerInfo || sources
    ? {
        ...(strongest.sellerInfo ?? {}),
        ...(sources ? { discoveredBy: sources } : {}),
      }
    : undefined;
  return {
    ...strongest,
    ...(sellerInfo ? { sellerInfo } : {}),
  };
}

export function deduplicateSellerOffers(offers: MarketOffer[]): MarketOffer[] {
  const groups = new Map<string, MarketOffer[]>();
  for (const offer of offers) {
    const key = dedupeKey(offer);
    const group = groups.get(key);
    if (group) group.push(offer);
    else groups.set(key, [offer]);
  }
  return [...groups.values()].map(mergeGroup);
}
