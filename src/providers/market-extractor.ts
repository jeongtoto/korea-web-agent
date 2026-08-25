import type { PromotionState, SellerInfo } from '../core/types.ts';
import type { DirectProductFacts, StructuredProduct } from './direct-page.ts';

export interface ExtractedSellerLink {
  url: string;
  sellerName?: string;
  productId?: string;
  advertisedPrice?: number;
  advertisedShipping?: number;
}

export interface MarketExtraction {
  product?: StructuredProduct;
  facts?: DirectProductFacts;
  sellerLinks?: ExtractedSellerLink[];
  promotion?: PromotionState;
  sellerInfo?: SellerInfo;
}

export interface MarketPageExtractor {
  id: string;
  matches(url: URL): boolean;
  extract(input: { url: URL; html: string; retrievedAt: string }): MarketExtraction;
}

export function matchingMarketExtractor(
  value: MarketPageExtractor | readonly MarketPageExtractor[] | undefined,
  url: URL,
): MarketPageExtractor | undefined {
  if (!value) return undefined;
  const extractors = Array.isArray(value) ? value : [value];
  return extractors.find((extractor) => extractor.matches(url));
}
