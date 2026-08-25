import { normalizeEvidence } from '../core/evidence.ts';
import { candidateIdentityFromText, compareCanonicalIdentity } from '../core/identity-match.ts';
import { matchEvidenceToProduct } from '../core/product-match.ts';
import type {
  CanonicalIdentityMatch,
  EvidenceItem,
  MarketOffer,
  NormalizedTarget,
  OfferCondition,
  PriceSnapshot,
  ResearchJob,
} from '../core/types.ts';
import { buildProductReport } from '../report/product-report.ts';
import { rankMarketOffers } from '../core/offer-engine.ts';
import { buildRecommendations } from '../core/recommendation-engine.ts';
import { selectNaverLiveProductCard } from './naver-live.ts';
import { sanitizeRelayResult } from './protocol.ts';

const ALLOWED_CONDITIONS: OfferCondition[] = ['new', 'refurbished', 'open_box', 'display', 'used', 'unknown'];

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, 20) : [];
}

function sanitizedObject(rawResult: unknown): Record<string, unknown> {
  const result = sanitizeRelayResult(rawResult);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Relay result must be an object');
  return result as Record<string, unknown>;
}

function conditionField(value: unknown): OfferCondition | undefined {
  const condition = stringField(value) as OfferCondition | undefined;
  return condition && ALLOWED_CONDITIONS.includes(condition) ? condition : undefined;
}

function priceFromObject(object: Record<string, unknown>): PriceSnapshot {
  const price: PriceSnapshot = { currency: stringField(object.currency) ?? 'KRW' };
  const numericKeys = [
    'listPrice',
    'couponPrice',
    'membershipPrice',
    'sellerInstantDiscount',
    'couponDiscount',
    'cardInstantDiscount',
    'cardStatementDiscount',
    'membershipDiscount',
    'cashPaymentPrice',
    'estimatedPoints',
    'basePoints',
    'membershipPoints',
    'liveSpecialPoints',
    'totalExpectedPoints',
    'effectivePrice',
    'shippingFee',
  ] as const;
  const salePrice = numberField(object.price ?? object.salePrice);
  if (salePrice !== undefined) price.salePrice = salePrice;
  for (const key of numericKeys) {
    const value = numberField(object[key]);
    if (value !== undefined) price[key] = value;
  }

  const textKeys = [
    'shippingEta',
    'selectedOption',
    'availability',
    'dealType',
    'liveId',
    'liveStatus',
    'liveEndAt',
    'sourceUrl',
  ] as const;
  for (const key of textKeys) {
    const value = stringField(object[key]);
    if (value) price[key] = value;
  }
  return price;
}

export function normalizeRelayPrice(rawResult: unknown): PriceSnapshot {
  return priceFromObject(sanitizedObject(rawResult));
}

function hasUsefulCommerceFields(price: PriceSnapshot): boolean {
  return [
    price.listPrice,
    price.salePrice,
    price.couponPrice,
    price.membershipPrice,
    price.sellerInstantDiscount,
    price.couponDiscount,
    price.cardInstantDiscount,
    price.cardStatementDiscount,
    price.membershipDiscount,
    price.cashPaymentPrice,
    price.estimatedPoints,
    price.basePoints,
    price.membershipPoints,
    price.liveSpecialPoints,
    price.totalExpectedPoints,
    price.effectivePrice,
    price.shippingFee,
  ].some((value) => typeof value === 'number' && Number.isFinite(value)) ||
    Boolean(price.shippingEta || price.selectedOption || price.availability || price.dealType || price.liveId || price.liveStatus || price.liveEndAt);
}

