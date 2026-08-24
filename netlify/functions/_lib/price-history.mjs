import { createHash } from 'node:crypto';
import { summarizePriceHistory } from '../../../dist/src/core/price-history.js';
import { buildPresentation } from '../../../dist/src/core/presentation.js';

const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function normalizeIdentityPart(value) {
  return String(value).normalize('NFKC').toUpperCase().replace(/[^0-9A-Z가-힣]+/g, '');
}

function productKey(result) {
  const product = result?.product ?? {};
  if (!product.model && !product.productId) return null;
  const identity = [product.brand, product.model, product.variant, product.productId]
    .filter(Boolean)
    .map(normalizeIdentityPart)
    .join('|');
  if (!identity) return null;
  return `price-history/${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

function comparablePrice(result) {
  return result?.bestOffers?.cash?.amount;
}

export async function enrichWithPriceHistory(store, result, now = new Date()) {
  if (!result || !['completed', 'partial'].includes(result.status)) return result;
  if (result.researchMode !== 'exact_product') return result;
  const key = productKey(result);
  const amount = comparablePrice(result);
  if (!key || !Number.isFinite(amount) || amount <= 0 || result?.product?.ambiguous) return result;

  const saved = await store.getJSON(key).catch(() => null);
  const previous = Array.isArray(saved?.observations)
    ? saved.observations.filter((item) => item && Number.isFinite(item.amount) && typeof item.observedAt === 'string')
    : [];
  const cutoff = now.getTime() - MAX_AGE_MS;
  const retained = previous.filter((item) => Date.parse(item.observedAt) >= cutoff && Date.parse(item.observedAt) <= now.getTime());
  const cashOffer = result.bestOffers?.cash?.offer;
  const observation = {
    observedAt: now.toISOString(),
    amount,
    currency: 'KRW',
    market: cashOffer?.market,
    offerId: cashOffer?.id,
  };
  const last = retained.at(-1);
  const observations = last
    && last.amount === observation.amount
    && last.offerId === observation.offerId
    && (now.getTime() - Date.parse(last.observedAt)) < 60 * 60 * 1000
    ? retained
    : [...retained, observation];

  await store.setJSON(key, { version: 1, observations });
  result.priceHistory = summarizePriceHistory(retained, amount, now);
  result.presentation = buildPresentation({
    bestOffers: result.bestOffers,
    membershipScenarios: result.membershipScenarios ?? [],
    priceHistory: result.priceHistory,
  });
  return result;
}
