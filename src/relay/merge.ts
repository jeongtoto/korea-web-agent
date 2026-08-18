import { normalizeEvidence } from '../core/evidence.ts';
import type { EvidenceItem, NormalizedTarget, PriceSnapshot, ResearchJob } from '../core/types.ts';
import { buildProductReport } from '../report/product-report.ts';
import { sanitizeRelayResult } from './protocol.ts';

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizedObject(rawResult: unknown): Record<string, unknown> {
  const result = sanitizeRelayResult(rawResult);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Relay result must be an object');
  return result as Record<string, unknown>;
}

function priceFromObject(object: Record<string, unknown>): PriceSnapshot {
  const price: PriceSnapshot = { currency: stringField(object.currency) ?? 'KRW' };
  const salePrice = numberField(object.price ?? object.salePrice);
  const couponPrice = numberField(object.couponPrice);
  const membershipPrice = numberField(object.membershipPrice);
  const estimatedPoints = numberField(object.estimatedPoints);
  const shippingFee = numberField(object.shippingFee);
  const shippingEta = stringField(object.shippingEta);
  const selectedOption = stringField(object.selectedOption);
  const availability = stringField(object.availability);
  if (salePrice !== undefined) price.salePrice = salePrice;
  if (couponPrice !== undefined) price.couponPrice = couponPrice;
  if (membershipPrice !== undefined) price.membershipPrice = membershipPrice;
  if (estimatedPoints !== undefined) price.estimatedPoints = estimatedPoints;
  if (shippingFee !== undefined) price.shippingFee = shippingFee;
  if (shippingEta) price.shippingEta = shippingEta;
  if (selectedOption) price.selectedOption = selectedOption;
  if (availability) price.availability = availability;
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
    price.estimatedPoints,
    price.shippingFee,
  ].some((value) => typeof value === 'number' && Number.isFinite(value)) ||
    Boolean(price.shippingEta || price.selectedOption || price.availability);
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
  if (price.salePrice !== undefined) bits.push(`판매가 ${price.salePrice} ${price.currency}`);
  if (price.couponPrice !== undefined) bits.push(`쿠폰가 ${price.couponPrice} ${price.currency}`);
  if (price.membershipPrice !== undefined) bits.push(`멤버십 가격 ${price.membershipPrice} ${price.currency}`);
  if (price.estimatedPoints !== undefined) bits.push(`예상 적립 ${price.estimatedPoints} ${price.currency}`);
  if (price.shippingFee !== undefined) bits.push(`배송비 ${price.shippingFee} ${price.currency}`);
  if (price.shippingEta) bits.push(`배송 예정 ${price.shippingEta}`);
  if (price.selectedOption) bits.push(`선택 옵션 ${price.selectedOption}`);
  if (price.availability) bits.push(`재고 상태 ${price.availability}`);
  return {
    claim: bits.length ? bits.join(' / ') : '로그인 세션에서 읽기 전용 상품 페이지 확인을 완료함',
    sourceUrl: url,
    sourceType: hasUsefulCommerceFields(price) ? 'local_authenticated_price' : 'local_authenticated_identity',
    retrievedAt: at,
    acquisitionMethod: 'local_relay',
    evidenceClass: 'retailer_listing',
    independenceKey: `local-relay:${url}`,
    confidence: title ? 0.88 : 0.82,
    specificity: 'exact_product',
    data: {
      ...(title ? { product: { name: title } } : {}),
      ...(hasUsefulCommerceFields(price) ? { priceSnapshot: price } : {}),
    },
  };
}

export function applyPersonalizedRelayResult(job: ResearchJob, rawResult: unknown, completedAt = new Date().toISOString()): ResearchJob {
  const object = sanitizedObject(rawResult);
  const title = stringField(object.title);
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
  });

  return {
    ...job,
    status,
    updatedAt: completedAt,
    completedAt,
    target,
    evidence,
    sourceResults,
    relay,
    report,
  };
}