function relayTitleConsistent(job: ResearchJob, title: string): boolean {
  const target = job.target;
  const hasResolvedDescriptors = Boolean(target.name || target.model || target.variant);
  if (!hasResolvedDescriptors) return true;
  const normalizedName = target.name?.toLowerCase().replace(/[^0-9a-z가-힣]+/gi, '');
  const normalizedTitle = title.toLowerCase().replace(/[^0-9a-z가-힣]+/gi, '');
  if (normalizedName && normalizedName.length >= 6 && normalizedTitle.includes(normalizedName)) return true;

  let isNaverLive = false;
  try {
    const parsed = new URL(job.request.url ?? '');
    isNaverLive = parsed.hostname.toLowerCase() === 'view.shoppinglive.naver.com'
      && /^\/lives\/\d+(?:\/|$)/.test(parsed.pathname);
  } catch {
    // The research request validator handles malformed URLs elsewhere.
  }
  if (isNaverLive) {
    const hint = {
      ...(target.brand ? { brand: target.brand } : {}),
      ...(target.name ? { name: target.name } : {}),
      ...(target.model ? { model: target.model } : {}),
      ...(target.variant ? { variant: target.variant } : {}),
      ...(target.productId ? { productId: target.productId } : {}),
      ...(target.liveId ? { liveId: target.liveId } : {}),
    };
    const matched = selectNaverLiveProductCard([{
      locatorIndex: 0,
      title,
      destinationUrl: 'https://product.shoppinglive.naver.com/bridge/v4/product/shopping',
    }], hint);
    if (matched) return true;
  }

  const descriptorTarget: NormalizedTarget = {
    kind: 'product',
    ...(target.brand ? { brand: target.brand } : {}),
    ...(target.name ? { name: target.name } : {}),
    ...(target.model ? { model: target.model } : {}),
    ...(target.variant ? { variant: target.variant } : {}),
  };
  const match = matchEvidenceToProduct(descriptorTarget, {
    title,
    url: 'https://relay.invalid/product',
    snippet: '',
  });
  return match.level === 'exact_product' || match.level === 'probable_product';
}

function canonicalRelayIdentityMatch(
  job: ResearchJob,
  object: Record<string, unknown>,
  title: string | undefined,
): CanonicalIdentityMatch | undefined {
  const canonicalIdentity = job.researchContext?.recommendationMode
    ? undefined
    : job.researchContext?.canonicalIdentity;
  if (!canonicalIdentity) return undefined;
  const text = [
    title,
    stringField(object.selectedOption),
    stringField(object.model),
    stringField(object.sku),
    stringField(object.variant),
  ].filter((value): value is string => Boolean(value)).join(' ');
  const candidate = candidateIdentityFromText(text, conditionField(object.condition));
  return compareCanonicalIdentity(canonicalIdentity, candidate);
}

function rejectRelayIdentity(
  job: ResearchJob,
  completedAt: string,
  match?: CanonicalIdentityMatch,
): ResearchJob {
  const detail = match ? ` (${match.verdict})` : '';
  const message = `Relay page identity did not match the requested exact bundle${detail}; personalized commerce fields were ignored.`;
  return {
    ...job,
    status: 'partial',
    updatedAt: completedAt,
    completedAt,
    sourceResults: [
      ...job.sourceResults.filter((source) => source.source !== 'local_relay'),
      {
        source: 'local_relay',
        success: false,
        acquisitionMethod: 'local_relay',
        attemptedAt: completedAt,
        completedAt,
        evidence: [],
        error: message,
      },
    ],
    relay: {
      available: true,
      used: false,
      mode: 'public_only',
      message,
    },
    errors: job.errors.includes(message) ? job.errors : [...job.errors, message],
  };
}

function mergeTarget(job: ResearchJob, title: string | undefined): NormalizedTarget {
  const target: NormalizedTarget = job.target.kind === 'unknown'
    ? { ...job.target, kind: 'product' }
    : { ...job.target };
  if (title) target.name = title;
  return target;
}

