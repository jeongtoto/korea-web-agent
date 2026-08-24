import type { PriceHistorySummary, PriceObservation } from './types.ts';

const WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
const MIN_HISTORY_OBSERVATIONS = 6;

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function summarizePriceHistory(
  observations: PriceObservation[],
  currentPrice: number | undefined,
  now = new Date(),
): PriceHistorySummary {
  const cutoff = now.getTime() - WINDOW_MS;
  const valid = observations
    .filter((item) => Number.isFinite(item.amount) && item.amount > 0 && Date.parse(item.observedAt) >= cutoff && Date.parse(item.observedAt) <= now.getTime())
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const previous = valid.at(-1);
  const values = valid.map((item) => item.amount);
  const allValues = currentPrice !== undefined && Number.isFinite(currentPrice) && currentPrice > 0 ? [...values, currentPrice] : values;
  const summary: PriceHistorySummary = {
    coverage: 'observed_only',
    observationCount: valid.length,
    position: 'insufficient_history',
  };
  if (valid[0]) summary.firstObservedAt = valid[0].observedAt;
  if (previous) summary.lastObservedAt = previous.observedAt;
  if (currentPrice !== undefined && Number.isFinite(currentPrice) && currentPrice > 0) summary.currentPrice = currentPrice;
  if (previous) summary.previousPrice = previous.amount;
  if (previous && currentPrice !== undefined) summary.changeFromPrevious = currentPrice - previous.amount;
  if (allValues.length) {
    summary.minimum = Math.min(...allValues);
    summary.maximum = Math.max(...allValues);
    summary.mean = allValues.reduce((sum, value) => sum + value, 0) / allValues.length;
    summary.median = median(allValues);
  }
  if (valid.length < MIN_HISTORY_OBSERVATIONS || currentPrice === undefined || !summary.mean || summary.minimum === undefined || summary.maximum === undefined) return summary;

  if (currentPrice <= summary.minimum) summary.position = 'new_low';
  else if (currentPrice >= summary.maximum) summary.position = 'new_high';
  else {
    const span = Math.max(1, summary.maximum - summary.minimum);
    const normalized = (currentPrice - summary.minimum) / span;
    if (normalized <= 0.12) summary.position = 'near_low';
    else if (currentPrice < summary.mean * 0.97) summary.position = 'below_average';
    else if (currentPrice > summary.mean * 1.03) summary.position = 'above_average';
    else summary.position = 'around_average';
  }
  summary.percentile = Math.round(100 * allValues.filter((value) => value <= currentPrice).length / allValues.length);
  return summary;
}
