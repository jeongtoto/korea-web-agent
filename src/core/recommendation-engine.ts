import {
  compileProductConstraints,
  constraintEligibility,
  evaluateProductConstraints,
} from './constraints.ts';
import type { MarketOffer, ProductCandidate, ProductRecommendation, PurchaseContext } from './types.ts';

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function contains(text: string, terms: readonly string[]): number {
  return terms.filter((term) => text.includes(term)).length;
}

function scoreCandidate(question: string, candidate: ProductCandidate, offers: MarketOffer[], context: PurchaseContext): ProductRecommendation {
  const text = candidate.title.toLowerCase();
  const bedding = /(이불|침구|차렵|구스|모달|순면|알러지)/.test(question);
  const fitSignals = bedding ? ['퀸', 'q', '사계절', '차렵', '세트'] : ['호환', '적합', '전용'];
  const qualitySignals = ['고밀도', '순면', '모달', '구스', '내구', '튼튼', '인증', '품질'];
  const reviewSignals = ['후기', '리뷰', '평점', '4.5', '4.6', '4.7', '4.8', '4.9'];
  const designSignals = ['레드', '버건디', '와인', '딥그레이', '그레이', '베이지', '호텔', '배색'];
  const careSignals = ['세탁가능', '세탁기', '먼지 적음', '알러지', '워싱', '사계절'];
  const riskSignals = ['세탁 어려움', '보풀', '소음', '반품', '중고', '품절', '불량'];

  const bestOffer = offers
    .filter((offer) => offer.eligible && offer.title.toLowerCase().includes(candidate.title.toLowerCase().split(' ')[0] ?? ''))
    .sort((a, b) => (a.totalCashPrice ?? Infinity) - (b.totalCashPrice ?? Infinity))[0];
  const preferenceMatches = (context.preferences ?? []).filter((preference) => text.includes(preference.toLowerCase())).length;
  const fit = clamp(0.4 + contains(text, fitSignals) * 0.12 + preferenceMatches * 0.08);
  const quality = clamp(0.35 + contains(text, qualitySignals) * 0.1);
  const reviews = clamp(0.25 + contains(text, reviewSignals) * 0.12 + candidate.score * 0.18 + Math.min(0.18, candidate.sourceUrls.length * 0.06) - (/(광고|협찬|sponsored)/i.test(text) ? 0.2 : 0));
  const design = clamp(0.3 + contains(text, designSignals) * 0.16);
  const care = clamp(0.3 + contains(text, careSignals) * 0.11 - contains(text, ['세탁 어려움']) * 0.25);
  const risk = clamp(0.8 - contains(text, riskSignals) * 0.14);
  const overBudget = Boolean(context.budget && bestOffer?.totalCashPrice && bestOffer.totalCashPrice > context.budget);
  const value = bestOffer?.totalCashPrice
    ? clamp(0.75 - Math.log10(Math.max(1, bestOffer.totalCashPrice)) * 0.03 - (overBudget ? 0.35 : 0))
    : clamp(0.35 + candidate.score * 0.25);
  const overall = clamp(fit * 0.23 + quality * 0.18 + reviews * 0.17 + design * 0.14 + care * 0.11 + risk * 0.09 + value * 0.08);
  const confidence = clamp(candidate.score * 0.65 + reviews * 0.25 + (bestOffer ? 0.1 : 0));
  const reasons = [
    fit >= 0.6 ? '요청한 크기·용도 적합 신호가 있습니다.' : '용도 적합성은 추가 확인이 필요합니다.',
    design >= 0.6 ? '요청한 공간·색상과 조화를 이루는 디자인 신호가 있습니다.' : '디자인 적합성 근거가 제한적입니다.',
    care >= 0.55 ? '세탁과 일상 관리가 비교적 쉬운 구성입니다.' : '세탁·관리 조건을 직접 확인해야 합니다.',
  ];
  const tradeoffs: string[] = [];
  if (reviews < 0.6) tradeoffs.push('독립적이고 반복된 리뷰 근거가 충분하지 않습니다.');
  if (!bestOffer) tradeoffs.push('동일 구성의 현재 구매가를 아직 검증하지 못했습니다.');
  if (risk < 0.65) tradeoffs.push('관리·상태·반품 관련 위험 신호가 있습니다.');
  if (overBudget) tradeoffs.push(`설정한 예산 ${context.budget?.toLocaleString('ko-KR')}원을 초과합니다.`);

  const recommendation: ProductRecommendation = {
    rank: 0,
    title: candidate.title,
    target: candidate.target,
    scores: { fit, quality, reviews, design, care, risk, value, overall },
    bestFor: design >= Math.max(fit, quality, care) ? '공간과 색상 조화' : care >= quality ? '관리 편의' : '균형 잡힌 품질과 적합성',
    reasons,
    tradeoffs,
    confidence,
    preliminary: confidence < 0.7,
  };
  if (bestOffer) recommendation.bestOffer = bestOffer;
  return recommendation;
}

export function buildRecommendations(input: {
  question: string;
  candidates: ProductCandidate[];
  offers?: MarketOffer[];
  purchaseContext?: PurchaseContext;
  limit?: number;
}): ProductRecommendation[] {
  const limit = Math.max(1, Math.min(input.limit ?? 3, 5));
  const constraints = compileProductConstraints(input.question);
  const scored = input.candidates.flatMap((candidate) => {
    const evaluations = evaluateProductConstraints(constraints, candidate.verifiedFacts ?? {});
    const eligibility = constraintEligibility(evaluations);
    if (eligibility === 'excluded') return [];
    const recommendation = scoreCandidate(input.question, candidate, input.offers ?? [], input.purchaseContext ?? {});
    return [{ recommendation, constraintEligibility: eligibility }];
  });

  const verified = scored.filter((item) => item.constraintEligibility === 'eligible');
  const pool = constraints.some((constraint) => constraint.strength === 'hard') && verified.length > 0
    ? verified
    : scored;

  return pool
    .sort((a, b) => {
      if (a.constraintEligibility !== b.constraintEligibility) {
        return a.constraintEligibility === 'eligible' ? -1 : 1;
      }
      return b.recommendation.scores.overall - a.recommendation.scores.overall
        || b.recommendation.confidence - a.recommendation.confidence;
    })
    .slice(0, limit)
    .map((item, index) => ({
      ...item.recommendation,
      rank: index + 1,
      preliminary: item.constraintEligibility === 'preliminary' || item.recommendation.preliminary,
    }));
}
