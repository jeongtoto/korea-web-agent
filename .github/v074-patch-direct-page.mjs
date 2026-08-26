import fs from 'node:fs';

const path = 'src/providers/direct-page.ts';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label} match count=${count}`);
  text = text.replace(oldText, newText);
}

replaceOnce(
  "import { extractComparisonSellerLinks, isComparisonPortalHost } from './comparison-links.ts';\n",
  "import { extractComparisonSellerLinks, isComparisonPortalHost } from './comparison-links.ts';\nimport { extractEmbeddedSellerRecords, type EmbeddedSellerRecord } from './seller-resolution.ts';\n",
  'seller-resolution import',
);

replaceOnce(
  "  sellerLinks?: ExtractedSellerLink[];\n  promotion?: PromotionState;\n",
  "  sellerLinks?: ExtractedSellerLink[];\n  embeddedSellerRecords?: EmbeddedSellerRecord[];\n  promotion?: PromotionState;\n",
  'DirectPageResult field',
);

replaceOnce(
  "  const fallbackSellerLinks = isComparisonPortalHost(url) ? extractComparisonSellerLinks(html, url) : [];\n  const sellerLinks = extraction?.sellerLinks?.length ? extraction.sellerLinks : fallbackSellerLinks;\n  const evidence: EvidenceItem[] = [];\n",
  "  const fallbackSellerLinks = isComparisonPortalHost(url) ? extractComparisonSellerLinks(html, url) : [];\n  const sellerLinks = extraction?.sellerLinks?.length ? extraction.sellerLinks : fallbackSellerLinks;\n  const embeddedSellerRecords = isComparisonPortalHost(url) ? extractEmbeddedSellerRecords(html, url) : [];\n  const evidence: EvidenceItem[] = [];\n",
  'embedded extraction',
);

replaceOnce(
  "  if (sellerLinks.length) result.sellerLinks = sellerLinks.map((item) => ({ ...item }));\n  if (extraction?.promotion) result.promotion = { ...extraction.promotion };\n",
  "  if (sellerLinks.length) result.sellerLinks = sellerLinks.map((item) => ({ ...item }));\n  if (embeddedSellerRecords.length) result.embeddedSellerRecords = embeddedSellerRecords.map((item) => ({ ...item }));\n  if (extraction?.promotion) result.promotion = { ...extraction.promotion };\n",
  'result assembly',
);

fs.writeFileSync(path, text);
