import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPresentation } from '../src/core/presentation.ts';
import type { BestOffers, MarketOffer, PriceHistorySummary } from '../src/core/types.ts';

function offer(overrides: Partial<MarketOffer> = {}): MarketOffer {
  return {
    id: 'x', market: '네이버', title: '상품', url: 'https://example.com/x', currency: 'KRW',
    retrievedAt: '2026-08-24T06:00:00.000Z', verification: 'page_verified', condition: 'new',
    identityScore: 1, bundleComplete: true, eligible: true, conditions: [], riskFlags: [], exclusionReasons: [],
    ...overrides,
  };
}

test('uses a stable user-facing commercial row order', () => {
  const cash = offer({ totalCashPrice: 450000 });
  const advertised = offer({ paymentMethod: '토스페이', paymentPrice: 430000 });
  const bestOffers: BestOffers = {
    cash: { basis: 'cash', rank: 1, amount: 450000, offer: cash, reasons: [] },
    advertisedPayment: { basis: 'advertised_payment', rank: 1, amount: 430000, offer: advertised, reasons: [] },
  };
  const priceHistory: PriceHistorySummary = {
    coverage: 'observed_only', observationCount: 1, currentPrice: 450000, position: 'insufficient_history',
  };
  const result = buildPresentation({ bestOffers, membershipScenarios: [], priceHistory });
  assert.equal(result.schemaVersion, '1');
  assert.deepEqual(result.rows.map((row) => row.label), [
    '현금 실결제가', '광고 결제수단 최저가', '180일 가격 위치',
  ]);
});