function relayEvidence(job: ResearchJob, target: NormalizedTarget, price: PriceSnapshot, title: string | undefined, at: string): EvidenceItem {
  const url = job.request.url ?? target.canonicalUrl ?? 'https://example.invalid/';
  const bits: string[] = [];
  if (title) bits.push(`상품명 ${title}`);
  if (price.listPrice !== undefined) bits.push(`정상가 ${price.listPrice} ${price.currency}`);
  if (price.salePrice !== undefined) bits.push(`판매가 ${price.salePrice} ${price.currency}`);
  if (price.couponPrice !== undefined) bits.push(`쿠폰 적용가 ${price.couponPrice} ${price.currency}`);
  if (price.membershipPrice !== undefined) bits.push(`멤버십 가격 ${price.membershipPrice} ${price.currency}`);
  if (price.cashPaymentPrice !== undefined) bits.push(`실결제가 ${price.cashPaymentPrice} ${price.currency}`);
  if (price.effectivePrice !== undefined) bits.push(`적립 포함 체감가 ${price.effectivePrice} ${price.currency}`);
  if (price.sellerInstantDiscount !== undefined) bits.push(`판매자 즉시할인 ${price.sellerInstantDiscount} ${price.currency}`);
  if (price.couponDiscount !== undefined) bits.push(`쿠폰 할인 ${price.couponDiscount} ${price.currency}`);
  if (price.cardInstantDiscount !== undefined) bits.push(`카드 즉시할인 ${price.cardInstantDiscount} ${price.currency}`);
  if (price.estimatedPoints !== undefined) bits.push(`예상 적립 ${price.estimatedPoints} ${price.currency}`);
  if (price.shippingFee !== undefined) bits.push(`배송비 ${price.shippingFee} ${price.currency}`);
  if (price.shippingEta) bits.push(`배송 예정 ${price.shippingEta}`);
  if (price.selectedOption) bits.push(`선택 옵션 ${price.selectedOption}`);
  if (price.availability) bits.push(`재고 상태 ${price.availability}`);
  if (price.dealType) bits.push(`딜 유형 ${price.dealType}`);
  if (price.liveId) bits.push(`라이브 ID ${price.liveId}`);
  return {
    claim: bits.length ? bits.join(' / ') : '로그인 세션에서 읽기 전용 상품 페이지 확인을 완료함',
    sourceUrl: url,
    sourceType: hasUsefulCommerceFields(price) ? 'local_authenticated_price' : 'local_authenticated_identity',
    retrievedAt: at,
    acquisitionMethod: 'local_relay',
    evidenceClass: 'retailer_listing',
    independenceKey: `local-relay:${url}`,
    confidence: title ? 0.88 : 0.72,
    specificity: title || hasUsefulCommerceFields(price) ? 'exact_product' : 'category',
    data: {
      ...(title ? { product: { name: title } } : {}),
      ...(hasUsefulCommerceFields(price) ? { priceSnapshot: price } : {}),
    },
  };
}

export function applyPersonalizedRelayResult(job: ResearchJob, rawResult: unknown, completedAt = new Date().toISOString()): ResearchJob {
  const object = sanitizedObject(rawResult);
  if (Array.isArray(object.offers)) return applyBatchRelayResult(job, object.offers, completedAt);
  const rawTitle = stringField(object.title);
  const canonicalMatch = canonicalRelayIdentityMatch(job, object, rawTitle);
  if (canonicalMatch && canonicalMatch.verdict !== 'exact') {
    return rejectRelayIdentity(job, completedAt, canonicalMatch);
  }
  const titleRejected = Boolean(!canonicalMatch && rawTitle && !relayTitleConsistent(job, rawTitle));
  if (titleRejected) return rejectRelayIdentity(job, completedAt);

  const title = rawTitle;
  const price = priceFromObject(object);
  const usefulCommerce = hasUsefulCommerceFields(price);
  const target = mergeTarget(job, title);
  const localEvidence = relayEvidence(job, target, price, title, completedAt);
  const evidence = normalizeEvidence([...job.evidence.filter((item) => item.acquisitionMethod !== 'local_relay'), localEvidence]);
  const sourceResults = [
    ...job.sourceResults.filter((source) => source.source !== 'local_relay'),
    {
      source: 'local_relay',
      success: true,
      acquisitionMethod: 'local_relay' as const,
      attemptedAt: completedAt,
      completedAt,
      evidence: [localEvidence],
    },
  ];
  const relay = {
    available: true,
    used: true,
    mode: 'local_authenticated' as const,
    message: usefulCommerce
      ? 'Personalized read-only commerce fields were read from the local authenticated browser.'
      : title
        ? 'The authenticated browser confirmed product identity but returned no personalized price or delivery fields.'
        : 'The authenticated browser returned no useful normalized commerce fields.',
  };
  const status: ResearchJob['status'] = job.errors.length ? 'partial' : 'completed';
  const report = buildProductReport({
    target,
    evidence,
    ...(usefulCommerce ? { personalizedPrice: price } : {}),
    ...(job.researchContext?.intent ? { intent: job.researchContext.intent } : {}),
    ...(job.researchContext?.identityConfidence !== undefined ? { identityConfidence: job.researchContext.identityConfidence } : {}),
  });
  if (job.report?.offers) report.offers = job.report.offers;
  if (job.report?.bestOffers) report.bestOffers = job.report.bestOffers;
  if (job.report?.marketCoverage) report.marketCoverage = job.report.marketCoverage;
  if (job.report?.recommendations) report.recommendations = job.report.recommendations;
  if (job.report?.manualChecks) report.manualChecks = job.report.manualChecks;
  if (job.report?.priceHistory) report.priceHistory = job.report.priceHistory;

  return {
    ...job,
    status,
    updatedAt: completedAt,
    completedAt,
    target,
    ...(job.researchContext ? { researchContext: { ...job.researchContext, resolvedTarget: { ...target } } } : {}),
    evidence,
    sourceResults,
    relay,
    report,
  };
}

