import { matchEvidenceToProduct } from './product-match.ts';
import type {
  BestOffers,
  MarketOffer,
  NormalizedTarget,
  OfferCondition,
  OfferPriceBasis,
  OfferVerification,
  PurchaseContext,
  RankedOffer,
} from './types.ts';
import type { SearchHit } from '../providers/index.ts';

const MARKET_DOMAINS: Array<[RegExp, string]> = [
  [/(^|\.)kream\.co\.kr$/, 'KREAM'],
  [/(^|\.)coupang\.com$/, '쿠팡'],
  [/(^|\.)naver\.com$/, '네이버'],
  [/(^|\.)danawa\.com$/, '다나와'],
  [/(^|\.)enuri\.com$/, '에누리'],
  [/(^|\.)11st\.co\.kr$/, '11번가'],
  [/(^|\.)gmarket\.co\.kr$/, 'G마켓'],
  [/(^|\.)auction\.co\.kr$/, '옥션'],
  [/(^|\.)ssg\.com$/, 'SSG'],
  [/(^|\.)lotteon\.com$/, '롯데ON'],
  [/(^|\.)aliexpress\.(?:com|us)$/, 'AliExpress'],
  [/(^|\.)temu\.com$/, 'Temu'],
  [/(^|\.)daangn\.com$/, '당근'],
  [/(^|\.)joongna\.com$/, '중고나라'],
  [/(^|\.)bunjang\.co\.kr$/, '번개장터'],
];

const PAYMENT_METHOD_PATTERN = /(?:토스\s*페이|카카오\s*페이|네이버\s*페이|N\s*PAY|PAYCO|페이코|삼성\s*페이|애플\s*페이)/i;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function marketFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return MARKET_DOMAINS.find(([pattern]) => pattern.test(host))?.[1] ?? host;
  } catch {
    return 'unknown';
  }
}

function conditionFrom(text: string): OfferCondition {
  if (/(중고|사용감|직거래)/i.test(text)) return 'used';
  if (/(리퍼|리퍼비시|refurb)/i.test(text)) return 'refurbished';
  if (/(반품|박스개봉|개봉 상품|open.?box)/i.test(text)) return 'open_box';
  if (/(전시|진열)/i.test(text)) return 'display';
  if (/(신품|새상품|미개봉|정품|공식)/i.test(text)) return 'new';
  return 'unknown';
}

interface MoneyMatch { value: number; index: number; before: string; after: string; context: string }

