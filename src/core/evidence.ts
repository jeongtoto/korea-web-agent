import type { EvidenceClass, EvidenceItem, ProductSpecificity } from './types.ts';

const CLASS_WEIGHT: Record<EvidenceClass, number> = {
  official_record: 0.96,
  accredited_test: 0.97,
  peer_reviewed_research: 0.91,
  manufacturer_spec: 0.70,
  retailer_listing: 0.62,
  verified_purchase_review: 0.77,
  community_report: 0.58,
  editorial_review: 0.65,
  sponsored_content: 0.34,
  inferred_analysis: 0.50,
};

const SPECIFICITY_MULTIPLIER: Record<ProductSpecificity, number> = {
  exact_product: 1,
  category: 0.90,
  general_mechanism: 0.78,
};

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function scoreEvidence(item: EvidenceItem): number {
  const raw = clamp(item.confidence);
  if (raw === 0) return 0;

  const classWeight = CLASS_WEIGHT[item.evidenceClass];
  const specificity = item.specificity ?? 'exact_product';
  const specificityMultiplier = SPECIFICITY_MULTIPLIER[specificity];
  const sponsoredMultiplier = item.sponsored || item.evidenceClass === 'sponsored_content' ? 0.72 : 1;

  return clamp(((raw + classWeight) / 2) * specificityMultiplier * sponsoredMultiplier);
}

export function dedupeEvidence(items: readonly EvidenceItem[]): EvidenceItem[] {
  const strongest = new Map<string, EvidenceItem>();

  for (const item of items) {
    const key = item.independenceKey.trim() || `${item.sourceUrl}|${item.claim.trim().toLowerCase()}`;
    const existing = strongest.get(key);
    if (!existing || scoreEvidence(item) > scoreEvidence(existing)) {
      strongest.set(key, item);
    }
  }

  return [...strongest.values()];
}

export function normalizeEvidence(items: readonly EvidenceItem[]): EvidenceItem[] {
  return dedupeEvidence(items).map((item) => ({
    ...item,
    confidence: scoreEvidence(item),
  }));
}

export function aggregateConfidence(items: readonly EvidenceItem[]): number {
  const normalized = normalizeEvidence(items);
  if (normalized.length === 0) return 0;

  // Independent evidence compounds, but a report should rarely claim absolute certainty.
  let missProbability = 1;
  for (const item of normalized) {
    const contribution = item.confidence * 0.55;
    missProbability *= 1 - contribution;
  }

  return Math.min(0.97, clamp(1 - missProbability));
}