function applyBatchRelayResult(job: ResearchJob, rawOffers: unknown[], completedAt: string): ResearchJob {
  const verifiedOffers: MarketOffer[] = [];
  const localEvidence: EvidenceItem[] = [];
  let primaryPrice: PriceSnapshot | undefined;
  let primaryTitle: string | undefined;
  let canonicalRejected = 0;

  for (const raw of rawOffers.slice(0, 8)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const object = raw as Record<string, unknown>;
    const url = stringField(object.url);
    const market = stringField(object.market);
    const title = stringField(object.title);
    if (!url || !market || !title) continue;
    const rawHint = object.targetHint && typeof object.targetHint === 'object' && !Array.isArray(object.targetHint)
      ? object.targetHint as Record<string, unknown>
      : {};
    const expectedTarget: NormalizedTarget = {
      kind: 'product',
      ...Object.fromEntries(['brand', 'name', 'model', 'variant', 'productId', 'liveId']
        .flatMap((key) => {
          const value = stringField(rawHint[key]);
          return value ? [[key, value]] : [];
        })),
    };
    const temporaryJob: ResearchJob = { ...job, target: Object.keys(rawHint).length ? expectedTarget : job.target, request: { ...job.request, url } };
    const canonicalMatch = canonicalRelayIdentityMatch(job, object, title);
    const titleConsistent = canonicalMatch
      ? canonicalMatch.verdict === 'exact'
      : relayTitleConsistent(temporaryJob, title);
    if (canonicalMatch && canonicalMatch.verdict !== 'exact') canonicalRejected += 1;
    const price = priceFromObject(object);
    const condition = conditionField(object.condition) ?? 'unknown';
    const bundleComplete = typeof object.bundleComplete === 'boolean' ? object.bundleComplete : true;
    const salePrice = price.cashPaymentPrice ?? price.couponPrice ?? price.membershipPrice ?? price.salePrice;
    const shippingFee = price.shippingFee;
    const totalCashPrice = numberField(object.totalCashPrice) ?? (salePrice !== undefined && shippingFee !== undefined ? salePrice + shippingFee : undefined);
    const points = price.totalExpectedPoints ?? price.estimatedPoints;
    const effectivePrice = price.effectivePrice ?? (totalCashPrice !== undefined && points !== undefined ? Math.max(0, totalCashPrice - points) : undefined);
    const exclusionReasons: string[] = [];
    if (!titleConsistent) exclusionReasons.push('인증 페이지 상품명이 요청 제품과 일치하지 않습니다.');
    if (!bundleComplete) exclusionReasons.push('요청한 세트/패키지 전체 구성이 아닙니다.');
    const offer: MarketOffer = {
      id: `${market}:${url}`,
      market,
      title,
      url,
      currency: price.currency,
      retrievedAt: completedAt,
      verification: 'page_verified',
      condition,
      identityScore: canonicalMatch?.confidence ?? (titleConsistent ? 0.9 : 0.2),
      bundleComplete,
      eligible: exclusionReasons.length === 0,
      ...(canonicalMatch ? { identityVerdict: canonicalMatch.verdict } : {}),
      conditions: stringArray(object.conditions),
      riskFlags: stringArray(object.riskFlags),
      exclusionReasons,
    };
    if (price.listPrice !== undefined) offer.listPrice = price.listPrice;
    if (price.salePrice !== undefined) offer.salePrice = price.salePrice;
    if (price.couponPrice !== undefined) offer.couponPrice = price.couponPrice;
    if (price.membershipPrice !== undefined) offer.membershipPrice = price.membershipPrice;
    const cardPrice = numberField(object.cardPrice);
    if (cardPrice !== undefined) offer.cardPrice = cardPrice;
    const cardName = stringField(object.cardName);
    if (cardName) offer.cardName = cardName;
    if (points !== undefined) offer.points = points;
    if (price.shippingFee !== undefined) offer.shippingFee = price.shippingFee;
    if (totalCashPrice !== undefined) offer.totalCashPrice = totalCashPrice;
    if (effectivePrice !== undefined) offer.effectivePrice = effectivePrice;
    if (price.availability) offer.availability = price.availability;
    verifiedOffers.push(offer);

    if (titleConsistent) {
      localEvidence.push(relayEvidence(temporaryJob, temporaryJob.target, price, title, completedAt));
      if (!primaryPrice || url === job.request.url) {
        primaryPrice = price;
        primaryTitle = title;
      }
    }
  }

  const successCount = verifiedOffers.filter((offer) => offer.eligible).length;
  if (canonicalRejected > 0 && successCount === 0) {
    return rejectRelayIdentity(job, completedAt);
  }

  const target = mergeTarget(job, primaryTitle);
  const evidence = normalizeEvidence([...job.evidence.filter((item) => item.acquisitionMethod !== 'local_relay'), ...localEvidence]);
  const publicOffers = job.report?.offers ?? [];
  const offersByUrl = new Map(publicOffers.map((offer) => [offer.url, offer]));
  for (const offer of verifiedOffers) offersByUrl.set(offer.url, offer);
  const offers = [...offersByUrl.values()];
  const { bestOffers } = rankMarketOffers(offers, job.request.purchaseContext ?? {});
  const report = buildProductReport({
    target,
    evidence,
    ...(primaryPrice && hasUsefulCommerceFields(primaryPrice) ? { personalizedPrice: primaryPrice } : {}),
    ...(job.researchContext?.intent ? { intent: job.researchContext.intent } : {}),
    ...(job.researchContext?.identityConfidence !== undefined ? { identityConfidence: job.researchContext.identityConfidence } : {}),
  });
  report.offers = offers;
  report.bestOffers = bestOffers;
  if (job.report?.priceHistory) report.priceHistory = job.report.priceHistory;
  if (job.researchContext?.recommendationCandidates?.length) {
    report.recommendations = buildRecommendations({
      question: job.request.question,
      candidates: job.researchContext.recommendationCandidates,
      offers,
      ...(job.request.purchaseContext ? { purchaseContext: job.request.purchaseContext } : {}),
    });
  } else if (job.report?.recommendations) report.recommendations = job.report.recommendations;
  if (job.report?.manualChecks) report.manualChecks = job.report.manualChecks;
  if (successCount === 0) {
    report.manualChecks = [
      ...(report.manualChecks ?? []),
      { type: 'login', message: '전용 브라우저의 로그인 상태와 상품 페이지 표시 여부를 직접 확인해야 합니다.', ...(job.request.url ? { url: job.request.url } : {}) },
    ];
  }
  report.marketCoverage = (job.report?.marketCoverage ?? []).map((coverage) => {
    const verified = verifiedOffers.filter((offer) => offer.market === coverage.market && offer.eligible).length;
    return verified ? { ...coverage, verified, status: 'verified' as const } : coverage;
  });

  return {
    ...job,
    status: job.errors.length ? 'partial' : 'completed',
    updatedAt: completedAt,
    completedAt,
    target,
    ...(job.researchContext ? { researchContext: { ...job.researchContext, resolvedTarget: { ...target } } } : {}),
    evidence,
    sourceResults: [
      ...job.sourceResults.filter((source) => source.source !== 'local_relay'),
      { source: 'local_relay', success: successCount > 0, acquisitionMethod: 'local_relay', attemptedAt: completedAt, completedAt, evidence: localEvidence, ...(successCount ? {} : { error: 'No identity-matched authenticated offers were returned.' }) },
    ],
    relay: {
      available: true,
      used: successCount > 0,
      mode: successCount > 0 ? 'local_authenticated' : 'public_only',
      message: `${successCount} authenticated read-only market offer(s) were verified; ${verifiedOffers.length - successCount} mismatched or incomplete offer(s) were excluded.`,
    },
    report,
  };
}
