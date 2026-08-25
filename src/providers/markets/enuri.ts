import { createComparisonMarketProvider, extractComparisonSellerLinks } from '../comparison-provider.ts';
import type { MarketPageExtractor } from '../market-extractor.ts';
import { providerDefinitionById } from '../provider-registry.ts';

const definition = providerDefinitionById('enuri');
if (!definition) throw new Error('Enuri provider definition is missing');

export const enuriProvider = createComparisonMarketProvider(definition);

export const enuriExtractor: MarketPageExtractor = {
  id: 'enuri',
  matches: (url) => url.hostname === 'enuri.com' || url.hostname.endsWith('.enuri.com'),
  extract: ({ url, html }) => ({
    sellerLinks: extractComparisonSellerLinks(html, url),
  }),
};
