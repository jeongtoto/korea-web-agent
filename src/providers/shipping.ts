import type { ShippingQuote } from '../core/types.ts';

export function resolveShippingCost(
  shipping: ShippingQuote,
  orderAmount: number,
): number | undefined {
  if (!Number.isFinite(orderAmount) || orderAmount < 0) return undefined;
  if (shipping.status === 'free') return 0;
  if (shipping.status === 'unknown') return undefined;
  if (shipping.status === 'paid') {
    return typeof shipping.baseFee === 'number' && Number.isFinite(shipping.baseFee) && shipping.baseFee >= 0
      ? shipping.baseFee
      : undefined;
  }
  if (typeof shipping.threshold !== 'number' || !Number.isFinite(shipping.threshold) || shipping.threshold < 0) {
    return undefined;
  }
  if (orderAmount >= shipping.threshold) return 0;
  return typeof shipping.baseFee === 'number' && Number.isFinite(shipping.baseFee) && shipping.baseFee >= 0
    ? shipping.baseFee
    : undefined;
}

export interface TotalCashInput {
  salePrice: number;
  shipping: ShippingQuote;
  mandatoryFees?: number[];
}

export function calculateTotalCashPrice(input: TotalCashInput): number | undefined {
  if (!Number.isFinite(input.salePrice) || input.salePrice <= 0) return undefined;
  const shippingCost = resolveShippingCost(input.shipping, input.salePrice);
  if (shippingCost === undefined) return undefined;
  const fees = input.mandatoryFees ?? [];
  if (fees.some((fee) => !Number.isFinite(fee) || fee < 0)) return undefined;
  return input.salePrice + shippingCost + fees.reduce((sum, fee) => sum + fee, 0);
}
