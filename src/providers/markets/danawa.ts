import { createComparisonMarketProvider, extractComparisonSellerLinks } from '../comparison-provider.ts';
import type { MarketPageExtractor } from '../market-extractor.ts';
import { providerDefinitionById } from '../provider-registry.ts';

const definition = providerDefinitionById('danawa');
if (!definition) throw new Error('Danawa provider definition is missing');

export const danawaProvider = createComparisonMarketProvider(definition);

export const danawaExtractor: MarketPageExtractor = {
  id: 'danawa',
  matches: (url) => url.hostname === 'danawa.com' || url.hostname.endsWith('.danawa.com'),
  extract: ({ url, html }) => ({
    sellerLinks: extractComparisonSellerLinks(html, url),
  }),
};
