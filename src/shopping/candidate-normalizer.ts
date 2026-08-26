import type { OfferCondition } from '../core/types.ts';
import type { FactValue, ShoppingCandidate, ShoppingRawHit, ShoppingResearchPlan } from './types.ts';

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizedToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function modelTokens(text: string): string[] {
  const tokens = text.toUpperCase().match(/[A-Z][A-Z0-9_-]{3,}/g) ?? [];
  return [...new Set(tokens
    .map(normalizedToken)
    .filter((token) => /[A-Z]/.test(token) && /\d/.test(token) && !/^(?:FHD|UHD|HDR)\d*$/.test(token)))];
}

function primaryModel(text: string): string | undefined {
  const tokens = modelTokens(text);
  return tokens.find((token) => !/^EKWBYME/i.test(token)) ?? tokens[0];
}

function screenSize(text: string): number | undefined {
  const match = text.match(/(\d{2,3})\s*(?:인치|inch|형)/i);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function resolution(text: string): string | undefined {
  if (/\b4k\b|\buhd\b/i.test(text)) return '4K';
  if (/\bfhd\b|full\s*hd/i.test(text)) return 'FHD';
  if (/\bqhd\b/i.test(text)) return 'QHD';
  return undefined;
}

function standVersion(text: string): string | undefined {
  const match = text.match(/(?:\(|\b)V\s*([0-9]+)(?:\)|\b)/i);
  return match?.[1] ? `V${match[1]}` : undefined;
}

function condition(text: string): OfferCondition {
  if (/리퍼|refurb/i.test(text)) return 'refurbished';
  if (/반품|오픈\s*박스|open[ -]?box/i.test(text)) return 'open_box';
  if (/전시|display/i.test(text)) return 'display';
  if (/중고|used/i.test(text)) return 'used';
  return 'new';
}

function bedSize(text: string): string | undefined {
  if (/(?:^|\s)(?:q|queen)(?:\s|$)|퀸/i.test(text)) return 'QUEEN';
  if (/(?:^|\s)(?:s|single)(?:\s|$)|싱글/i.test(text)) return 'SINGLE';
  if (/킹|king/i.test(text)) return 'KING';
  return undefined;
}

function brand(text: string, model: string | undefined): string | undefined {
  if (!model) return undefined;
  const index = text.toUpperCase().indexOf(model);
  const prefix = index >= 0 ? compact(text.slice(0, index)) : '';
  const tokens = prefix.match(/[A-Za-z가-힣][A-Za-z0-9가-힣-]*/g) ?? [];
  const candidate = tokens.at(-1);
  if (!candidate || /^(?:TV|티비|모니터|브랜드)$/i.test(candidate)) return undefined;
  return candidate;
}

function bundleComponents(text: string, model: string | undefined): string[] {
  return modelTokens(text).filter((token) => token !== model).sort();
}

function searchFact(value: FactValue['value'], sourceUrl: string): FactValue {
  return { value, verification: 'search_metadata', sourceUrl };
}

function variantAndFacts(hit: ShoppingRawHit): {
  variant: Record<string, string | number | boolean>;
  facts: Record<string, FactValue>;
} {
  const variant: Record<string, string | number | boolean> = {};
  const facts: Record<string, FactValue> = {};
  const text = `${hit.title} ${hit.snippet}`;
  const size = screenSize(text);
  const displayResolution = resolution(text);
  const version = standVersion(text);
  const beddingSize = bedSize(text);

  if (size !== undefined) {
    variant.screenSizeInch = size;
    facts.screenSizeInch = searchFact(size, hit.url);
  }
  if (displayResolution) {
    variant.resolution = displayResolution;
    facts.resolution = searchFact(displayResolution, hit.url);
  }
  if (version) variant.standVersion = version;
  if (/(이동식|이동형|무빙|스탠바이미)/i.test(text)) facts.portableStand = searchFact(true, hit.url);
  if (beddingSize) {
    variant.bedSize = beddingSize;
    facts.bedSize = searchFact(beddingSize, hit.url);
  }
  if (/사계절/i.test(text)) facts.allSeason = searchFact(true, hit.url);
  if (/차렵/i.test(text)) facts.beddingType = searchFact('comforter', hit.url);

  return { variant, facts };
}

function keyFor(
  hit: ShoppingRawHit,
  model: string | undefined,
  variant: Record<string, string | number | boolean>,
  bundle: string[],
  offerCondition: OfferCondition,
): string {
  const identity = [
    model ?? '',
    variant.screenSizeInch ?? '',
    variant.resolution ?? '',
    variant.standVersion ?? '',
    variant.bedSize ?? '',
    bundle.join('+'),
    offerCondition,
  ].join('|').toUpperCase();
  if (model) return identity;
  return `TITLE|${compact(hit.title).toUpperCase().replace(/[^A-Z0-9가-힣]+/g, ' ')}|${offerCondition}`;
}

function scoreFor(model: string | undefined, variant: Record<string, string | number | boolean>, bundle: string[]): number {
  let score = model ? 0.72 : 0.34;
  if (variant.screenSizeInch !== undefined) score += 0.05;
  if (variant.resolution !== undefined) score += 0.05;
  if (variant.standVersion !== undefined) score += 0.04;
  if (variant.bedSize !== undefined) score += 0.04;
  if (bundle.length) score += 0.04;
  return Math.min(0.95, score);
}

function mergeFacts(existing: Record<string, FactValue>, incoming: Record<string, FactValue>): void {
  const priority: Record<FactValue['verification'], number> = { search_metadata: 1, page_verified: 2, official: 3 };
  for (const [key, value] of Object.entries(incoming)) {
    const current = existing[key];
    if (!current || priority[value.verification] > priority[current.verification]) existing[key] = value;
  }
}

export function normalizeShoppingCandidates(raw: ShoppingRawHit[], plan: ShoppingResearchPlan): ShoppingCandidate[] {
  const grouped = new Map<string, ShoppingCandidate>();

  for (const hit of raw) {
    const text = `${hit.title} ${hit.snippet}`;
    const model = primaryModel(text);
    const parsedBrand = brand(hit.title, model);
    const { variant, facts } = variantAndFacts(hit);
    const bundle = bundleComponents(text, model);
    const offerCondition = condition(text);
    const key = keyFor(hit, model, variant, bundle, offerCondition);
    const score = scoreFor(model, variant, bundle);
    const existing = grouped.get(key);

    if (existing) {
      if (!existing.sourceUrls.includes(hit.url)) existing.sourceUrls.push(hit.url);
      existing.discoveryScore = Math.min(1, Math.max(existing.discoveryScore, score) + 0.04);
      mergeFacts(existing.facts, facts);
      if (hit.title.length > existing.title.length && model) existing.title = hit.title;
      continue;
    }

    const candidate: ShoppingCandidate = {
      key,
      variant,
      bundle,
      condition: offerCondition,
      title: hit.title,
      sourceUrls: [hit.url],
      discoveryScore: score,
      facts,
      constraintState: 'PRELIMINARY',
    };
    if (parsedBrand) candidate.brand = parsedBrand;
    if (model) candidate.model = model;
    grouped.set(key, candidate);
  }

  return [...grouped.values()]
    .sort((a, b) => b.discoveryScore - a.discoveryScore || Number(Boolean(b.model)) - Number(Boolean(a.model)) || a.key.localeCompare(b.key))
    .slice(0, plan.limits.normalizedCandidates);
}
