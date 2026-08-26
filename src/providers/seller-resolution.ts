import { assertPublicUrl } from '../core/policy.ts';
import type {
  SellerResolutionMethod,
  SellerVerificationTrace,
} from '../core/types.ts';
import type { ExtractedSellerLink } from './market-extractor.ts';
import type { MarketProviderId, SellerCandidate } from './market-provider.ts';
import { canonicalizeSellerUrl } from './offer-dedupe.ts';

export interface EmbeddedSellerRecord {
  url: string;
  sellerName?: string;
  productId?: string;
  advertisedPrice?: number;
  advertisedShipping?: number;
}

const URL_KEYS = ['sellerUrl', 'mallUrl', 'outlink', 'url', 'link'] as const;
const SELLER_NAME_KEYS = ['sellerName', 'mallName', 'seller', 'mall'] as const;
const PRODUCT_ID_KEYS = ['productId', 'mallProductId', 'itemId'] as const;
const PRICE_KEYS = ['price', 'salePrice', 'advertisedPrice'] as const;
const SHIPPING_KEYS = ['shippingFee', 'deliveryFee', 'shipping'] as const;

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value !== 'string') return undefined;
  const compact = value.replace(/,/g, '').replace(/[^0-9.-]/g, '').trim();
  if (!compact) return undefined;
  const parsed = Number(compact);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function firstString(object: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(object[key]);
    if (value) return value;
  }
  return undefined;
}

