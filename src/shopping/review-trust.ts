import type { ReviewEvidence } from './review-intelligence.ts';

export interface ReviewTrustScore {
  sourceTrust: number;
  identityRelevance: number;
  independenceConfidence: number;
  recencyFactor: number;
  sponsorshipFactor: number;
  verifiedPurchaseConfidence: number;
  effectiveWeight: number;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function canonicalHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'invalid-host';
  }
}

function normalizedIdentity(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toLowerCase();
}

export function reviewClaimFingerprint(claim: string): string {
  return claim
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\d[\d,.]*/g, '#')
    .replace(/[^a-z0-9가-힣#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function recencyFactor(publishedAt: string | undefined, now: Date): number {
  if (!publishedAt) return 0.7;
  const published = new Date(publishedAt);
  if (!Number.isFinite(published.getTime()) || published.getTime() > now.getTime()) return 0.7;
  const ageDays = (now.getTime() - published.getTime()) / 86_400_000;
  if (ageDays <= 180) return 1;
  if (ageDays <= 365) return 0.9;
  if (ageDays <= 730) return 0.75;
  return 0.6;
}

function sourceTrust(item: ReviewEvidence): number {
  const acquisition = item.acquisitionMethod;
  const sponsored = item.sponsored || item.sourceClass === 'sponsored_content';
  if (sponsored) return 0.4;
  if (acquisition === 'search_metadata') return 0.55;
  if (item.sourceClass === 'verified_purchase_review') return 1;
  if (item.sourceClass === 'community_report') return 0.82;
  if (item.sourceClass === 'editorial_review') return 0.78;
  if (item.sourceClass === 'retailer_listing') return 0.65;
  return 0.65;
}

function verifiedPurchaseConfidence(item: ReviewEvidence): number {
  if (item.acquisitionMethod === 'search_metadata') return 0;
  if (item.verifiedPurchaseConfidence !== undefined) return clamp(item.verifiedPurchaseConfidence);
  if (item.verifiedPurchase) return 1;
  return item.sourceClass === 'verified_purchase_review' ? 0.8 : 0;
}

export function scoreReviewTrust(item: ReviewEvidence, now: Date): ReviewTrustScore {
  const source = sourceTrust(item);
  const identity = clamp(item.identityRelevance ?? 0.5);
  const independence = clamp(item.independenceConfidence ?? 1);
  const recency = recencyFactor(item.publishedAt, now);
  const sponsorship = item.sponsored || item.sourceClass === 'sponsored_content' ? 0.45 : 1;
  const purchaseConfidence = verifiedPurchaseConfidence(item);
  const purchaseFactor = 0.85 + purchaseConfidence * 0.15;
  const effectiveWeight = clamp(
    clamp(item.confidence) * source * identity * independence * recency * sponsorship * purchaseFactor,
  );

  return {
    sourceTrust: source,
    identityRelevance: identity,
    independenceConfidence: independence,
    recencyFactor: recency,
    sponsorshipFactor: sponsorship,
    verifiedPurchaseConfidence: purchaseConfidence,
    effectiveWeight,
  };
}

export function collapseReviewIndependence(items: ReviewEvidence[]): ReviewEvidence[] {
  const sameOrigin = new Map<string, ReviewEvidence>();

  for (const item of items) {
    const fingerprint = item.claimFingerprint ?? reviewClaimFingerprint(item.claim);
    const host = canonicalHost(item.sourceUrl);
    // Existing independenceKey is an explicit author/channel/source-family identity.
    // When authorKey is available it is more specific; otherwise preserve independenceKey.
    const sourceIdentity = normalizedIdentity(item.authorKey) || normalizedIdentity(item.independenceKey);
    const key = `${item.candidateKey}|${item.topic}|${host}|${sourceIdentity}|${fingerprint}`;
    const normalized: ReviewEvidence = { ...item, claimFingerprint: fingerprint };
    const existing = sameOrigin.get(key);
    if (!existing || (normalized.effectiveWeight ?? normalized.confidence) > (existing.effectiveWeight ?? existing.confidence)) {
      sameOrigin.set(key, normalized);
    }
  }

  const collapsed = [...sameOrigin.values()];
  const fingerprintCounts = new Map<string, number>();
  return collapsed.map((item) => {
    const fingerprint = item.claimFingerprint ?? reviewClaimFingerprint(item.claim);
    const sourceIdentity = normalizedIdentity(item.authorKey) || normalizedIdentity(item.independenceKey);
    // Diminishing weight applies to the same asserted source identity syndicated across hosts,
    // not to genuinely distinct authors who happen to describe the same defect similarly.
    const groupKey = `${item.candidateKey}|${item.topic}|${sourceIdentity}|${fingerprint}`;
    const index = fingerprintCounts.get(groupKey) ?? 0;
    fingerprintCounts.set(groupKey, index + 1);
    const independenceConfidence = index === 0 ? 1 : index === 1 ? 0.35 : 0.15;
    return { ...item, claimFingerprint: fingerprint, independenceConfidence };
  });
}
