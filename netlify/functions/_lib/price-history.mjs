import { createHash } from 'node:crypto';
import { summarizePriceHistory } from '../../../dist/src/core/price-history.js';
import { buildPresentation } from '../../../dist/src/core/presentation.js';

const MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function productKey(result) {
  const product = result?.product ?? {};
  const identity = [product.brand, product.model, product.variant, product.productId, product.name]
    .filter(Boolean).map((value) => String(value).normalize('NFKC').toUpperCase().replace(/[^0-9A-Z가-힣]+/g, '')).join('|');
  if (!identity) return null;
  return `price-history/${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

function comparablePrice(result) {
  return result?.bestOffers?.cash?.amount ?? result?.bestOffers?.ownedCard?.amount ?? result?.bestOffers?.advertisedPayment?.amount ?? result?.bestOffers?.effective?.amount;
}

export async function enrichWithPriceHistory(store, result, now = new Date()) {
  if (!result || !['completed', 'partial'].includes(result.status)) return result;
  const key = productKey(result); const amount = comparablePrice(result);
  if (!key || !Number.isFinite(amount) || amount <= 0 || result?.product?.ambiguous) return result;
  const saved = await store.getJSON(key).catch(() => null);
  const previous = Array.isArray(saved?.observations) ? saved.observations.filter((item) => item && Number.isFinite(item.amount) && typeof item.observedAt === 'string') : [];
  const cutoff = now.getTime() - MAX_AGE_MS;
  const retained = previous.filter((item) => Date.parse(item.observedAt) >= cutoff);
  const observation = { observedAt: now.toISOString(), amount, currency: 'KRW', market: result.bestOffers?.cash?.offer?.market ?? result.bestOffers?.advertisedPayment?.offer?.market, offerId: result.bestOffers?.cash?.offer?.id ?? result.bestOffers?.advertisedPayment?.offer?.id };
  const last = retained.at(-1);
  const observations = last && last.amount === observation.amount && last.offerId === observation.offerId && (now.getTime() - Date.parse(last.observedAt)) < 60 * 60 * 1000 ? retained : [...retained, observation];
  await store.setJSON(key, { version: 1, observations });
  result.priceHistory = summarizePriceHistory(retained, amount, now);
  result.presentation = buildPresentation({ bestOffers: result.bestOffers, membershipScenarios: result.membershipScenarios ?? [], priceHistory: result.priceHistory });
  return result;
}