function firstNumber(object: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = numericValue(object[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function safeSellerUrl(raw: string | undefined, baseUrl: URL): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(decodeHtml(raw), baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return assertPublicUrl(parsed.toString()).toString();
  } catch {
    return undefined;
  }
}

function walkObjects(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 8) return [];
  if (Array.isArray(value)) return value.flatMap((item) => walkObjects(item, depth + 1));
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  return [object, ...Object.values(object).flatMap((item) => walkObjects(item, depth + 1))];
}

function recordFromObject(object: Record<string, unknown>, baseUrl: URL): EmbeddedSellerRecord | undefined {
  let rawUrl: string | undefined;
  let urlKey: string | undefined;
  for (const key of URL_KEYS) {
    const value = stringValue(object[key]);
    if (value) {
      rawUrl = value;
      urlKey = key;
      break;
    }
  }
  const sellerName = firstString(object, SELLER_NAME_KEYS);
  const productId = firstString(object, PRODUCT_ID_KEYS);
  const sellerSpecificUrl = urlKey === 'sellerUrl' || urlKey === 'mallUrl' || urlKey === 'outlink';
  if (!sellerSpecificUrl && !(sellerName || productId)) return undefined;

  const url = safeSellerUrl(rawUrl, baseUrl);
  if (!url) return undefined;
  const advertisedPrice = firstNumber(object, PRICE_KEYS);
  const advertisedShipping = firstNumber(object, SHIPPING_KEYS);
  return {
    url,
    ...(sellerName ? { sellerName } : {}),
    ...(productId ? { productId } : {}),
    ...(advertisedPrice !== undefined ? { advertisedPrice } : {}),
    ...(advertisedShipping !== undefined ? { advertisedShipping } : {}),
  };
}

function attr(attrs: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*=\\s*["']([^"']+)["']`, 'i').exec(attrs)?.[1];
}

function recordFromDataAttrs(attrs: string, baseUrl: URL): EmbeddedSellerRecord | undefined {
  const rawUrl = attr(attrs, 'data-seller-url') ?? attr(attrs, 'data-mall-url') ?? attr(attrs, 'data-outlink');
  const url = safeSellerUrl(rawUrl, baseUrl);
  if (!url) return undefined;
  const sellerName = attr(attrs, 'data-seller-name') ?? attr(attrs, 'data-mall-name');
  const productId = attr(attrs, 'data-product-id') ?? attr(attrs, 'data-item-id');
  const advertisedPrice = numericValue(attr(attrs, 'data-price') ?? attr(attrs, 'data-sale-price'));
  const advertisedShipping = numericValue(attr(attrs, 'data-shipping') ?? attr(attrs, 'data-shipping-fee') ?? attr(attrs, 'data-delivery-fee'));
  return {
    url,
    ...(sellerName ? { sellerName: decodeHtml(sellerName).trim() } : {}),
    ...(productId ? { productId: decodeHtml(productId).trim() } : {}),
    ...(advertisedPrice !== undefined ? { advertisedPrice } : {}),
    ...(advertisedShipping !== undefined ? { advertisedShipping } : {}),
  };
}

function recordKey(record: EmbeddedSellerRecord): string {
  return [canonicalizeSellerUrl(record.url), record.productId ?? '', record.sellerName ?? '']
    .join('|')
    .toLowerCase();
}

export function extractEmbeddedSellerRecords(html: string, baseUrl: URL): EmbeddedSellerRecord[] {
  const records: EmbeddedSellerRecord[] = [];
  const seen = new Set<string>();
  const push = (record: EmbeddedSellerRecord | undefined) => {
    if (!record) return;
    const key = recordKey(record);
    if (seen.has(key)) return;
    seen.add(key);
    records.push(record);
  };

  const jsonScripts = /<script\b[^>]*type\s*=\s*["'](?:application\/json|application\/ld\+json)["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(jsonScripts)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      for (const object of walkObjects(JSON.parse(raw))) push(recordFromObject(object, baseUrl));
    } catch {
      // Malformed deterministic payloads are candidate-local and ignored.
    }
  }

  const tagWithSellerData = /<[^>]+data-(?:seller-url|mall-url|outlink)\s*=\s*["'][^"']+["'][^>]*>/gi;
  for (const match of html.matchAll(tagWithSellerData)) push(recordFromDataAttrs(match[0], baseUrl));

  return records;
}

function sellerIdentityKey(input: {
  url: string;
  sellerName?: string;
  productId?: string;
}): string {
  if (input.productId && input.sellerName) {
    return `seller:${input.sellerName.trim().toLowerCase()}|product:${input.productId.trim().toLowerCase()}`;
  }
  return `url:${canonicalizeSellerUrl(input.url).toLowerCase()}|product:${(input.productId ?? '').toLowerCase()}`;
}

function traceFor(input: {
  providerId: MarketProviderId;
  comparisonUrl: string;
  method: SellerResolutionMethod;
  sellerUrl: string;
  advertisedPrice?: number;
  retrievedAt: string;
}): SellerVerificationTrace {
  return {
    comparisonSource: input.providerId,
    comparisonUrl: input.comparisonUrl,
    resolutionMethod: input.method,
    originalSellerUrl: input.sellerUrl,
    resolvedSellerUrl: input.sellerUrl,
    ...(input.advertisedPrice !== undefined ? { comparisonAdvertisedPrice: input.advertisedPrice } : {}),
    rejectionReasons: [],
    retrievedAt: input.retrievedAt,
  };
}

function candidateFromRecord(input: {
  providerId: MarketProviderId;
  comparisonUrl: string;
  method: SellerResolutionMethod;
  record: EmbeddedSellerRecord | ExtractedSellerLink;
  retrievedAt: string;
}): SellerCandidate {
  const sellerUrl = assertPublicUrl(input.record.url).toString();
  const productId = 'productId' in input.record ? input.record.productId : undefined;
  return {
    providerId: input.providerId,
    discoveredFrom: [input.providerId],
    comparisonUrl: input.comparisonUrl,
    sellerUrl,
    ...(input.record.sellerName ? { sellerName: input.record.sellerName } : {}),
    ...(productId ? { sellerProductId: productId } : {}),
    ...(input.record.advertisedPrice !== undefined ? { advertisedPrice: input.record.advertisedPrice } : {}),
    ...(input.record.advertisedShipping !== undefined ? { advertisedShipping: input.record.advertisedShipping } : {}),
    resolutionMethod: input.method,
    originalSellerUrl: sellerUrl,
    verificationTrace: traceFor({
      providerId: input.providerId,
      comparisonUrl: input.comparisonUrl,
      method: input.method,
      sellerUrl,
      ...(input.record.advertisedPrice !== undefined ? { advertisedPrice: input.record.advertisedPrice } : {}),
      retrievedAt: input.retrievedAt,
    }),
  };
}

export function resolveSellerCandidatesFromPage(input: {
  providerId: MarketProviderId;
  comparisonUrl: string;
  staticLinks: readonly ExtractedSellerLink[];
  embeddedRecords: readonly EmbeddedSellerRecord[];
  limit: number;
  retrievedAt: string;
}): SellerCandidate[] {
  if (input.limit <= 0) return [];
  const ordered = [
    ...input.embeddedRecords.map((record) => ({ record, method: 'embedded_metadata' as const })),
    ...input.staticLinks.map((record) => ({ record, method: 'static_link' as const })),
  ];
  const candidates: SellerCandidate[] = [];
  const seen = new Set<string>();
  for (const item of ordered) {
    if (candidates.length >= input.limit) break;
    try {
      const url = assertPublicUrl(item.record.url).toString();
      const productId = 'productId' in item.record ? item.record.productId : undefined;
      const key = sellerIdentityKey({
        url,
        ...(item.record.sellerName ? { sellerName: item.record.sellerName } : {}),
        ...(productId ? { productId } : {}),
      });
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidateFromRecord({
        providerId: input.providerId,
        comparisonUrl: input.comparisonUrl,
        method: item.method,
        record: item.record,
        retrievedAt: input.retrievedAt,
      }));
    } catch {
      // Unsafe or malformed seller targets are skipped without failing siblings.
    }
  }
  return candidates;
}
