import { canonicalIdentityKey } from '../core/canonical-identity.ts';
import type { CanonicalProductIdentity, NormalizedTarget } from '../core/types.ts';
import {
  classifyPricePosition,
  comparePriceSnapshots,
  normalizeSku,
  type PriceComparison,
  type PricePosition,
} from '../core/shopping-intelligence.ts';
import type { JsonKeyValueStore } from './relay-state.ts';

const RETENTION_DAYS = 183;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const PRICE_PREFIX = 'price:history:';

export interface StoredPriceObservation {
  observedAt: string;
  cashPrice: number;
  sourceUrl?: string;
  market?: string;
}

interface StoredPriceHistory {
  sku: string;
  observations: StoredPriceObservation[];
}

export interface PriceHistorySummary {
  sku: string;
  observations: StoredPriceObservation[];
  comparison: PriceComparison;
  position: PricePosition;
}

function legacySkuIdentity(target: NormalizedTarget): string | undefined {
  if (!target.model?.trim()) return undefined;
  const model = normalizeSku(target.model);
  if (!model) return undefined;
  const variant = target.variant?.trim() ? normalizeSku(target.variant) : '';
  return variant ? `${model}+${variant}` : model;
}

function historyIdentity(
  target: NormalizedTarget,
  canonicalIdentity?: CanonicalProductIdentity,
): string | undefined {
  if (canonicalIdentity?.primary.model) {
    const canonical = canonicalIdentityKey(canonicalIdentity);
    if (canonical) return canonical;
  }
  return legacySkuIdentity(target);
}

export function priceHistoryKey(
  target: NormalizedTarget,
  canonicalIdentity?: CanonicalProductIdentity,
): string | undefined {
  const sku = historyIdentity(target, canonicalIdentity);
  return sku ? `${PRICE_PREFIX}${sku}` : undefined;
}

function validObservation(value: StoredPriceObservation): boolean {
  return Number.isFinite(value.cashPrice)
    && value.cashPrice > 0
    && Number.isFinite(Date.parse(value.observedAt));
}

function pruneAndSort(
  observations: StoredPriceObservation[],
  nowMs: number,
): StoredPriceObservation[] {
  const cutoff = nowMs - RETENTION_MS;
  const deduplicated = new Map<string, StoredPriceObservation>();
  for (const observation of observations) {
    if (!validObservation(observation)) continue;
    const at = Date.parse(observation.observedAt);
    if (at < cutoff || at > nowMs + 5 * 60_000) continue;
    deduplicated.set(observation.observedAt, { ...observation, cashPrice: Math.round(observation.cashPrice) });
  }
  return [...deduplicated.values()].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
}

function summarize(sku: string, observations: StoredPriceObservation[]): PriceHistorySummary {
  const current = observations.at(-1);
  const prior = current ? observations.slice(0, -1) : [];
  return {
    sku,
    observations,
    comparison: comparePriceSnapshots(observations.map((item) => ({ observedAt: item.observedAt, cashPrice: item.cashPrice }))),
    position: current
      ? classifyPricePosition(current.cashPrice, prior.map((item) => item.cashPrice))
      : { label: 'insufficient', current: 0, sampleCount: 0 },
  };
}

export async function getPriceHistory(
  store: JsonKeyValueStore,
  target: NormalizedTarget,
  nowMs = Date.now(),
  canonicalIdentity?: CanonicalProductIdentity,
): Promise<PriceHistorySummary | null> {
  const key = priceHistoryKey(target, canonicalIdentity);
  const sku = historyIdentity(target, canonicalIdentity);
  if (!key || !sku) return null;
  const stored = await store.getJSON<StoredPriceHistory>(key);
  const observations = pruneAndSort(stored?.observations ?? [], nowMs);
  return summarize(sku, observations);
}

export async function appendPriceObservation(
  store: JsonKeyValueStore,
  target: NormalizedTarget,
  observation: StoredPriceObservation,
  nowMs = Date.now(),
  canonicalIdentity?: CanonicalProductIdentity,
): Promise<PriceHistorySummary | null> {
  const key = priceHistoryKey(target, canonicalIdentity);
  const sku = historyIdentity(target, canonicalIdentity);
  if (!key || !sku || !validObservation(observation)) return null;

  const stored = await store.getJSON<StoredPriceHistory>(key);
  const observations = pruneAndSort([...(stored?.observations ?? []), observation], nowMs);
  const value: StoredPriceHistory = { sku, observations };
  await store.setJSON(key, value);
  return summarize(sku, observations);
}