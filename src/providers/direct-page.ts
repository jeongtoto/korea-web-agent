import { assertPublicUrl } from '../core/policy.ts';
import type { EvidenceItem, PromotionState, SellerInfo } from '../core/types.ts';
import { extractComparisonSellerLinks, isComparisonPortalHost } from './comparison-links.ts';
import {
  matchingMarketExtractor,
  type ExtractedSellerLink,
  type MarketExtraction,
  type MarketPageExtractor,
} from './market-extractor.ts';

const MAX_HTML_BYTES = 2_000_000;

export interface StructuredOffer {
  price?: number;
  currency?: string;
  availability?: string;
  shippingFee?: number;
}

export interface StructuredProduct {
  name?: string;
  brand?: string;
  sku?: string;
  model?: string;
  description?: string;
  attributes?: Record<string, string | number | boolean>;
  offers?: StructuredOffer;
}

export interface DirectProductFacts {
  name?: string;
  brand?: string;
  sku?: string;
  model?: string;
  description?: string;
  price?: number;
  availability?: string;
  shippingFee?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface DirectPageResult {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  product?: StructuredProduct;
  facts?: DirectProductFacts;
  sellerLinks?: ExtractedSellerLink[];
  promotion?: PromotionState;
  sellerInfo?: SellerInfo;
  evidence: EvidenceItem[];
}

function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  };
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    }
    return named[entity.toLowerCase()] ?? _;
  });
}

function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function visiblePageText(html: string): string {
  return stripTags(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:noscript|template|svg)\b[^>]*>[\s\S]*?<\/(?:noscript|template|svg)>/gi, ' '));
}

function numericPrice(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').replace(/[^0-9.-]/g, '').trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function deterministicShippingFeeFromHtml(html: string): number | undefined {
  const text = visiblePageText(html);
  if (!/배송|delivery|shipping/i.test(text)) return undefined;
  const disqualifier = /(조건부|지역별|지역에\s*따라|도서\s*산간|도서산간|제주|착불|별도|추가|설치\s*(?:비|배송)|차등)/i;
  const values = new Set<number>();

  const labeled = /(?:배송비|배송료)\s*[:：]?\s*(무료\s*배송|무료|0\s*원|\d{1,3}(?:,\d{3})+\s*원|\d{3,}\s*원)/gi;
  for (const match of text.matchAll(labeled)) {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 80), Math.min(text.length, index + match[0].length + 100));
    if (disqualifier.test(context)) continue;
    const raw = match[1] ?? '';
    if (/무료/i.test(raw) || /^0\s*원$/i.test(raw.trim())) values.add(0);
    else {
      const value = numericPrice(raw);
      if (value !== undefined && value >= 0) values.add(value);
    }
  }

  for (const match of text.matchAll(/무료\s*배송/gi)) {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 80), Math.min(text.length, index + match[0].length + 100));
    if (!disqualifier.test(context)) values.add(0);
  }

  return values.size === 1 ? [...values][0] : undefined;
}

