import type { DirectPageResult } from '../providers/direct-page.ts';
import type { SearchHit } from '../providers/index.ts';
import { evaluateShoppingConstraints } from './constraint-gate.ts';
import type {
  FactValue,
  ShoppingCandidate,
  ShoppingResearchPlan,
} from './types.ts';

export interface ShoppingEnrichmentDependencies {
  directPage: (url: string) => Promise<DirectPageResult>;
  publicSearch: (query: string) => Promise<SearchHit[]>;
}

const VERIFICATION_PRIORITY: Record<FactValue['verification'], number> = {
  search_metadata: 1,
  page_verified: 2,
  official: 3,
};

function cloneCandidate(candidate: ShoppingCandidate): ShoppingCandidate {
  return {
    ...candidate,
    variant: { ...candidate.variant },
    bundle: [...candidate.bundle],
    sourceUrls: [...candidate.sourceUrls],
    facts: Object.fromEntries(Object.entries(candidate.facts).map(([key, value]) => [key, { ...value, ...(Array.isArray(value.value) ? { value: [...value.value] } : {}) }])),
  };
}

function pageFact(value: FactValue['value'], sourceUrl: string): FactValue {
  return { value, verification: 'page_verified', sourceUrl };
}

function addIfPresent(target: Record<string, FactValue>, field: string, value: unknown, sourceUrl: string): void {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    target[field] = pageFact(value, sourceUrl);
  }
}

function factsFromPage(page: DirectPageResult): Record<string, FactValue> {
  const facts: Record<string, FactValue> = {};
  const attributes = {
    ...(page.product?.attributes ?? {}),
    ...(page.facts?.attributes ?? {}),
  };

  for (const [field, value] of Object.entries(attributes)) {
    addIfPresent(facts, field, value, page.url);
  }

  addIfPresent(facts, 'name', page.product?.name ?? page.facts?.name, page.url);
  addIfPresent(facts, 'brand', page.product?.brand ?? page.facts?.brand, page.url);
  addIfPresent(facts, 'model', page.product?.model ?? page.facts?.model, page.url);
  addIfPresent(facts, 'sku', page.product?.sku ?? page.facts?.sku, page.url);
  addIfPresent(facts, 'publicPrice', page.facts?.price ?? page.product?.offers?.price, page.url);
  addIfPresent(facts, 'shippingFee', page.facts?.shippingFee ?? page.product?.offers?.shippingFee, page.url);
  addIfPresent(facts, 'availability', page.facts?.availability ?? page.product?.offers?.availability, page.url);
  return facts;
}

function mergeFacts(target: Record<string, FactValue>, incoming: Record<string, FactValue>): void {
  for (const [field, fact] of Object.entries(incoming)) {
    const current = target[field];
    if (!current || VERIFICATION_PRIORITY[fact.verification] > VERIFICATION_PRIORITY[current.verification]) {
      target[field] = fact;
    }
  }
}

export async function lightEnrichCandidates(
  plan: ShoppingResearchPlan,
  candidates: ShoppingCandidate[],
  deps: ShoppingEnrichmentDependencies,
): Promise<ShoppingCandidate[]> {
  const output = candidates.map(cloneCandidate);
  const targets = output
    .filter((candidate) => candidate.constraintState !== 'EXCLUDED')
    .slice(0, plan.limits.lightEnrichment);

  await Promise.all(targets.map(async (candidate) => {
    const url = candidate.sourceUrls[0];
    if (!url) return;
    try {
      const page = await deps.directPage(url);
      mergeFacts(candidate.facts, factsFromPage(page));
    } catch {
      // Candidate-local failure is intentionally isolated. Existing evidence remains usable.
    }
    candidate.constraintState = evaluateShoppingConstraints(candidate, plan.hardConstraints).state;
  }));

  return output;
}
