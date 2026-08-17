import { aggregateConfidence, normalizeEvidence } from '../core/evidence.ts';
import type { EvidenceItem, NormalizedTarget, PriceSnapshot, ProductReport, ReportDecision } from '../core/types.ts';

export interface ProductReportInput {
  target: NormalizedTarget;
  evidence: EvidenceItem[];
  personalizedPrice?: PriceSnapshot;
}

function numericData(item: EvidenceItem, key: string): number | undefined {
  const value = item.data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : undefined;
}

function titleFor(target: NormalizedTarget, evidence: EvidenceItem[]): string {
  if (target.name) return target.brand ? `${target.brand} ${target.name}` : target.name;
  for (const item of evidence) {
    const product = item.data?.product;
    if (product && typeof product === 'object') {
      const name = (product as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  if (target.brand && target.productId) return `${target.brand} ${target.productId}`;
  return '제품 분석';
}

function derivePublicPrice(evidence: EvidenceItem[]): PriceSnapshot | undefined {
  for (const item of evidence) {
    const product = item.data?.product;
    if (!product || typeof product !== 'object') continue;
    const offers = (product as Record<string, unknown>).offers;
    if (!offers || typeof offers !== 'object') continue;
    const offer = offers as Record<string, unknown>;
    const price = offer.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) continue;
    const currency = typeof offer.currency === 'string' ? offer.currency : 'KRW';
    return { currency, salePrice: price, sourceUrl: item.sourceUrl };
  }
  return undefined;
}

function weightedAverage(items: EvidenceItem[], key: string): number {
  let weighted = 0;
  let weight = 0;
  for (const item of items) {
    const value = numericData(item, key);
    if (value === undefined) continue;
    weighted += value * item.confidence;
    weight += item.confidence;
  }
  return weight > 0 ? weighted / weight : 0;
}

export function buildProductReport(input: ProductReportInput): ProductReport {
  const normalized = normalizeEvidence(input.evidence);
  const confidence = aggregateConfidence(normalized);
  const exactProductEvidence = normalized.filter((item) => (item.specificity ?? 'exact_product') === 'exact_product');
  const sentiment = weightedAverage(normalized, 'sentiment');
  const priceSignal = weightedAverage(normalized, 'priceSignal');
  const sources = new Set(normalized.map((item) => item.sourceUrl));

  const strengths = normalized
    .filter((item) => (numericData(item, 'sentiment') ?? 0) >= 0.35)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map((item) => item.claim);
  const weaknesses = normalized
    .filter((item) => (numericData(item, 'sentiment') ?? 0) <= -0.25)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map((item) => item.claim);

  const missingInformation: string[] = [];
  if (normalized.length < 2) missingInformation.push('독립적인 근거가 충분하지 않습니다.');
  if (exactProductEvidence.length === 0) missingInformation.push('이 제품 자체를 직접 평가한 근거가 확인되지 않았습니다.');
  if (!normalized.some((item) => item.evidenceClass === 'accredited_test' || item.evidenceClass === 'official_record')) {
    missingInformation.push('공인 시험·공식 기록 기반의 제품 검증 자료가 부족합니다.');
  }

  let decision: ReportDecision = 'INSUFFICIENT';
  if (normalized.length >= 2 && exactProductEvidence.length >= 1 && confidence >= 0.45) {
    if (sentiment <= -0.18) {
      decision = 'SKIP';
    } else if (priceSignal <= -0.45 && sentiment > -0.1) {
      decision = 'WAIT';
    } else if (sentiment >= 0.22 && priceSignal > -0.45) {
      decision = 'BUY';
    } else {
      decision = 'WAIT';
    }
  }

  const reasons = normalized
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4)
    .map((item) => item.claim);

  const summaryByDecision: Record<ReportDecision, string> = {
    BUY: '현재 확보된 독립 근거 기준으로 구매를 고려할 수 있습니다.',
    WAIT: '제품 자체의 문제라기보다 가격·근거 수준을 더 확인한 뒤 결정하는 편이 낫습니다.',
    SKIP: '현재 확보된 근거에서는 반복되는 부정적 신호가 구매 이점보다 큽니다.',
    INSUFFICIENT: '현재 근거만으로는 구매 여부를 신뢰도 있게 판단하기 어렵습니다.',
  };

  const report: ProductReport = {
    decision,
    confidence,
    title: titleFor(input.target, normalized),
    summary: summaryByDecision[decision],
    reasons,
    strengths,
    weaknesses,
    missingInformation,
    evidence: normalized,
    sourceCount: sources.size,
  };
  const price = derivePublicPrice(normalized);
  if (price) report.price = price;
  if (input.personalizedPrice) report.personalizedPrice = input.personalizedPrice;
  return report;
}
