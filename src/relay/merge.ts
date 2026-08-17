import { normalizeEvidence } from '../core/evidence.ts';
import type { EvidenceItem, PriceSnapshot, ResearchJob } from '../core/types.ts';
import { buildProductReport } from '../report/product-report.ts';
import { sanitizeRelayResult } from './protocol.ts';

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function normalizeRelayPrice(rawResult: unknown): PriceSnapshot {
  const result = sanitizeRelayResult(rawResult);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Relay result must be an object');
  const object = result as Record<string, unknown>;
  const price: PriceSnapshot = { currency: stringField(object.currency) ?? 'KRW' };
  const salePrice = numberField(object.price ?? object.salePrice);
  const couponPrice = numberField(object.couponPrice);
  const membershipPrice = numberField(object.membershipPrice);
  const estimatedPoints = numberField(object.estimatedPoints);
  const shippingFee = numberField(object.shippingFee);
  const shippingEta = stringField(object.shippingEta);
  if (salePrice !== undefined) price.salePrice = salePrice;
  if (couponPrice !== undefined) price.couponPrice = couponPrice;
  if (membershipPrice !== undefined) price.membershipPrice = membershipPrice;
  if (estimatedPoints !== undefined) price.estimatedPoints = estimatedPoints;
  if (shippingFee !== undefined) price.shippingFee = shippingFee;
  if (shippingEta) price.shippingEta = shippingEta;
  return price;
}

function relayEvidence(job: ResearchJob, price: PriceSnapshot, at: string): EvidenceItem {
  const url = job.request.url ?? job.target.canonicalUrl ?? 'https://example.invalid/';
  const bits: string[] = [];
  if (price.salePrice !== undefined) bits.push(`판매가 ${price.salePrice} ${price.currency}`);
  if (price.couponPrice !== undefined) bits.push(`쿠폰가 ${price.couponPrice} ${price.currency}`);
  if (price.membershipPrice !== undefined) bits.push(`멤버십 가격 ${price.membershipPrice} ${price.currency}`);
  if (price.estimatedPoints !== undefined) bits.push(`예상 적립 ${price.estimatedPoints} ${price.currency}`);
  if (price.shippingFee !== undefined) bits.push(`배송비 ${price.shippingFee} ${price.currency}`);
  if (price.shippingEta) bits.push(`배송 예정 ${price.shippingEta}`);
  return {
    claim: bits.length ? bits.join(' / ') : '로그인 세션에서 개인화 가격·배송 필드를 확인함',
    sourceUrl: url,
    sourceType: 'local_authenticated_price',
    retrievedAt: at,
    acquisitionMethod: 'local_relay',
    evidenceClass: 'retailer_listing',
    independenceKey: `local-relay:${url}`,
    confidence: 0.82,
    specificity: 'exact_product',
    data: { priceSnapshot: price },
  };
}

export function applyPersonalizedRelayResult(job: ResearchJob, rawResult: unknown, completedAt = new Date().toISOString()): ResearchJob {
  const price = normalizeRelayPrice(rawResult);
  const localEvidence = relayEvidence(job, price, completedAt);
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
    message: 'Personalized fields were read from the local authenticated browser.',
  };
  const status: ResearchJob['status'] = job.errors.length ? 'partial' : 'completed';
  const report = buildProductReport({
    target: job.target.kind === 'unknown' ? { ...job.target, kind: 'product' } : job.target,
    evidence,
    personalizedPrice: price,
  });

  return {
    ...job,
    status,
    updatedAt: completedAt,
    completedAt,
    evidence,
    sourceResults,
    relay,
    report,
  };
}
