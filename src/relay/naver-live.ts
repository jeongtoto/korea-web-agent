import type { RelayProductHint } from './protocol.ts';

export interface NaverLiveProductCard {
  locatorIndex: number;
  title: string;
  destinationUrl: string;
}

export interface NaverLiveDealContext {
  title?: string;
  sourceUrl?: string;
}

const COMMERCE_READY = /(?:상품금액|판매자\s*즉시할인|쿠폰할인|카드사\s*결제할인|최대\s*할인가|최대\s*적립\s*포인트)/i;
const MANUAL_VERIFICATION = /(?:captcha|보안\s*문자|자동\s*입력\s*방지|사람인지\s*확인|비정상적인\s*접근|manual\s*verification)/i;

function compact(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function compactIdentity(value: string): string {
  return compact(value).replace(/[^0-9a-z가-힣]+/gi, '');
}

function tokens(value: string): Set<string> {
  const ignored = new Set([
    '화이트에디션', '셋트', '세트', '스마트', '이동식', '자가설치', '무료배송',
    '상품', '네이버', '배송', '할인', '가격', '중소바이미',
  ]);
  return new Set((compact(value).match(/[0-9a-z가-힣]+/gi) ?? [])
    .filter((token) => token.length >= 2 && !ignored.has(token) && !/^\d[\d,]*$/.test(token)));
}

interface ProductSignals {
  inch: Set<number>;
  cm: Set<number>;
  generation?: 'v1' | 'v2' | 'v3' | 'v3-air';
  resolution?: 'hd' | 'fhd' | 'qhd' | 'uhd4k';
}

function numberSignals(value: string, pattern: RegExp): Set<number> {
  return new Set([...value.matchAll(pattern)]
    .map((match) => Number(match[1]))
    .filter((entry) => Number.isFinite(entry)));
}

function signals(value: string): ProductSignals {
  const normalized = compact(value);
  let generation: ProductSignals['generation'];
  if (/v3\s*[-_ ]?\s*air/i.test(normalized)) generation = 'v3-air';
  else if (/\bv3\b/i.test(normalized) || /\(v3\)/i.test(normalized)) generation = 'v3';
  else if (/\bv2\b/i.test(normalized) || /\(v2\)/i.test(normalized)) generation = 'v2';
  else if (/\bv1\b/i.test(normalized) || /\(v1\)/i.test(normalized)) generation = 'v1';

  let resolution: ProductSignals['resolution'];
  if (/\b(?:uhd|4k)\b/i.test(normalized)) resolution = 'uhd4k';
  else if (/\bqhd\b/i.test(normalized)) resolution = 'qhd';
  else if (/\bfhd\b/i.test(normalized)) resolution = 'fhd';
  else if (/\bhd\b/i.test(normalized)) resolution = 'hd';

  return {
    inch: numberSignals(normalized, /(\d{2,3})\s*(?:인치|inch)/gi),
    cm: numberSignals(normalized, /(\d{2,3})\s*cm/gi),
    ...(generation ? { generation } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

function sizeMatches(expected: ProductSignals, actual: ProductSignals): boolean | undefined {
  if (!expected.inch.size && !expected.cm.size) return undefined;
  if (!actual.inch.size && !actual.cm.size) return false;
  if ([...expected.inch].some((value) => actual.inch.has(value))) return true;
  if ([...expected.cm].some((value) => actual.cm.has(value))) return true;
  for (const inch of expected.inch) {
    const expectedCm = Math.round(inch * 2.54);
    if ([...actual.cm].some((cm) => Math.abs(cm - expectedCm) <= 1)) return true;
  }
  for (const cm of expected.cm) {
    const expectedInch = Math.round(cm / 2.54);
    if ([...actual.inch].some((inch) => Math.abs(inch - expectedInch) <= 1)) return true;
  }
  return false;
}

function scoreCard(card: NaverLiveProductCard, hint: RelayProductHint): number | null {
  const hintText = [hint.brand, hint.name, hint.model, hint.variant].filter(Boolean).join(' ');
  const expected = signals(hintText);
  const actual = signals(card.title);
  const agreements: boolean[] = [];

  const sizeAgreement = sizeMatches(expected, actual);
  if (sizeAgreement !== undefined) agreements.push(sizeAgreement);
  if (expected.generation) agreements.push(actual.generation === expected.generation);
  if (expected.resolution) agreements.push(actual.resolution === expected.resolution);
  if (agreements.length < 2 || agreements.some((agreement) => !agreement)) return null;

  const expectedTokens = tokens(hintText);
  const actualTokens = tokens(card.title);
  const sharedTokens = [...expectedTokens].filter((token) => actualTokens.has(token)).length;
  const compactCard = compactIdentity(card.title);
  const visibleIdentityBoost = [hint.brand, hint.name]
    .filter((value): value is string => Boolean(value))
    .some((value) => {
      const identity = compactIdentity(value);
      return identity.length >= 4 && (compactCard.includes(identity) || identity.includes(compactCard));
    }) ? 3 : 0;

  return (agreements.length * 10) + sharedTokens + visibleIdentityBoost;
}

export function selectNaverLiveProductCard(
  cards: readonly NaverLiveProductCard[],
  hint: RelayProductHint | undefined,
): NaverLiveProductCard | null {
  if (!hint) return null;
  const ranked = cards
    .map((card) => ({ card, score: scoreCard(card, hint) }))
    .filter((entry): entry is { card: NaverLiveProductCard; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score);
  const first = ranked[0];
  if (!first) return null;
  const second = ranked[1];
  if (second && first.score - second.score < 1) return null;
  return first.card;
}

function parseCapturedKrw(text: string, pattern: RegExp): number | undefined {
  const raw = text.match(pattern)?.[1];
  if (!raw) return undefined;
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function liveId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'view.shoppinglive.naver.com') return undefined;
    const match = parsed.pathname.match(/^\/lives\/(\d+)(?:\/|$)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function safeProductSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'product.shoppinglive.naver.com') return undefined;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

export function isNaverLiveCommerceReady(text: string | null): boolean {
  return Boolean(text && COMMERCE_READY.test(text));
}

export function hasManualVerificationChallenge(text: string | null): boolean {
  return Boolean(text && MANUAL_VERIFICATION.test(text));
}

export function parseNaverLiveDeal(
  url: string,
  text: string,
  context: NaverLiveDealContext = {},
): Record<string, unknown> {
  const summaryPrices = text.match(/([0-9][0-9,]*)\s*원\s*\d+\s*%\s*할인?\s*([0-9][0-9,]*)\s*원/i);
  const explicitListPrice = parseCapturedKrw(text, /상품금액\s*([0-9][0-9,]*)\s*원/i)
    ?? parseCapturedKrw(text, /할인\s*전\s*가격\s*([0-9][0-9,]*)\s*원/i);
  const listPrice = explicitListPrice
    ?? (summaryPrices?.[1] ? Number(summaryPrices[1].replace(/,/g, '')) : undefined);
  const summarySalePrice = summaryPrices?.[2] ? Number(summaryPrices[2].replace(/,/g, '')) : undefined;
  const sellerInstantDiscount = parseCapturedKrw(text, /판매자\s*즉시할인\s*-?\s*([0-9][0-9,]*)\s*원/i);
  const couponDiscount = parseCapturedKrw(text, /쿠폰할인(?:\([^\n)]*\))?\s*-?\s*([0-9][0-9,]*)\s*원/i);
  const cardInstantDiscount = parseCapturedKrw(text, /카드사\s*결제할인(?:\([^\n)]*\))?\s*-?\s*([0-9][0-9,]*)\s*원/i);
  const explicitCashPaymentPrice = parseCapturedKrw(text, /최대\s*할인가\s*([0-9][0-9,]*)\s*원/i);
  const totalExpectedPoints = parseCapturedKrw(text, /최대\s*적립\s*포인트\s*([0-9][0-9,]*)\s*원/i);
  const shippingFee = /무료\s*배송/i.test(text)
    ? 0
    : parseCapturedKrw(text, /배송비\s*([0-9][0-9,]*)\s*원/i);

  const couponPrice = listPrice !== undefined && sellerInstantDiscount !== undefined && couponDiscount !== undefined
    ? Math.max(0, listPrice - sellerInstantDiscount - couponDiscount)
    : undefined;
  const computedCashPaymentPrice = listPrice !== undefined
      && sellerInstantDiscount !== undefined
      && couponDiscount !== undefined
      && cardInstantDiscount !== undefined
    ? Math.max(0, listPrice - sellerInstantDiscount - couponDiscount - cardInstantDiscount + (shippingFee ?? 0))
    : undefined;
  const cashPaymentPrice = explicitCashPaymentPrice ?? computedCashPaymentPrice;
  const salePrice = cashPaymentPrice ?? summarySalePrice;
  const effectivePrice = cashPaymentPrice !== undefined && totalExpectedPoints !== undefined
    ? Math.max(0, cashPaymentPrice - totalExpectedPoints)
    : undefined;

  const output: Record<string, unknown> = {};
  const title = context.title?.replace(/\s+/g, ' ').trim();
  if (title) output.title = title;
  if (listPrice !== undefined) output.listPrice = listPrice;
  if (sellerInstantDiscount !== undefined) output.sellerInstantDiscount = sellerInstantDiscount;
  if (couponDiscount !== undefined) output.couponDiscount = couponDiscount;
  if (cardInstantDiscount !== undefined) output.cardInstantDiscount = cardInstantDiscount;
  if (couponPrice !== undefined) output.couponPrice = couponPrice;
  if (cashPaymentPrice !== undefined) output.cashPaymentPrice = cashPaymentPrice;
  if (salePrice !== undefined) output.salePrice = salePrice;
  if (totalExpectedPoints !== undefined) {
    output.totalExpectedPoints = totalExpectedPoints;
    output.estimatedPoints = totalExpectedPoints;
  }
  if (effectivePrice !== undefined) output.effectivePrice = effectivePrice;
  if (shippingFee !== undefined) output.shippingFee = shippingFee;
  output.dealType = 'naver_shopping_live';
  output.liveId = liveId(url);
  const sourceUrl = safeProductSourceUrl(context.sourceUrl);
  if (sourceUrl) output.sourceUrl = sourceUrl;
  return output;
}
