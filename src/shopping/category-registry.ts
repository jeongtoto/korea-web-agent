import type { ShoppingCategoryId } from './types.ts';

export interface ShoppingCategorySchema {
  id: ShoppingCategoryId;
  defaultWeights: Record<string, number>;
}

const PORTABLE_DISPLAY: ShoppingCategorySchema = {
  id: 'portable_display',
  defaultWeights: {
    fit: 20,
    displayQuality: 20,
    mobility: 15,
    smartFeatures: 10,
    buildDurability: 10,
    serviceWarranty: 10,
    reviewConsensus: 5,
    value: 10,
  },
};

const BEDDING: ShoppingCategorySchema = {
  id: 'bedding',
  defaultWeights: {
    fit: 15,
    fabricFillQuality: 20,
    tactileComfort: 15,
    seasonalComfort: 15,
    care: 10,
    durability: 10,
    allergySafety: 5,
    reviewConsensus: 5,
    value: 5,
  },
};

const UNKNOWN: ShoppingCategorySchema = {
  id: 'unknown',
  defaultWeights: {
    fit: 35,
    quality: 25,
    reviewConsensus: 15,
    serviceWarranty: 10,
    value: 15,
  },
};

const REGISTRY: Record<ShoppingCategoryId, ShoppingCategorySchema> = {
  portable_display: PORTABLE_DISPLAY,
  bedding: BEDDING,
  unknown: UNKNOWN,
};

export function getShoppingCategorySchema(id: ShoppingCategoryId): ShoppingCategorySchema {
  return REGISTRY[id];
}

export function normalizeDimensionWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights).map(([key, value]) => [key, Number.isFinite(value) ? Math.max(0, value) : 0] as const);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) return {};
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}