function moneyMatches(text: string): MoneyMatch[] {
  const output: MoneyMatch[] = [];
  for (const match of text.matchAll(/(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/g)) {
    const value = Number((match[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 1_000 || match.index === undefined) continue;
    output.push({
      value,
      index: match.index,
      before: text.slice(Math.max(0, match.index - 30), match.index),
      after: text.slice(match.index + match[0].length, Math.min(text.length, match.index + match[0].length + 30)),
      context: text.slice(Math.max(0, match.index - 30), Math.min(text.length, match.index + match[0].length + 30)),
    });
  }
  return output;
}

function firstBy(matches: MoneyMatch[], pattern: RegExp): MoneyMatch | undefined {
  return matches.find((match) => pattern.test(match.before.slice(-24)));
}

function nearestCardName(text: string, index: number): string | undefined {
  const window = text.slice(Math.max(0, index - 45), Math.min(text.length, index + 25));
  return window.match(/((?:삼성|신한|현대|국민|KB|롯데|하나|우리|NH|농협|BC|비씨|카카오뱅크|토스뱅크)[\w가-힣 ._-]{0,24}카드)/i)?.[1]?.trim();
}

function normalizedPaymentMethod(raw: string): string {
  const compacted = raw.replace(/\s+/g, '').toLowerCase();
  if (compacted === '토스페이') return '토스페이';
  if (compacted === '카카오페이') return '카카오페이';
  if (compacted === '네이버페이' || compacted === 'npay') return '네이버페이';
  if (compacted === 'payco' || compacted === '페이코') return 'PAYCO';
  if (compacted === '삼성페이') return '삼성페이';
  if (compacted === '애플페이') return '애플페이';
  return raw.trim();
}

function nearestPaymentMethod(text: string, index: number): string | undefined {
  const window = text.slice(Math.max(0, index - 45), Math.min(text.length, index + 30));
  const match = window.match(PAYMENT_METHOD_PATTERN)?.[0];
  return match ? normalizedPaymentMethod(match) : undefined;
}

function freeShipping(text: string): boolean {
  return /무료\s*배송|배송비\s*0\s*원/i.test(text);
}

function bundleRequired(target: NormalizedTarget): boolean {
  const text = compact([target.name, target.model, target.variant].filter(Boolean).join(' '));
  return /(세트|셋트|패키지|스탠드|이동형|V\d|\+)/i.test(text);
}

function bundleComplete(title: string, target: NormalizedTarget): boolean {
  if (!bundleRequired(target)) return true;
  if (/(TV|티비|본체)\s*(만|단품)|스탠드\s*(미포함|별도)|단품/i.test(title)) return false;
  const targetText = compact([target.name, target.model, target.variant].filter(Boolean).join(' ')).toLowerCase();
  const titleText = title.toLowerCase();
  const distinctive = targetText.match(/[a-z]{2,}[a-z0-9-]*\d[a-z0-9-]*/gi) ?? [];
  if (distinctive.length >= 2 && distinctive.filter((token) => titleText.includes(token.toLowerCase())).length < 2) return false;
  return /(세트|셋트|패키지|스탠드|이동형|삼탠바이미|V\d)/i.test(title);
}

function ownedCard(cardName: string | undefined, context: PurchaseContext): boolean {
  if (!cardName) return false;
  const normalized = cardName.toLowerCase().replace(/\s+/g, '');
  return (context.ownedCards ?? []).some((card) => {
    const owned = card.toLowerCase().replace(/\s+/g, '');
    return normalized.includes(owned) || owned.includes(normalized.replace(/카드$/, ''));
  });
}

function strongVerification(value: OfferVerification | undefined): boolean {
  return value === 'page_verified' || value === 'checkout_verified';
}

function unavailable(value: string | undefined): boolean {
  return Boolean(value && /(out[_ -]?of[_ -]?stock|sold[_ -]?out|discontinued|ended|품절|판매\s*종료|종료)/i.test(value));
}

function fieldVerificationSupportsDecision(offer: MarketOffer): boolean {
  if (!offer.fieldVerification) return true;
  return strongVerification(offer.fieldVerification.identity)
    && strongVerification(offer.fieldVerification.price)
    && strongVerification(offer.fieldVerification.shipping);
}

export function isDecisiveCashOffer(offer: MarketOffer): boolean {
  if (!offer.eligible || !offer.bundleComplete) return false;
  if (offer.condition !== 'new' && offer.condition !== 'unknown') return false;
  if (!strongVerification(offer.verification)) return false;
  if (offer.shippingFee === undefined || offer.totalCashPrice === undefined) return false;
  if (unavailable(offer.availability)) return false;
  if (offer.identityVerdict !== undefined && offer.identityVerdict !== 'exact') return false;
  if (offer.constraintStatus !== undefined && offer.constraintStatus !== 'eligible') return false;
  return fieldVerificationSupportsDecision(offer);
}

export function isAlternativeConditionOffer(offer: MarketOffer): boolean {
  if (offer.condition === 'new' || offer.condition === 'unknown') return false;
  if (!offer.bundleComplete) return false;
  if (!strongVerification(offer.verification)) return false;
  if (offer.shippingFee === undefined || offer.totalCashPrice === undefined) return false;
  if (unavailable(offer.availability)) return false;
  if (offer.identityVerdict !== undefined && offer.identityVerdict !== 'same_except_condition') return false;
  if (offer.constraintStatus !== undefined && offer.constraintStatus !== 'eligible') return false;
  return fieldVerificationSupportsDecision(offer);
}

function priceForBasis(offer: MarketOffer, basis: OfferPriceBasis, context: PurchaseContext): number | undefined {
  if (basis === 'alternative_condition') {
    return isAlternativeConditionOffer(offer) ? offer.totalCashPrice : undefined;
  }
  if (!isDecisiveCashOffer(offer)) return undefined;
  if (basis === 'cash') return offer.totalCashPrice;
  if (basis === 'owned_card') return ownedCard(offer.cardName, context) && offer.cardPrice !== undefined
    ? offer.cardPrice + (offer.shippingFee ?? 0)
    : undefined;
  if (basis === 'conditional_payment') {
    const conditional = offer.paymentPrice ?? offer.cardPrice;
    return conditional !== undefined ? conditional + (offer.shippingFee ?? 0) : undefined;
  }
  return offer.effectivePrice;
}

function ranked(offers: MarketOffer[], basis: OfferPriceBasis, context: PurchaseContext): RankedOffer[] {
  return offers.flatMap((offer) => {
    const amount = priceForBasis(offer, basis, context);
    if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return [];
    const paymentLabel = offer.paymentMethod ?? offer.cardName ?? '조건부 결제';
    return [{ basis, rank: 0, amount, offer, reasons: [
      basis === 'cash' ? '배송비를 포함한 현금 결제 기준' :
        basis === 'owned_card' ? `${offer.cardName ?? '보유 카드'} 조건 기준` :
          basis === 'conditional_payment' ? `${paymentLabel} 조건부 결제 기준` :
            basis === 'effective' ? '현금 결제액에서 표시된 적립을 차감한 참고 체감가' :
              `${offer.condition} 상태의 별도 대안`,
      `${offer.verification} 검증 수준`,
    ] }];
  }).sort((a, b) => a.amount - b.amount || b.offer.identityScore - a.offer.identityScore)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function buildMarketOffer(hit: SearchHit, target: NormalizedTarget, retrievedAt: string): MarketOffer | null {
  const title = compact(hit.title);
  const text = compact(`${hit.title} ${hit.snippet}`);
  const matches = moneyMatches(text);
  if (!matches.length) return null;

  const card = firstBy(matches, /카드.{0,16}(?:결제|할인|적용|혜택)|(?:결제|할인|적용).{0,16}카드/i);
  const payment = matches.find((match) => PAYMENT_METHOD_PATTERN.test(match.before.slice(-24)) && /(?:결제|할인|적용|혜택|가)/i.test(match.before.slice(-24)));
  const points = firstBy(matches, /(적립|포인트|리워드|캐시)/i);
  const shipping = firstBy(matches, /(배송비|배송료)/i);
  const list = firstBy(matches, /(정가|정상가|할인\s*전|소비자가)/i);
  const coupon = firstBy(matches, /(쿠폰가|쿠폰\s*적용|쿠폰\s*할인)/i);
  const membership = firstBy(matches, /(회원가|멤버십가|와우가|클럽가)/i);
  const sale = firstBy(matches, /(구매가|판매가|현재가|최저가|할인가|행사가|특가)/i)
    ?? matches.find((match) => match !== points && match !== shipping && match !== card && match !== payment && match !== list);
  if (!sale && !card && !payment && !coupon && !membership) return null;

  const match = matchEvidenceToProduct(target, hit);
  const condition = conditionFrom(text);
  const complete = bundleComplete(title, target);
  const exclusionReasons: string[] = [];
  if (!['exact_product', 'probable_product'].includes(match.level)) exclusionReasons.push('제품 식별 일치도가 부족합니다.');
  if (!complete) exclusionReasons.push('요청한 세트/패키지 전체 구성이 아닙니다.');
  if (/품절|판매\s*종료/i.test(text)) exclusionReasons.push('품절 또는 판매 종료로 표시됩니다.');

  const salePrice = sale?.value ?? coupon?.value ?? membership?.value ?? card?.value ?? payment?.value;
  const shippingFee = freeShipping(text) ? 0 : shipping?.value;
  const shippingKnown = shippingFee !== undefined || /배송비\s*포함/i.test(text);
  const totalCashPrice = salePrice !== undefined && shippingKnown ? salePrice + (shippingFee ?? 0) : undefined;
  const effectivePrice = totalCashPrice !== undefined && points?.value !== undefined
    ? Math.max(0, totalCashPrice - points.value)
    : undefined;
  const market = marketFromUrl(hit.url);
  const riskFlags: string[] = [];
  if (['AliExpress', 'Temu'].includes(market)) riskFlags.push('해외 배송·관부가세·국내 보증·반품 조건을 확인해야 합니다.');
  if (condition !== 'new' && condition !== 'unknown') riskFlags.push(`${condition} 상품의 상태·구성품·보증을 직접 확인해야 합니다.`);
  if (points) riskFlags.push('적립금은 현금 할인과 동일하지 않으며 사용·소멸 조건을 확인해야 합니다.');
  if (!shippingKnown) riskFlags.push('배송비가 명시되지 않아 총 현금 결제액 순위에서 제외됩니다.');

  const offer: MarketOffer = {
    id: `${market}:${hit.url}`,
    market,
    title,
    url: hit.url,
    currency: 'KRW',
    retrievedAt,
    verification: 'search_metadata',
    condition,
    identityScore: match.score,
    bundleComplete: complete,
    eligible: exclusionReasons.length === 0,
    conditions: [],
    riskFlags,
    exclusionReasons,
  };
  if (list) offer.listPrice = list.value;
  if (sale) offer.salePrice = sale.value;
  if (coupon) { offer.couponPrice = coupon.value; offer.conditions.push('쿠폰 적용 필요'); }
  if (membership) { offer.membershipPrice = membership.value; offer.conditions.push('멤버십 조건 확인 필요'); }
  if (card) {
    offer.cardPrice = card.value;
    const cardName = nearestCardName(text, card.index);
    if (cardName) offer.cardName = cardName;
    offer.conditions.push(`${cardName ?? '특정 카드'} 결제 조건`);
  }
  if (payment) {
    offer.paymentPrice = payment.value;
    const paymentMethod = nearestPaymentMethod(text, payment.index);
    if (paymentMethod) offer.paymentMethod = paymentMethod;
    offer.conditions.push(`${paymentMethod ?? '간편결제'} 결제 조건`);
  }
  if (points) offer.points = points.value;
  if (shippingFee !== undefined) offer.shippingFee = shippingFee;
  if (totalCashPrice !== undefined) offer.totalCashPrice = totalCashPrice;
  if (effectivePrice !== undefined) offer.effectivePrice = effectivePrice;
  if (/품절/i.test(text)) offer.availability = 'out_of_stock';
  return offer;
}

export function rankMarketOffers(offers: MarketOffer[], context: PurchaseContext = {}): {
  bestOffers: BestOffers;
  rankings: RankedOffer[];
} {
  const cash = ranked(offers, 'cash', context);
  const ownedCard = ranked(offers, 'owned_card', context);
  const conditionalPayment = ranked(offers, 'conditional_payment', context);
  const effective = ranked(offers, 'effective', context);
  const alternative = ranked(offers, 'alternative_condition', context);
  const bestOffers: BestOffers = {};
  if (cash[0]) bestOffers.cash = cash[0];
  if (ownedCard[0]) bestOffers.ownedCard = ownedCard[0];
  if (conditionalPayment[0]) bestOffers.conditionalPayment = conditionalPayment[0];
  if (effective[0]) bestOffers.effective = effective[0];
  if (alternative[0]) bestOffers.alternativeCondition = alternative[0];
  return { bestOffers, rankings: [...cash, ...ownedCard, ...conditionalPayment, ...effective, ...alternative] };
}