function metaContent(html: string, attr: 'name' | 'property', key: string): string | undefined {
  const patterns = [
    new RegExp(`<meta\\s+[^>]*${attr}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\s+[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return undefined;
}

function titleContent(html: string): string | undefined {
  const og = metaContent(html, 'property', 'og:title');
  if (og) return og;
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? stripTags(match[1]) : undefined;
}

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(regex)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Invalid JSON-LD is ignored; the static metadata path remains usable.
    }
  }
  return blocks;
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  const graph = object['@graph'];
  return [object, ...(Array.isArray(graph) ? graph.flatMap(flattenJsonLd) : [])];
}

function typeIncludesProduct(value: unknown): boolean {
  if (typeof value === 'string') return value.toLowerCase() === 'product';
  if (Array.isArray(value)) return value.some(typeIncludesProduct);
  return false;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function shippingFeeFromOffer(offer: Record<string, unknown>): number | undefined {
  const detailsRaw = Array.isArray(offer.shippingDetails) ? offer.shippingDetails[0] : offer.shippingDetails;
  if (!detailsRaw || typeof detailsRaw !== 'object') return undefined;
  const details = detailsRaw as Record<string, unknown>;
  const rateRaw = details.shippingRate;
  if (typeof rateRaw === 'number' || typeof rateRaw === 'string') return numericPrice(rateRaw);
  if (!rateRaw || typeof rateRaw !== 'object') return undefined;
  return numericPrice((rateRaw as Record<string, unknown>).value);
}

function booleanFromValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (/(있음|포함|yes|true|지원)/i.test(value)) return true;
  if (/(없음|미포함|no|false|미지원)/i.test(value)) return false;
  return undefined;
}

function normalizeAdditionalProperties(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!Array.isArray(value)) return undefined;
  const attributes: Record<string, string | number | boolean> = {};
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const property = item as Record<string, unknown>;
    const name = stringValue(property.name ?? property.propertyID);
    const raw = property.value;
    if (!name || raw === undefined || raw === null) continue;
    const valueText = typeof raw === 'string' ? raw : String(raw);
    const number = numericPrice(raw);
    if (/(폭|너비|width)/i.test(name) && number !== undefined) attributes.supportedWidthMm = number;
    else if (/(길이|length|깊이)/i.test(name) && number !== undefined) attributes.supportedLengthMm = number;
    else if (/서랍/i.test(name)) {
      const bool = booleanFromValue(raw);
      if (bool !== undefined) attributes.drawerStorage = bool;
    } else if (/(헤드|headboard)/i.test(name)) {
      if (/무헤드|headless/i.test(valueText)) attributes.headboardStyle = 'headless';
      else if (/소파/i.test(valueText)) attributes.headboardStyle = 'sofa';
      else attributes[name] = valueText;
    } else if (typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string') {
      attributes[name] = raw;
    }
  }
  return Object.keys(attributes).length ? attributes : undefined;
}

function parseProduct(html: string): StructuredProduct | undefined {
  for (const block of jsonLdBlocks(html)) {
    for (const object of flattenJsonLd(block)) {
      if (!typeIncludesProduct(object['@type'])) continue;
      const brandRaw = object.brand;
      let brand: string | undefined;
      if (typeof brandRaw === 'string') brand = brandRaw;
      if (brandRaw && typeof brandRaw === 'object') brand = stringValue((brandRaw as Record<string, unknown>).name);
      const offersRaw = Array.isArray(object.offers) ? object.offers[0] : object.offers;
      let offers: StructuredOffer | undefined;
      if (offersRaw && typeof offersRaw === 'object') {
        const offer = offersRaw as Record<string, unknown>;
        const price = numericPrice(offer.price ?? offer.lowPrice);
        const currency = stringValue(offer.priceCurrency);
        const availability = stringValue(offer.availability);
        const shippingFee = shippingFeeFromOffer(offer);
        if (price !== undefined || currency || availability || shippingFee !== undefined) {
          offers = {};
          if (price !== undefined) offers.price = price;
          if (currency) offers.currency = currency;
          if (availability) offers.availability = availability;
          if (shippingFee !== undefined) offers.shippingFee = shippingFee;
        }
      }
      const product: StructuredProduct = {};
      const name = stringValue(object.name);
      const sku = stringValue(object.sku);
      const model = stringValue(object.model ?? object.mpn);
      const description = stringValue(object.description);
      const attributes = normalizeAdditionalProperties(object.additionalProperty);
      if (name) product.name = name;
      if (brand) product.brand = brand;
      if (sku) product.sku = sku;
      if (model) product.model = model;
      if (description) product.description = description;
      if (attributes) product.attributes = attributes;
      if (offers) product.offers = offers;
      return product;
    }
  }
  return undefined;
}

function mergeProduct(
  generic: StructuredProduct | undefined,
  specific: StructuredProduct | undefined,
): StructuredProduct | undefined {
  if (!generic) return specific ? { ...specific } : undefined;
  if (!specific) return { ...generic };
  const attributes = generic.attributes || specific.attributes
    ? { ...(generic.attributes ?? {}), ...(specific.attributes ?? {}) }
    : undefined;
  const offers = generic.offers || specific.offers
    ? { ...(generic.offers ?? {}), ...(specific.offers ?? {}) }
    : undefined;
  return {
    ...generic,
    ...specific,
    ...(attributes ? { attributes } : {}),
    ...(offers ? { offers } : {}),
  };
}

function productFacts(product: StructuredProduct | undefined): DirectProductFacts | undefined {
  if (!product) return undefined;
  const facts: DirectProductFacts = {};
  if (product.name) facts.name = product.name;
  if (product.brand) facts.brand = product.brand;
  if (product.sku) facts.sku = product.sku;
  if (product.model) facts.model = product.model;
  if (product.description) facts.description = product.description;
  if (product.offers?.price !== undefined) facts.price = product.offers.price;
  if (product.offers?.availability) facts.availability = product.offers.availability;
  if (product.offers?.shippingFee !== undefined) facts.shippingFee = product.offers.shippingFee;
  if (product.attributes) facts.attributes = { ...product.attributes };
  return Object.keys(facts).length ? facts : undefined;
}

function mergeFacts(
  generic: DirectProductFacts | undefined,
  specific: DirectProductFacts | undefined,
): DirectProductFacts | undefined {
  if (!generic) return specific ? { ...specific } : undefined;
  if (!specific) return { ...generic };
  const attributes = generic.attributes || specific.attributes
    ? { ...(generic.attributes ?? {}), ...(specific.attributes ?? {}) }
    : undefined;
  return {
    ...generic,
    ...specific,
    ...(attributes ? { attributes } : {}),
  };
}

async function fetchWithSafeRedirects(input: URL, fetchImpl: typeof fetch, maxRedirects = 5): Promise<{ response: Response; url: URL }> {
  let current = input;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: {
        'user-agent': 'KoreaWebAgent/0.1 (+public research; read-only)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === maxRedirects) throw new Error('Too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect response is missing Location');
      current = assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    return { response, url: current };
  }
  throw new Error('Too many redirects');
}

export async function fetchDirectPage(
  input: string,
  fetchImpl: typeof fetch = fetch,
  extractor?: MarketPageExtractor | readonly MarketPageExtractor[],
): Promise<DirectPageResult> {
  const initialUrl = assertPublicUrl(input);
  const { response, url } = await fetchWithSafeRedirects(initialUrl, fetchImpl);
  if (!response.ok) throw new Error(`Page fetch failed with HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_HTML_BYTES) throw new Error('Page is too large to analyze safely');
  const html = await response.text();
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) throw new Error('Page is too large to analyze safely');

  const retrievedAt = new Date().toISOString();
  const selectedExtractor = matchingMarketExtractor(extractor, url);
  const extraction: MarketExtraction | undefined = selectedExtractor?.extract({ url, html, retrievedAt });
  const title = titleContent(html);
  const description = metaContent(html, 'name', 'description') ?? metaContent(html, 'property', 'og:description');
  const siteName = metaContent(html, 'property', 'og:site_name');
  const genericProduct = parseProduct(html);
  const product = mergeProduct(genericProduct, extraction?.product);
  const staticShippingFee = product?.offers?.shippingFee === undefined ? deterministicShippingFeeFromHtml(html) : undefined;
  const staticFacts: DirectProductFacts | undefined = staticShippingFee !== undefined ? { shippingFee: staticShippingFee } : undefined;
  const facts = mergeFacts(mergeFacts(productFacts(product), staticFacts), extraction?.facts);
  const fallbackSellerLinks = isComparisonPortalHost(url) ? extractComparisonSellerLinks(html, url) : [];
  const sellerLinks = extraction?.sellerLinks?.length ? extraction.sellerLinks : fallbackSellerLinks;
  const evidence: EvidenceItem[] = [];

  if (title || description) {
    evidence.push({
      claim: [title, description].filter(Boolean).join(' — '),
      sourceUrl: url.toString(),
      sourceType: 'web_page',
      retrievedAt,
      acquisitionMethod: 'static_html',
      evidenceClass: 'retailer_listing',
      independenceKey: `${url.hostname}${url.pathname}:page-meta`,
      confidence: 0.62,
      specificity: 'exact_product',
    });
  }

  if (product) {
    const structuredBits = [
      product.name ? `상품명: ${product.name}` : undefined,
      product.brand ? `브랜드: ${product.brand}` : undefined,
      product.sku ? `SKU: ${product.sku}` : undefined,
      product.model ? `모델: ${product.model}` : undefined,
      product.offers?.price !== undefined ? `가격: ${product.offers.price}${product.offers.currency ? ` ${product.offers.currency}` : ''}` : undefined,
      facts?.shippingFee !== undefined ? `배송비: ${facts.shippingFee}` : undefined,
    ].filter(Boolean);
    evidence.push({
      claim: structuredBits.join(' / '),
      sourceUrl: url.toString(),
      sourceType: selectedExtractor ? `market_extractor:${selectedExtractor.id}` : 'json_ld_product',
      retrievedAt,
      acquisitionMethod: selectedExtractor ? 'static_html' : 'structured_data',
      evidenceClass: 'retailer_listing',
      independenceKey: `${url.hostname}${url.pathname}:${selectedExtractor ? `market-${selectedExtractor.id}` : 'jsonld-product'}`,
      confidence: selectedExtractor ? 0.82 : 0.78,
      specificity: 'exact_product',
      data: { product, ...(facts ? { facts } : {}) },
    });
  }

  const result: DirectPageResult = { url: url.toString(), evidence };
  if (title) result.title = title;
  if (description) result.description = description;
  if (siteName) result.siteName = siteName;
  if (product) result.product = product;
  if (facts) result.facts = facts;
  if (sellerLinks.length) result.sellerLinks = sellerLinks.map((item) => ({ ...item }));
  if (extraction?.promotion) result.promotion = { ...extraction.promotion };
  if (extraction?.sellerInfo) result.sellerInfo = { ...extraction.sellerInfo };
  return result;
}
