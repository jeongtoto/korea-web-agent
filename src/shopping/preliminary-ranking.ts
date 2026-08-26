import type { ShoppingCandidate, ShoppingResearchPlan } from './types.ts';

export interface PreliminaryAssessment {
  candidate: ShoppingCandidate;
  score: number;
  verifiedFactCoverage: number;
  officialFactCoverage: number;
  sourceDiversity: number;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function constraintScore(candidate: ShoppingCandidate): number {
  if (candidate.constraintState === 'ELIGIBLE') return 1;
  if (candidate.constraintState === 'PRELIMINARY') return 0.45;
  return 0;
}

function factCoverage(candidate: ShoppingCandidate): {
  verifiedFactCoverage: number;
  officialFactCoverage: number;
  verifiedSpecQuality: number;
} {
  const facts = Object.values(candidate.facts);
  if (!facts.length) {
    return { verifiedFactCoverage: 0, officialFactCoverage: 0, verifiedSpecQuality: 0 };
  }

  const verified = facts.filter((fact) => fact.verification === 'page_verified' || fact.verification === 'official').length;
  const official = facts.filter((fact) => fact.verification === 'official').length;
  const verifiedFactCoverage = clamp(verified / Math.max(5, facts.length));
  const officialFactCoverage = clamp(official / Math.max(4, facts.length));
  const verifiedSpecQuality = clamp(verifiedFactCoverage * 0.72 + officialFactCoverage * 0.28);

  return { verifiedFactCoverage, officialFactCoverage, verifiedSpecQuality };
}

function distinctHosts(candidate: ShoppingCandidate): number {
  const hosts = new Set<string>();
  const urls = [
    ...candidate.sourceUrls,
    ...Object.values(candidate.facts).map((fact) => fact.sourceUrl),
  ];
  for (const url of urls) {
    try {
      hosts.add(new URL(url).hostname.toLowerCase().replace(/^www\./, ''));
    } catch {
      // Malformed provenance is ignored rather than making ranking fail.
    }
  }
  return hosts.size;
}

function identityStrength(candidate: ShoppingCandidate): number {
  if (candidate.model) return 1;
  if (candidate.family) return 0.65;
  return 0.35;
}

function categoryPotential(plan: ShoppingResearchPlan, candidate: ShoppingCandidate): number {
  const facts = candidate.facts;
  if (plan.categoryId === 'portable_display') {
    const fields = ['brightnessNits', 'refreshRateHz', 'smartOs', 'portableStand', 'warrantyMonths'];
    return clamp(fields.filter((field) => facts[field] !== undefined).length / fields.length);
  }
  if (plan.categoryId === 'bedding') {
    const fields = ['fabric', 'fillMaterial', 'fillWeightG', 'machineWashable', 'allergyFriendly'];
    return clamp(fields.filter((field) => facts[field] !== undefined).length / fields.length);
  }
  return 0.5;
}

function assessment(plan: ShoppingResearchPlan, candidate: ShoppingCandidate): PreliminaryAssessment {
  const coverage = factCoverage(candidate);
  const sourceDiversity = clamp(Math.min(3, distinctHosts(candidate)) / 3);
  const score = clamp(
    constraintScore(candidate) * 0.35 +
    coverage.verifiedSpecQuality * 0.25 +
    identityStrength(candidate) * 0.15 +
    sourceDiversity * 0.10 +
    categoryPotential(plan, candidate) * 0.05 +
    clamp(candidate.discoveryScore) * 0.10,
  );

  return {
    candidate,
    score,
    verifiedFactCoverage: coverage.verifiedFactCoverage,
    officialFactCoverage: coverage.officialFactCoverage,
    sourceDiversity,
  };
}

export function rankPreliminaryCandidates(
  plan: ShoppingResearchPlan,
  candidates: ShoppingCandidate[],
  limit: number,
): PreliminaryAssessment[] {
  return candidates
    .filter((candidate) => candidate.constraintState !== 'EXCLUDED')
    .map((candidate) => assessment(plan, candidate))
    .sort((a, b) => {
      if (a.candidate.constraintState !== b.candidate.constraintState) {
        return a.candidate.constraintState === 'ELIGIBLE' ? -1 : 1;
      }
      return b.score - a.score ||
        b.verifiedFactCoverage - a.verifiedFactCoverage ||
        a.candidate.key.localeCompare(b.candidate.key);
    })
    .slice(0, Math.max(0, limit));
}
