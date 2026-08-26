import type { AcquisitionMethod, EvidenceClass } from '../core/types.ts';
import { collapseReviewIndependence } from './review-trust.ts';

export type ReviewPolarity = 'positive' | 'neutral' | 'negative';

export interface ReviewEvidence {
  candidateKey: string;
  topic: string;
  polarity: ReviewPolarity;
  sourceClass: EvidenceClass;
  acquisitionMethod?: AcquisitionMethod;
  identityRelevance?: number;
  verifiedPurchaseConfidence?: number;
  verifiedPurchase?: boolean;
  sponsored?: boolean;
  publishedAt?: string;
  retrievedAt: string;
  sourceUrl: string;
  independenceKey: string;
  authorKey?: string;
  claimFingerprint?: string;
  independenceConfidence?: number;
  effectiveWeight?: number;
  confidence: number;
  claim: string;
}

export interface ReviewConsensus {
  topic: string;
  positiveWeight: number;
  negativeWeight: number;
  independentSources: number;
  confidence: number;
}

export interface AnalyzeReviewClaimInput {
  candidateKey: string;
  claim: string;
  sourceClass: EvidenceClass;
  sourceUrl: string;
  retrievedAt: string;
  independenceKey: string;
  acquisitionMethod?: AcquisitionMethod;
  identityRelevance?: number;
  verifiedPurchaseConfidence?: number;
  authorKey?: string;
  claimFingerprint?: string;
  effectiveWeight?: number;
  verifiedPurchase?: boolean;
  sponsored?: boolean;
  publishedAt?: string;
  confidence?: number;
}

interface TopicPattern {
  topic: string;
  positive: RegExp[];
  negative: RegExp[];
}

const TOPIC_PATTERNS: TopicPattern[] = [
  {
    topic: 'display_quality',
    positive: [/(?:화질|화면).{0,18}(?:선명|깨끗|좋|만족|또렷)/i, /(?:선명|또렷).{0,12}(?:화질|화면)/i],
    negative: [/(?:화질|화면).{0,18}(?:흐릿|어둡|별로|나쁘|깨짐|잔상)/i],
  },
  {
    topic: 'stand_stability',
    positive: [/(?:스탠드|거치대).{0,18}(?:안정|튼튼|견고|흔들림\s*없)/i],
    negative: [/(?:스탠드|거치대).{0,18}(?:흔들|불안|약하|넘어|기울)/i, /흔들.{0,12}(?:스탠드|거치대)/i],
  },
  {
    topic: 'speaker_quality',
    positive: [/(?:스피커|소리|음질).{0,18}(?:좋|선명|괜찮|만족|풍부)/i],
    negative: [/(?:스피커|소리|음질).{0,18}(?:약하|작다|작음|별로|답답|나쁘|부족)/i],
  },
  {
    topic: 'fabric_softness',
    positive: [/(?:촉감|원단|이불).{0,18}(?:부드럽|포근|좋|만족|보들)/i, /부드럽.{0,12}(?:촉감|원단|이불)?/i],
    negative: [/(?:촉감|원단|이불).{0,18}(?:까슬|거칠|뻣뻣|불편)/i],
  },
  {
    topic: 'washing_durability',
    positive: [/(?:세탁|빨래).{0,22}(?:변형\s*없|보풀\s*없|멀쩡|튼튼|유지)/i],
    negative: [/(?:세탁|빨래).{0,24}(?:보풀|변형|수축|뭉침|터짐|손상)/i, /보풀.{0,16}(?:생기|심하)/i],
  },
  {
    topic: 'dust_shedding',
    positive: [/(?:먼지|털빠짐).{0,16}(?:적|없)/i],
    negative: [/(?:먼지|털빠짐).{0,16}(?:많|심하|날림)/i],
  },
  {
    topic: 'service_quality',
    positive: [/(?:a\/?s|as|서비스|고객센터).{0,20}(?:빠르|친절|좋|만족|원활)/i],
    negative: [/(?:a\/?s|as|서비스|고객센터).{0,20}(?:느리|불친절|안됨|거절|어렵|불만)/i],
  },
  {
    topic: 'durability',
    positive: [/(?:내구|오래\s*사용|장기\s*사용).{0,22}(?:좋|튼튼|문제\s*없|멀쩡)/i],
    negative: [/(?:고장|불량|파손|내구).{0,22}(?:반복|잦|약|문제|심하)/i],
  },
];

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sourceMultiplier(item: ReviewEvidence): number {
  let multiplier = 1;
  if (item.sourceClass === 'verified_purchase_review') multiplier *= 1.08;
  else if (item.sourceClass === 'sponsored_content') multiplier *= 0.45;
  else if (item.sourceClass === 'editorial_review') multiplier *= 0.9;
  if (item.verifiedPurchase) multiplier *= 1.08;
  if (item.sponsored) multiplier *= 0.45;
  return Math.min(1.1, multiplier);
}

