import { compileCanonicalIdentity } from '../../src/core/canonical-identity.ts';
import type { MarketOffer } from '../../src/core/types.ts';
import type { DirectPageResult } from '../../src/providers/direct-page.ts';
import type { DiscoveryCandidate } from '../../src/providers/market-provider.ts';

export const V074_AT = '2026-08-27T00:00:00.000Z';

export const wideViewTarget = {
  kind: 'product' as const,
  brand: '와이드뷰',
  model: 'QWGE43UT1',
  variant: 'EKWBYME78W(V3)',
  name: '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 이동형 패키지',
};

export const wideViewCanonical = compileCanonicalIdentity(
  wideViewTarget,
  '와이드뷰 QWGE43UT1 + EKWBYME78W(V3) 43인치 신품 이동형 패키지',
);

export function wideViewSellerPage(input: {
  version?: 'V2' | 'V3';
  bodyOnly?: boolean;
  price: number;
  shippingFee?: number;
  mandatoryPurchaseFee?: number;
  mandatoryFeeSignal?: boolean;
  availability?: string;
  url?: string;
}): DirectPageResult {
  const version = input.version ?? 'V3';
  const name = input.bodyOnly
    ? '와이드뷰 QWGE43UT1 43인치 UHD QLED TV 본체 단품'
    : `와이드뷰 QWGE43UT1 + EKWBYME78W(${version}) 43인치 이동형 패키지`;
  const description = input.bodyOnly
    ? 'QWGE43UT1 TV 본체만 포함, 이동형 스탠드 미포함'
    : `QWGE43UT1 TV + EKWBYME78W(${version}) 이동형 스탠드 포함 신품`;
  const url = input.url ?? `https://www.11st.co.kr/products/${version.toLowerCase()}-${input.price}`;
  const availability = input.availability ?? 'InStock';
  return {
    url,
    title: name,
    description,
    product: {
      name,
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      description,
      offers: {
        price: input.price,
        currency: 'KRW',
        availability,
        ...(input.shippingFee !== undefined ? { shippingFee: input.shippingFee } : {}),
      },
    },
    facts: {
      name,
      brand: '와이드뷰',
      sku: 'QWGE43UT1',
      model: 'QWGE43UT1',
      description,
      price: input.price,
      availability,
      ...(input.shippingFee !== undefined ? { shippingFee: input.shippingFee } : {}),
      ...(input.mandatoryPurchaseFee !== undefined ? { mandatoryPurchaseFee: input.mandatoryPurchaseFee } : {}),
      ...(input.mandatoryFeeSignal !== undefined ? { mandatoryFeeSignal: input.mandatoryFeeSignal } : {}),
    },
    evidence: [],
  };
}

export function wideViewMetadataOffer(price = 365400): MarketOffer {
  return {
    id: `naver-metadata-${price}`,
    market: '네이버쇼핑',
    title: wideViewTarget.name,
    url: `https://shopping.naver.com/catalog/metadata-${price}`,
    currency: 'KRW',
    retrievedAt: V074_AT,
    verification: 'search_metadata',
    condition: 'new',
    identityScore: 1,
    identityVerdict: 'exact',
    constraintStatus: 'eligible',
    fieldVerification: {
      identity: 'search_metadata',
      price: 'search_metadata',
      shipping: 'search_metadata',
    },
    bundleComplete: true,
    eligible: false,
    salePrice: price,
    shippingFee: 0,
    totalCashPrice: price,
    conditions: [],
    riskFlags: [],
    exclusionReasons: ['search_metadata_requires_page_verification'],
  };
}

export function comparisonDiscovery(input: {
  providerId?: 'danawa' | 'enuri' | 'naver-shopping';
  market?: string;
  url?: string;
  snippet?: string;
} = {}): DiscoveryCandidate {
  const providerId = input.providerId ?? 'danawa';
  return {
    providerId,
    market: input.market ?? (providerId === 'danawa' ? '다나와' : providerId === 'enuri' ? '에누리' : '네이버쇼핑'),
    title: wideViewTarget.name,
    url: input.url ?? 'https://prod.danawa.com/info/?pcode=7400',
    snippet: input.snippet ?? '가격비교 최저가 365,400원',
    discoveredAt: V074_AT,
  };
}
