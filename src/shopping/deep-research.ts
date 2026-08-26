import type { EvidenceClass } from '../core/types.ts';
import type { SearchHit } from '../providers/index.ts';
import { analyzeReviewClaim, type ReviewEvidence } from './review-intelligence.ts';
import { reviewClaimFingerprint, scoreReviewTrust } from './review-trust.ts';
import type { ShoppingCandidate, ShoppingResearchPlan } from './types.ts';

export interface DeepResearchDependencies {
  publicSearch: (query: string) => Promise<SearchHit[]>;
  now: () => Date;
}

export interface DeepResearchResult {
  researchedCandidateKeys: string[];
  reviewEvidence: ReviewEvidence[];
  sourceUrlsByCandidate: Record<string, string[]>;
  errors: string[];
}

interface DeepQuery {
  id: 'reviews' | 'negatives' | 'durability' | 'service';
  query: string;
}

function compactIdentity(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9가-힣]/g, '');
}

function identity(candidate: ShoppingCandidate): string {
  return [...new Set([candidate.brand, candidate.model, candidate.title].filter((value): value is string => Boolean(value?.trim())))]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function deepQueries(candidate: ShoppingCandidate): DeepQuery[] {
  const base = identity(candidate);
  return [
    { id: 'reviews', query: `${base} 실사용 후기 리뷰 장점` },
    { id: 'negatives', query: `${base} 단점 불량 고장 결함 문제` },
    { id: 'durability', query: `${base} 장기 사용 내구성 후기` },
    { id: 'service', query: `${base} A/S AS 보증 서비스 후기` },
  ];
}

function sourceClass(hit: SearchHit, claim: string): EvidenceClass {
  try {
    const host = new URL(hit.url).hostname.toLowerCase();
    if (/(협찬|광고|sponsored|제공받)/i.test(claim)) return 'sponsored_content';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'editorial_review';
    if (host.includes('blog.naver.com') || host.includes('cafe.naver.com') || host.includes('reddit.com')) return 'community_report';
    if (host.includes('coupang.com') || host.includes('shopping.naver.com') || host.includes('smartstore.naver.com')) {
      return 'retailer_listing';
    }
    return 'community_report';
  } catch {
    return 'community_report';
  }
}

function independenceKey(hit: SearchHit): string {
  try {
    const url = new URL(hit.url);
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    return `${url.hostname.toLowerCase()}${pathname}`;
  } catch {
    return hit.url;
  }
}

function versionTokens(value: string): Set<string> {
  return new Set((value.toUpperCase().match(/\bV\d+(?:-[A-Z]+)?\b/g) ?? []).map((token) => token.replace(/\s+/g, '')));
}

function reviewIdentityRelevance(candidate: ShoppingCandidate, claim: string): number {
  const claimCompact = compactIdentity(claim);
  const candidateText = `${candidate.model ?? ''} ${candidate.bundle.join(' ')} ${candidate.title}`;
  const candidateVersions = versionTokens(candidateText);
  const claimVersions = versionTokens(claim);
  if (candidateVersions.size && claimVersions.size && ![...candidateVersions].some((token) => claimVersions.has(token))) return 0;

  const model = compactIdentity(candidate.model);
  if (model && claimCompact.includes(model)) {
    const bundleTokens = candidate.bundle.map(compactIdentity).filter(Boolean);
    if (bundleTokens.length && bundleTokens.every((token) => claimCompact.includes(token))) return 1;
    return 0.8;
  }

  const family = compactIdentity(candidate.family);
  if (family && claimCompact.includes(family)) return 0.5;

  const brand = compactIdentity(candidate.brand);
  if (brand && claimCompact.includes(brand)) return 0.25;
  return 0.2;
}

export async function deepResearchCandidates(
  plan: ShoppingResearchPlan,
  candidates: ShoppingCandidate[],
  deps: DeepResearchDependencies,
): Promise<DeepResearchResult> {
  const finalists = candidates
    .filter((candidate) => candidate.constraintState !== 'EXCLUDED')
    .slice(0, plan.limits.deepResearch);
  const reviewEvidence: ReviewEvidence[] = [];
  const sourceUrlsByCandidate: Record<string, string[]> = {};
  const errors: string[] = [];

  await Promise.all(finalists.flatMap((candidate) => deepQueries(candidate).map(async (query) => {
    try {
      const hits = await deps.publicSearch(query.query);
      for (const hit of hits.slice(0, 5)) {
        const claim = [hit.title, hit.snippet].filter(Boolean).join(' — ').replace(/\s+/g, ' ').trim();
        if (!claim) continue;
        const urls = sourceUrlsByCandidate[candidate.key] ?? [];
        if (!urls.includes(hit.url)) urls.push(hit.url);
        sourceUrlsByCandidate[candidate.key] = urls;
        const now = deps.now();
        const baseEvidence = analyzeReviewClaim({
          candidateKey: candidate.key,
          claim,
          sourceClass: sourceClass(hit, claim),
          sourceUrl: hit.url,
          retrievedAt: now.toISOString(),
          independenceKey: independenceKey(hit),
          acquisitionMethod: 'search_metadata',
          identityRelevance: reviewIdentityRelevance(candidate, claim),
          verifiedPurchaseConfidence: 0,
          claimFingerprint: reviewClaimFingerprint(claim),
          sponsored: /(협찬|광고|sponsored|제공받)/i.test(claim),
          confidence: query.id === 'negatives' || query.id === 'durability' ? 0.7 : 0.66,
        });
        for (const item of baseEvidence) {
          const trust = scoreReviewTrust(item, now);
          reviewEvidence.push({ ...item, effectiveWeight: trust.effectiveWeight });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate.key}:${query.id}: ${message}`);
    }
  })));

  return {
    researchedCandidateKeys: finalists.map((candidate) => candidate.key),
    reviewEvidence,
    sourceUrlsByCandidate,
    errors,
  };
}
