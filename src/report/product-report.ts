import { normalizeEvidence } from '../core/evidence.ts';
import type {
  EvidenceItem,
  NormalizedTarget,
  PriceSnapshot,
  ProductConfidenceDimensions,
  ProductReport,
  ReportDecision,
  ResearchIntent,
} from '../core/types.ts';

export interface ProductReportInput {
  target: NormalizedTarget;
  evidence: EvidenceItem[];
  personalizedPrice?: PriceSnapshot;
  intent?: ResearchIntent;
  identityConfidence?: number;
}

const DEFAULT_INTENT: ResearchIntent = {
  productResearch: true,
  purchaseDecision: false,
  priceSensitive: false,
  personalizedPriceUseful: false,
  specOnly: false,
};

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function numericData(item: EvidenceItem, key: string): number | undefined {
  const value = item.data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : undefined;
}

function titleFor(target: NormalizedTarget, evidence: EvidenceItem[]): string {
  if (target.name) return target.brand && !target.name.toLowerCase().startsWith(target.brand.toLowerCase())
    ? `${target.brand} ${target.name}`
    : target.name;
  for (const item of evidence) {
    const product = item.data?.product;
    if (product && typeof product === 'object') {
      const name = (product as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  if (target.brand && target.productId) return `${target.brand} ${target.productId}`;
  if (target.productId) return `상품 ${target.productId}`;
  return '제품 분석';
}

function derivePublicPrice(evidence: EvidenceItem[]): PriceSnapshot | undefined {
  let best: { confidence: number; price: PriceSnapshot } | undefined;
  for (const item of evidence) {
    if (item.specificity !== 'exact_product') continue;
    const product = item.data?.product;
    if (!product || typeof product !== 'object') continue;
    const offers = (product as Record<string, unknown>).offers;
    if (!offers || typeof offers !== 'object') continue;
    const offer = offers as Record<string, unknown>;
    const rawPrice = offer.price ?? offer.salePrice ?? offer.lowPrice;
    if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) || rawPrice <= 0) continue;
    const currency = typeof offer.currency === 'string'
      ? offer.currency
      : typeof offer.priceCurrency === 'string'
        ? offer.priceCurrency
        : 'KRW';
    const price: PriceSnapshot = { currency, salePrice: rawPrice, sourceUrl: item.sourceUrl };
    if (!best || item.confidence > best.confidence) best = { confidence: item.confidence, price };
  }
  return best?.price;
}

function hasUsablePrice(price: PriceSnapshot | undefined): boolean {
  if (!price) return false;
  return [price.couponPrice, price.membershipPrice, price.salePrice, price.listPrice]
    .some((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
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

function defaultIdentityConfidence(target: NormalizedTarget): number {
  if (target.productId && target.name) return 0.92;
  if (target.brand && target.model && target.variant) return 0.9;
  if (target.brand && target.model) return 0.84;
  if (target.brand && target.name) return 0.8;
  if (target.productId) return 0.65;
  if (target.name) return 0.55;
  return 0.2;
}

function reviewConfidence(items: EvidenceItem[]): number {
  if (!items.length) return 0;
  const top = items.slice().sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  const average = top.reduce((sum, item) => sum + item.confidence, 0) / top.length;
  const coverage = items.length >= 3 ? 1 : items.length === 2 ? 0.85 : 0.5;
  return clamp(average * coverage);
}

function officialConfidence(items: EvidenceItem[]): number {
  const official = items.filter((item) =>
    item.specificity === 'exact_product' &&
    ['official_record', 'accredited_test', 'manufacturer_spec'].includes(item.evidenceClass));
  return clamp(Math.max(0, ...official.map((item) => item.confidence)));
}

function negativeCoverage(items: EvidenceItem[]): number {
  if (!items.length) return 0;
  const negatives = items.filter((item) => (numericData(item, 'sentiment') ?? 0) <= -0.25).length;
  const independentCoverage = Math.min(0.65, items.length * 0.2);
  const negativeBoost = Math.min(0.25, negatives * 0.1);
  return clamp(independentCoverage + negativeBoost);
}

function dimensionsFor(
  target: NormalizedTarget,
  exactEvidence: EvidenceItem[],
  reviewEvidence: EvidenceItem[],
  publicPrice: PriceSnapshot | undefined,
  personalizedPrice: PriceSnapshot | undefined,
  identityConfidence: number | undefined,
): ProductConfidenceDimensions {
  const usefulPersonalized = hasUsablePrice(personalizedPrice);
  const price = usefulPersonalized
    ? 0.95
    : hasUsablePrice(publicPrice)
      ? clamp(Math.max(0.7, ...exactEvidence
        .filter((item) => item.data?.product)
        .map((item) => item.confidence)))
      : 0;
  return {
    identity: clamp(identityConfidence ?? defaultIdentityConfidence(target)),
    price,
    officialSpecs: officialConfidence(exactEvidence),
    reviews: reviewConfidence(reviewEvidence),
    negativeSignals: negativeCoverage(reviewEvidence),
    personalizedPrice: usefulPersonalized ? 0.95 : 0,
  };
}

function overallConfidence(dimensions: ProductConfidenceDimensions, intent: ResearchIntent): number {
  if (intent.priceSensitive) {
    return clamp(
      dimensions.identity * 0.30 +
      dimensions.price * 0.25 +
      dimensions.reviews * 0.25 +
      dimensions.officialSpecs * 0.10 +
      dimensions.negativeSignals * 0.10,
    );
  }
  return clamp(
    dimensions.identity * 0.35 +
    dimensions.officialSpecs * 0.25 +
    dimensions.reviews * 0.25 +
    dimensions.negativeSignals * 0.15,
  );
}

export function buildProductReport(input: ProductReportInput): ProductReport {
  const intent = input.intent ?? DEFAULT_INTENT;
  const normalized = normalizeEvidence(input.evidence);
  const exactProductEvidence = normalized.filter((item) => (item.specificity ?? 'exact_product') === 'exact_product');
  const reviewEvidence = exactProductEvidence.filter((item) =>
    ['verified_purchase_review', 'community_report', 'editorial_review'].includes(item.evidenceClass) &&
    numericData(item, 'sentiment') !== undefined);
  const qualityEvidence = exactProductEvidence.filter((item) =>
    numericData(item, 'sentiment') !== undefined && item.evidenceClass !== 'retailer_listing');
  const sentiment = weightedAverage(qualityEvidence, 'sentiment');
  const priceSignal = weightedAverage(exactProductEvidence, 'priceSignal');
  const sources = new Set(normalized.map((item) => item.sourceUrl));
  const publicPrice = derivePublicPrice(normalized);
  const dimensions = dimensionsFor(
    input.target,
    exactProductEvidence,
    reviewEvidence,
    publicPrice,
    input.personalizedPrice,
    input.identityConfidence,
  );
  const confidence = overallConfidence(dimensions, intent);
  const usablePrice = hasUsablePrice(input.personalizedPrice) || hasUsablePrice(publicPrice);

  const strengths = qualityEvidence
    .filter((item) => (numericData(item, 'sentiment') ?? 0) >= 0.35)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map((item) => item.claim);
  const weaknesses = qualityEvidence
    .filter((item) => (numericData(item, 'sentiment') ?? 0) <= -0.25)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map((item) => item.claim);

  const missingInformation: string[] = [];
  if (dimensions.identity < 0.7) missingInformation.push('제품 식별 신뢰도가 충분하지 않습니다.');
  if (qualityEvidence.length < 2) missingInformation.push('이 제품 자체를 직접 평가한 독립적인 품질·사용 근거가 충분하지 않습니다.');
  if (intent.priceSensitive && !usablePrice) missingInformation.push('현재 구매 판단에 필요한 사용 가능한 가격을 확인하지 못했습니다.');
  if (dimensions.officialSpecs === 0) missingInformation.push('공식 사양·공인 시험 기반의 직접 제품 자료가 부족합니다.');

  let decision: ReportDecision = 'INSUFFICIENT';
  const repeatedNegative = weaknesses.length >= 2 && sentiment <= -0.25;
  const identityResolved = dimensions.identity >= 0.7;
  const qualitySufficient = qualityEvidence.length >= 2;

  if (identityResolved && qualitySufficient) {
    if (repeatedNegative) {
      decision = 'SKIP';
    } else if (intent.priceSensitive && !usablePrice) {
      decision = 'INSUFFICIENT';
    } else if (usablePrice && priceSignal <= -0.35 && sentiment > -0.15) {
      decision = 'WAIT';
    } else if (sentiment >= 0.22 && (!intent.priceSensitive || usablePrice)) {
      decision = 'BUY';
    }
  }

  const reasons = normalized
    .slice()
    .sort((a, b) => {
      const aExact = a.specificity === 'exact_product' ? 1 : 0;
      const bExact = b.specificity === 'exact_product' ? 1 : 0;
      return (bExact - aExact) || (b.confidence - a.confidence);
    })
    .slice(0, 4)
    .map((item) => item.claim);

  const summaryByDecision: Record<ReportDecision, string> = {
    BUY: '현재 제품 근거와 확인 가능한 가격을 기준으로 구매를 고려할 수 있습니다.',
    WAIT: '제품 자체보다 현재 가격·구매 타이밍이 불리하다는 근거가 있어 기다리는 편이 낫습니다.',
    SKIP: '현재 확보된 직접 근거에서는 반복되는 부정적 신호가 구매 이점보다 큽니다.',
    INSUFFICIENT: '제품 식별·가격·직접 근거 중 필요한 항목이 부족해 구매 여부를 신뢰도 있게 단정하기 어렵습니다.',
  };

  const report: ProductReport = {
    decision,
    confidence,
    confidenceDimensions: dimensions,
    title: titleFor(input.target, normalized),
    summary: summaryByDecision[decision],
    reasons,
    strengths,
    weaknesses,
    missingInformation,
    evidence: normalized,
    sourceCount: sources.size,
  };
  if (publicPrice) report.price = publicPrice;
  if (input.personalizedPrice) report.personalizedPrice = input.personalizedPrice;
  return report;
}