function baseConfidence(input: AnalyzeReviewClaimInput): number {
  if (input.confidence !== undefined) return clamp(input.confidence);
  if (input.verifiedPurchase) return 0.82;
  if (input.sourceClass === 'verified_purchase_review') return 0.78;
  if (input.sourceClass === 'editorial_review') return 0.7;
  if (input.sourceClass === 'community_report') return 0.66;
  if (input.sourceClass === 'sponsored_content' || input.sponsored) return 0.45;
  return 0.58;
}

function polarityFor(pattern: TopicPattern, claim: string): ReviewPolarity | null {
  const positive = pattern.positive.some((regex) => regex.test(claim));
  const negative = pattern.negative.some((regex) => regex.test(claim));
  if (positive && !negative) return 'positive';
  if (negative && !positive) return 'negative';
  if (positive && negative) return 'neutral';
  return null;
}

export function analyzeReviewClaim(input: AnalyzeReviewClaimInput): ReviewEvidence[] {
  const claim = input.claim.replace(/\s+/g, ' ').trim();
  if (!claim) return [];
  const sponsored = input.sponsored ?? /(협찬|광고|sponsored|제공받)/i.test(claim);
  const confidence = baseConfidence({ ...input, sponsored });
  const output: ReviewEvidence[] = [];

  for (const pattern of TOPIC_PATTERNS) {
    const polarity = polarityFor(pattern, claim);
    if (!polarity) continue;
    output.push({
      candidateKey: input.candidateKey,
      topic: pattern.topic,
      polarity,
      sourceClass: sponsored && input.sourceClass !== 'verified_purchase_review' ? 'sponsored_content' : input.sourceClass,
      retrievedAt: input.retrievedAt,
      sourceUrl: input.sourceUrl,
      independenceKey: input.independenceKey,
      confidence,
      claim,
      ...(input.acquisitionMethod ? { acquisitionMethod: input.acquisitionMethod } : {}),
      ...(input.identityRelevance !== undefined ? { identityRelevance: input.identityRelevance } : {}),
      ...(input.verifiedPurchaseConfidence !== undefined ? { verifiedPurchaseConfidence: input.verifiedPurchaseConfidence } : {}),
      ...(input.authorKey ? { authorKey: input.authorKey } : {}),
      ...(input.claimFingerprint ? { claimFingerprint: input.claimFingerprint } : {}),
      ...(input.effectiveWeight !== undefined ? { effectiveWeight: input.effectiveWeight } : {}),
      ...(input.verifiedPurchase !== undefined ? { verifiedPurchase: input.verifiedPurchase } : {}),
      ...(sponsored ? { sponsored: true } : {}),
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    });
  }

  return output;
}

export function deduplicateReviewEvidence(items: ReviewEvidence[]): ReviewEvidence[] {
  const byKey = new Map<string, ReviewEvidence>();
  for (const item of collapseReviewIndependence(items)) {
    const key = `${item.candidateKey}|${item.topic}|${item.independenceKey}`;
    const existing = byKey.get(key);
    const itemWeight = (item.effectiveWeight ?? item.confidence) * (item.independenceConfidence ?? 1);
    const existingWeight = existing
      ? (existing.effectiveWeight ?? existing.confidence) * (existing.independenceConfidence ?? 1)
      : -1;
    if (!existing || itemWeight > existingWeight) byKey.set(key, item);
  }
  return [...byKey.values()];
}

export function aggregateReviewConsensus(items: ReviewEvidence[]): ReviewConsensus[] {
  const deduped = deduplicateReviewEvidence(items);
  const topics = new Map<string, ReviewEvidence[]>();
  for (const item of deduped) {
    const bucket = topics.get(item.topic) ?? [];
    bucket.push(item);
    topics.set(item.topic, bucket);
  }

  return [...topics.entries()].map(([topic, evidence]) => {
    let positiveWeight = 0;
    let negativeWeight = 0;
    let confidenceWeight = 0;
    let confidenceTotal = 0;
    let sponsoredOnly = true;

    for (const item of evidence) {
      const baseEffective = item.effectiveWeight !== undefined
        ? clamp(item.effectiveWeight)
        : clamp(item.confidence * sourceMultiplier(item));
      const effective = clamp(baseEffective * (item.independenceConfidence ?? 1));
      if (item.polarity === 'positive') positiveWeight += effective;
      if (item.polarity === 'negative') negativeWeight += effective;
      if (item.polarity === 'neutral') {
        positiveWeight += effective * 0.25;
        negativeWeight += effective * 0.25;
      }
      confidenceTotal += effective;
      confidenceWeight += 1;
      if (!item.sponsored && item.sourceClass !== 'sponsored_content') sponsoredOnly = false;
    }

    const independentSources = new Set(evidence.map((item) => item.independenceKey)).size;
    const average = confidenceWeight ? confidenceTotal / confidenceWeight : 0;
    const coverageMultiplier = independentSources >= 3 ? 1 : independentSources === 2 ? 0.8 : independentSources === 1 ? 0.55 : 0.35;
    let confidence = clamp(average * coverageMultiplier);
    if (sponsoredOnly) confidence = Math.min(confidence, 0.6);

    return {
      topic,
      positiveWeight,
      negativeWeight,
      independentSources,
      confidence,
    };
  }).sort((a, b) => b.confidence - a.confidence || a.topic.localeCompare(b.topic));
}
