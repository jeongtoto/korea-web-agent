import test from 'node:test';
import assert from 'node:assert/strict';
import { compileCanonicalIdentity, canonicalIdentityKey } from '../src/core/canonical-identity.ts';
import { runCloudResearch } from '../src/cloud/research-service.ts';
import {
  markPersistentConnectorSeen,
  pollPersistentRelay,
  type JsonKeyValueStore,
} from '../src/cloud/relay-state.ts';
import { applyPersonalizedRelayResult } from '../src/relay/merge.ts';
import { validateRelayRequest, type UnsignedRelayJob } from '../src/relay/protocol.ts';
import type { MarketOffer, ResearchJob, ResearchRequest } from '../src/core/types.ts';

const NOW = Date.parse('2026-08-25T06:30:00.000Z');
const SECRET = '0123456789abcdef0123456789abcdef';
const URL = 'https://brand.naver.com/widevu/products/11458011168';

class MemoryStore implements JsonKeyValueStore {
  data = new Map<string, unknown>();
  async getJSON<T>(key: string): Promise<T | null> { return (this.data.get(key) as T | undefined) ?? null; }
  async setJSON(key: string, value: unknown): Promise<void> { this.data.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

function exactTarget() {
  return {
    kind: 'product' as const,
    brand: '와이드뷰',
    name: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
    model: 'QWGE43UT1',
    variant: 'EKWBYME78W(V3) 43인치',
    productId: '11458011168',
    canonicalUrl: URL,
  };
}

function exactCanonical() {
  return compileCanonicalIdentity(
    exactTarget(),
    '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
  );
}

function publicOffer(): MarketOffer {
  return {
    id: 'naver:public',
    market: '네이버',
    title: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지',
    url: URL,
    currency: 'KRW',
    retrievedAt: '2026-08-25T06:20:00.000Z',
    verification: 'page_verified',
    condition: 'new',
    identityScore: 1,
    bundleComplete: true,
    eligible: true,
    salePrice: 410000,
    shippingFee: 0,
    totalCashPrice: 410000,
    conditions: [],
    riskFlags: [],
    exclusionReasons: [],
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
  };
}

function exactJob(request: ResearchRequest = {
  question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 현재 가격',
  url: URL,
  includeLocalRelay: true,
  category: 'product',
}): ResearchJob {
  const target = exactTarget();
  const canonicalIdentity = exactCanonical();
  const offer = publicOffer();
  return {
    id: 'relay-safe-job',
    status: 'running',
    request,
    createdAt: '2026-08-25T06:20:00.000Z',
    updatedAt: '2026-08-25T06:20:05.000Z',
    target,
    researchContext: {
      identityConfidence: 0.98,
      resolvedTarget: { ...target },
      canonicalIdentity,
      resolutionAmbiguous: false,
    },
    sourceResults: [],
    evidence: [],
    relay: { available: true, used: false, mode: 'public_only', message: 'waiting' },
    report: {
      decision: 'BUY',
      confidence: 0.86,
      confidenceDimensions: {
        identity: 0.98,
        price: 0.9,
        officialSpecs: 0.7,
        reviews: 0.6,
        negativeSignals: 0.7,
        personalizedPrice: 0,
      },
      title: '와이드뷰 V3 패키지',
      summary: 'public result',
      reasons: ['public verified'],
      strengths: [],
      weaknesses: [],
      missingInformation: [],
      evidence: [],
      sourceCount: 1,
      offers: [offer],
      bestOffers: {
        cash: { basis: 'cash', rank: 1, amount: 410000, offer, reasons: ['verified public cash'] },
      },
      priceHistory: {
        sku: canonicalIdentityKey(canonicalIdentity)!,
        observations: [{ observedAt: '2026-08-25T06:20:00.000Z', cashPrice: 410000, sourceUrl: URL, market: '네이버' }],
        comparison: { direction: 'insufficient' },
        position: { label: 'insufficient', current: 410000, sampleCount: 1 },
      },
    },
    errors: [],
  };
}

function relayResult(title: string, price = 379000) {
  return {
    title,
    cashPaymentPrice: price,
    salePrice: price,
    shippingFee: 0,
    availability: 'InStock',
    sourceUrl: URL,
  };
}

test('exact V3 bundle relay page may merge personalized price', () => {
  const merged = applyPersonalizedRelayResult(
    exactJob(),
    relayResult('와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 패키지'),
    '2026-08-25T06:30:00.000Z',
  );

  assert.equal(merged.relay.used, true);
  assert.equal(merged.report?.personalizedPrice?.cashPaymentPrice, 379000);
});

test('V2 relay option is rejected for an exact V3 bundle and public intelligence remains unchanged', () => {
  const job = exactJob();
  const publicOffers = structuredClone(job.report?.offers);
  const publicBestOffers = structuredClone(job.report?.bestOffers);
  const publicHistory = structuredClone(job.report?.priceHistory);

  const merged = applyPersonalizedRelayResult(
    job,
    relayResult('와이드뷰 QWGE43UT1 + EKWBYME78W(V2) 43인치 신품 패키지', 359000),
    '2026-08-25T06:30:00.000Z',
  );

  assert.equal(merged.relay.used, false);
  assert.equal(merged.report?.personalizedPrice, undefined);
  assert.deepEqual(merged.report?.offers, publicOffers);
  assert.deepEqual(merged.report?.bestOffers, publicBestOffers);
  assert.deepEqual(merged.report?.priceHistory, publicHistory);
  assert.ok(merged.errors.some((message) => /identity|bundle|상품|제품/i.test(message)));
});

test('body-only relay page is rejected for a required V3 bundle', () => {
  const merged = applyPersonalizedRelayResult(
    exactJob(),
    relayResult('와이드뷰 QWGE43UT1 43인치 신품 TV 본체 단품', 349000),
    '2026-08-25T06:30:00.000Z',
  );

  assert.equal(merged.relay.used, false);
  assert.equal(merged.report?.personalizedPrice, undefined);
  assert.ok(merged.errors.some((message) => /identity|bundle|상품|제품/i.test(message)));
});

test('relay protocol accepts bounded signed canonical key and required component hints', () => {
  const canonicalIdentity = exactCanonical();
  const job: UnsignedRelayJob = {
    id: 'relay-protocol-canonical',
    url: URL,
    requestedFields: ['title', 'price', 'shippingFee'],
    targetHint: {
      brand: '와이드뷰',
      model: 'QWGE43UT1',
      canonicalKey: canonicalIdentityKey(canonicalIdentity),
      requiredComponents: canonicalIdentity.requiredComponents.map(({ model, version }) => ({ model, version })),
    } as never,
    issuedAt: new Date(NOW - 1000).toISOString(),
    expiresAt: new Date(NOW + 60_000).toISOString(),
    nonce: 'relay-canonical-nonce',
  };

  assert.doesNotThrow(() => validateRelayRequest(job, NOW));
});

test('cloud relay queue carries canonical identity hints to the local connector', async () => {
  const store = new MemoryStore();
  await markPersistentConnectorSeen(store, NOW - 1000);
  const canonicalIdentity = exactCanonical();

  const result = await runCloudResearch({
    question: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 현재 가격',
    url: URL,
    includeLocalRelay: true,
    category: 'product',
    relayCandidates: [{ url: URL, market: '네이버' }],
  }, {
    store,
    relaySecret: SECRET,
    nowMs: () => NOW,
    publicResearch: async (request) => exactJob(request),
  });

  assert.equal(result.status, 'running');
  const relayJob = await pollPersistentRelay(store, NOW + 1);
  const hint = relayJob?.targetHint as any;
  assert.equal(hint?.canonicalKey, canonicalIdentityKey(canonicalIdentity));
  assert.deepEqual(hint?.requiredComponents, canonicalIdentity.requiredComponents.map(({ model, version }) => ({ model, version })));
  assert.equal((relayJob?.targets?.[0]?.targetHint as any)?.canonicalKey, canonicalIdentityKey(canonicalIdentity));
});
