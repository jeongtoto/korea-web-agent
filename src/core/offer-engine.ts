import { matchEvidenceToProduct } from './product-match.ts';
import { extractVersionTokens, normalizeModelCode } from './sku-normalization.ts';
import type { BestOffers, MarketOffer, MembershipScenario, NormalizedTarget, OfferCondition, OfferPriceBasis, PaymentPromotion, PromotionValidityStatus, PurchaseContext, RankedOffer } from './types.ts';
import type { SearchHit } from '../providers/index.ts';

const MARKET_DOMAINS: Array<[RegExp, string]> = [
  [/(^|\.)kream\.co\.kr$/, 'KREAM'], [/(^|\.)coupang\.com$/, '쿠팡'], [/(^|\.)naver\.com$/, '네이버'],
  [/(^|\.)danawa\.com$/, '다나와'], [/(^|\.)enuri\.com$/, '에누리'], [/(^|\.)11st\.co\.kr$/, '11번가'],
  [/(^|\.)gmarket\.co\.kr$/, 'G마켓'], [/(^|\.)auction\.co\.kr$/, '옥션'], [/(^|\.)ssg\.com$/, 'SSG'],
  [/(^|\.)lotteon\.com$/, '롯데ON'], [/(^|\.)aliexpress\.(?:com|us)$/, 'AliExpress'], [/(^|\.)temu\.com$/, 'Temu'],
  [/(^|\.)daangn\.com$/, '당근'], [/(^|\.)joongna\.com$/, '중고나라'], [/(^|\.)bunjang\.co\.kr$/, '번개장터'],
];
const PAYMENT_METHOD_RE = /((?:삼성|신한|현대|국민|KB|롯데|하나|우리|NH|농협|BC|비씨|카카오뱅크|토스뱅크)[\w가-힣 ._-]{0,24}카드|토스\s*페이|카카오\s*페이|네이버\s*페이|삼성\s*페이|페이코)/i;
const MEMBERSHIP_RE = /(네이버\s*플러스(?:\s*멤버십)?|쿠팡\s*와우|신세계\s*유니버스|SSG\s*멤버십|롯데\s*멤버스)/i;

function compact(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function marketFromUrl(url: string): string { try { const host = new URL(url).hostname.toLowerCase(); return MARKET_DOMAINS.find(([p]) => p.test(host))?.[1] ?? host; } catch { return 'unknown'; } }
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
  const out: MoneyMatch[] = [];
  for (const match of text.matchAll(/(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/g)) {
    const value = Number((match[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 1_000 || match.index === undefined) continue;
    out.push({ value, index: match.index, before: text.slice(Math.max(0, match.index - 40), match.index), after: text.slice(match.index + match[0].length, match.index + match[0].length + 40), context: text.slice(Math.max(0, match.index - 40), match.index + match[0].length + 40) });
  }
  return out;
}
function firstBy(matches: MoneyMatch[], pattern: RegExp): MoneyMatch | undefined { return matches.find((m) => pattern.test(m.before.slice(-32))); }
function paymentMethodNear(text: string, index: number): string | undefined {
  const window = text.slice(Math.max(0, index - 55), Math.min(text.length, index + 20));
  return window.match(PAYMENT_METHOD_RE)?.[1]?.replace(/\s+/g, '').replace(/^KB/i, 'KB').trim();
}
function freeShipping(text: string): boolean { return /무료\s*배송|배송비\s*0\s*원/i.test(text); }
function bundleRequired(target: NormalizedTarget): boolean { return /(세트|셋트|패키지|스탠드|이동형|V\s*\d|\+)/i.test(compact([target.name, target.model, target.variant].filter(Boolean).join(' '))); }
function bundleComplete(title: string, target: NormalizedTarget): boolean {
  if (!bundleRequired(target)) return true;
  if (/(TV|티비|본체)\s*(만|단품)|스탠드\s*(미포함|별도)|단품/i.test(title)) return false;
  const targetVersions = extractVersionTokens([target.name, target.model, target.variant].filter(Boolean).join(' '));
  const titleVersions = extractVersionTokens(title);
  if (targetVersions.length && titleVersions.length && !targetVersions.some((v) => titleVersions.includes(v))) return false;
  const targetCodes = ([target.model, ...(target.name?.match(/[A-Za-z]{2,}[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*/g) ?? [])]).filter(Boolean).map((v) => normalizeModelCode(v));
  const titleCode = normalizeModelCode(title);
  if (targetCodes.length >= 2 && targetCodes.filter((code) => titleCode.includes(code)).length < 2) return false;
  return /(세트|셋트|패키지|스탠드|이동형|삼탠바이미|V\s*\d)/i.test(title);
}
function ownedCard(cardName: string | undefined, context: PurchaseContext): boolean {
  if (!cardName) return false;
  const normalized = cardName.toLowerCase().replace(/\s+/g, '');
  return (context.ownedCards ?? []).some((card) => { const owned = card.toLowerCase().replace(/\s+/g, ''); return normalized.includes(owned) || owned.includes(normalized.replace(/카드$/, '')); });
}
function exactAmount(text: string, pattern: RegExp): number | undefined { const match = text.match(pattern); return match?.[1] ? Number(match[1].replace(/,/g, '')) : undefined; }
function localIso(year: number, month: number, day: number, hh = 0, mm = 0): string { return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00+09:00`; }
function eventWindow(text: string, now: Date): { startsAt?: string; endsAt?: string; timeZone?: string; validityStatus: PromotionValidityStatus } {
  const range = text.match(/(?:(20\d{2})[.\/-])?(\d{1,2})\s*월?\s*[.\/-]?\s*(\d{1,2})\s*일?\s*(\d{1,2})?[:시]?\s*(\d{2})?\s*(?:부터|~|-)\s*(?:(20\d{2})[.\/-])?(\d{1,2})\s*월?\s*[.\/-]?\s*(\d{1,2})\s*일?\s*(\d{1,2})?[:시]?\s*(\d{2})?\s*(?:까지)?/i);
  if (!range) return { validityStatus: 'unknown' };
  const year = Number(range[1] ?? now.getUTCFullYear()); const endYear = Number(range[6] ?? year);
  const startsAt = localIso(year, Number(range[2]), Number(range[3]), Number(range[4] ?? 0), Number(range[5] ?? 0));
  const endsAt = localIso(endYear, Number(range[7]), Number(range[8]), Number(range[9] ?? 23), Number(range[10] ?? 59));
  const nowMs = now.getTime(); const startMs = Date.parse(startsAt); const endMs = Date.parse(endsAt);
  return { startsAt, endsAt, timeZone: 'Asia/Seoul', validityStatus: nowMs < startMs ? 'upcoming' : nowMs > endMs ? 'expired' : 'active' };
}
function priceForBasis(offer: MarketOffer, basis: OfferPriceBasis, context: PurchaseContext): number | undefined {
  if (basis === 'alternative_condition') return offer.condition === 'new' || offer.condition === 'unknown' ? undefined : offer.totalCashPrice;
  if (!offer.eligible || (offer.condition !== 'new' && offer.condition !== 'unknown')) return undefined;
  if (basis === 'cash') return offer.totalCashPrice;
  if (basis === 'owned_card') return ownedCard(offer.cardName, context) && offer.cardPrice !== undefined && offer.shippingFee !== undefined ? offer.cardPrice + offer.shippingFee : undefined;
  if (basis === 'advertised_payment') return offer.paymentPrice !== undefined && offer.shippingFee !== undefined ? offer.paymentPrice + offer.shippingFee : undefined;
  return offer.effectivePrice;
}
function ranked(offers: MarketOffer[], basis: OfferPriceBasis, context: PurchaseContext): RankedOffer[] {
  return offers.flatMap((offer) => { const amount = priceForBasis(offer, basis, context); if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return []; return [{ basis, rank: 0, amount, offer, reasons: [basis === 'cash' ? '배송비를 포함한 현금 결제 기준' : basis === 'owned_card' ? `${offer.cardName ?? '보유 카드'} 조건 기준` : basis === 'advertised_payment' ? `${offer.paymentMethod ?? '광고 결제수단'} 프로모션 기준(보유 여부 미확인)` : basis === 'effective' ? '현금 결제액에서 표시된 적립을 차감한 참고 체감가' : `${offer.condition} 상태의 별도 대안`, `${offer.verification} 검증 수준`] }]; }).sort((a,b) => a.amount-b.amount || b.offer.identityScore-a.offer.identityScore).map((e,i)=>({...e,rank:i+1}));
}

export function buildMarketOffer(hit: SearchHit, target: NormalizedTarget, retrievedAt: string, now = new Date(retrievedAt)): MarketOffer | null {
  const title = compact(hit.title); const text = compact(`${hit.title} ${hit.snippet}`); const matches = moneyMatches(text); if (!matches.length) return null;
  const payment = matches.find((m) => Boolean(paymentMethodNear(text, m.index)) && /(결제|할인|적용|혜택|\s시\s)/i.test(m.before.slice(-35)));
  const points = firstBy(matches, /(적립|포인트|리워드|캐시)/i); const shipping = firstBy(matches, /(배송비|배송료)/i); const list = firstBy(matches, /(정가|정상가|할인\s*전|소비자가)/i);
  const coupon = firstBy(matches, /(쿠폰가|쿠폰\s*적용|쿠폰\s*할인)/i); const membership = firstBy(matches, /(?<!비)(회원가|멤버십가|와우가|클럽가)/i);
  const sale = firstBy(matches, /(?:비회원\s*)?(구매가|판매가|현재가|최저가|할인가|행사가|특가)/i) ?? matches.find((m)=>m!==points&&m!==shipping&&m!==payment&&m!==list);
  if (!sale && !payment && !coupon && !membership) return null;
  const match = matchEvidenceToProduct(target, hit); const condition = conditionFrom(text); const complete = bundleComplete(title,target); const exclusionReasons:string[]=[];
  if (!['exact_product','probable_product'].includes(match.level)) exclusionReasons.push('제품 식별 일치도가 부족합니다.'); if (!complete) exclusionReasons.push('요청한 세트/패키지 전체 구성이 아닙니다.'); if (/품절|판매\s*종료/i.test(text)) exclusionReasons.push('품절 또는 판매 종료로 표시됩니다.');
  const salePrice=sale?.value??coupon?.value??membership?.value??payment?.value; const shippingFee=freeShipping(text)?0:shipping?.value; const shippingKnown=shippingFee!==undefined||/배송비\s*포함/i.test(text); const totalCashPrice=salePrice!==undefined&&shippingKnown?salePrice+(shippingFee??0):undefined; const effectivePrice=totalCashPrice!==undefined&&points?.value!==undefined?Math.max(0,totalCashPrice-points.value):undefined;
  const market=marketFromUrl(hit.url); const riskFlags:string[]=[]; if(['AliExpress','Temu'].includes(market))riskFlags.push('해외 배송·관부가세·국내 보증·반품 조건을 확인해야 합니다.'); if(condition!=='new'&&condition!=='unknown')riskFlags.push(`${condition} 상품의 상태·구성품·보증을 직접 확인해야 합니다.`); if(points)riskFlags.push('적립금은 현금 할인과 동일하지 않으며 사용·소멸 조건을 확인해야 합니다.'); if(!shippingKnown)riskFlags.push('배송비가 명시되지 않아 총 현금 결제액 순위에서 제외됩니다.');
  const window=eventWindow(text,now); const offer:MarketOffer={id:`${market}:${hit.url}`,market,title,url:hit.url,currency:'KRW',retrievedAt,verification:'search_metadata',condition,identityScore:match.score,bundleComplete:complete,eligible:exclusionReasons.length===0,conditions:[],riskFlags,exclusionReasons,observedAt:retrievedAt,validityStatus:window.validityStatus};
  if(window.startsAt)offer.startsAt=window.startsAt;if(window.endsAt)offer.endsAt=window.endsAt;if(window.timeZone)offer.timeZone=window.timeZone;
  if(list)offer.listPrice=list.value;if(sale)offer.salePrice=sale.value;if(coupon){offer.couponPrice=coupon.value;offer.conditions.push('쿠폰 적용 필요');}
  const membershipName=text.match(MEMBERSHIP_RE)?.[1]?.replace(/\s+/g,' '); if(membership){offer.membershipPrice=membership.value;offer.membershipName=membershipName;offer.conditions.push(`${membershipName??'멤버십'} 가입 조건 확인 필요`);}
  const nonMemberPrice=exactAmount(text,/비회원\s*(?:판매가|구매가|가격)\s*(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/i); if(nonMemberPrice!==undefined)offer.nonMemberPrice=nonMemberPrice;
  const memberPoints=exactAmount(text,/(?<!비)회원\s*(?:적립|포인트)\s*(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/i); if(memberPoints!==undefined)offer.memberPoints=memberPoints;
  const nonMemberPoints=exactAmount(text,/(?:기본|비회원)\s*(?:적립|포인트)\s*(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/i); if(nonMemberPoints!==undefined)offer.nonMemberPoints=nonMemberPoints;
  if(payment){const method=paymentMethodNear(text,payment.index);if(method){offer.paymentMethod=method;offer.paymentPrice=payment.value;offer.conditions.push(`${method} 결제 조건`);if(/카드$/i.test(method)){offer.cardName=method;offer.cardPrice=payment.value;}}}
  if(points)offer.points=points.value;if(shippingFee!==undefined)offer.shippingFee=shippingFee;if(totalCashPrice!==undefined)offer.totalCashPrice=totalCashPrice;if(effectivePrice!==undefined)offer.effectivePrice=effectivePrice;if(/품절/i.test(text))offer.availability='out_of_stock';return offer;
}

export function rankMarketOffers(offers: MarketOffer[], context: PurchaseContext = {}): { bestOffers: BestOffers; rankings: RankedOffer[]; paymentPromotions: PaymentPromotion[]; membershipScenarios: MembershipScenario[] } {
  const cash=ranked(offers,'cash',context),owned=ranked(offers,'owned_card',context),advertised=ranked(offers,'advertised_payment',context),effective=ranked(offers,'effective',context),alternative=ranked(offers,'alternative_condition',context); const bestOffers:BestOffers={};
  if(cash[0])bestOffers.cash=cash[0];if(owned[0])bestOffers.ownedCard=owned[0];if(advertised[0])bestOffers.advertisedPayment=advertised[0];if(effective[0])bestOffers.effective=effective[0];if(alternative[0])bestOffers.alternativeCondition=alternative[0];
  const paymentPromotions:PaymentPromotion[]=offers.filter((o)=>o.eligible&&o.paymentMethod&&o.paymentPrice!==undefined).map((o)=>({method:o.paymentMethod!,amount:o.paymentPrice!+(o.shippingFee??0),market:o.market,url:o.url,verification:o.verification,retrievedAt:o.retrievedAt,conditions:o.conditions,...(o.startsAt?{startsAt:o.startsAt}:{}),...(o.endsAt?{endsAt:o.endsAt}:{}),...(o.validityStatus?{validityStatus:o.validityStatus}:{})})).sort((a,b)=>a.amount-b.amount);
  const membershipScenarios:MembershipScenario[]=[]; for(const o of offers){if(!o.eligible)continue;if(o.membershipPrice!==undefined){membershipScenarios.push({member:true,...(o.membershipName?{membership:o.membershipName}:{}),market:o.market,url:o.url,paymentPrice:o.membershipPrice,expectedPoints:o.memberPoints,effectivePrice:o.memberPoints!==undefined?Math.max(0,o.membershipPrice-o.memberPoints):o.membershipPrice,verification:o.verification,retrievedAt:o.retrievedAt,notes:o.conditions});}if(o.nonMemberPrice!==undefined){membershipScenarios.push({member:false,market:o.market,url:o.url,paymentPrice:o.nonMemberPrice,expectedPoints:o.nonMemberPoints,effectivePrice:o.nonMemberPoints!==undefined?Math.max(0,o.nonMemberPrice-o.nonMemberPoints):o.nonMemberPrice,verification:o.verification,retrievedAt:o.retrievedAt,notes:[]});}}
  return {bestOffers,rankings:[...cash,...owned,...advertised,...effective,...alternative],paymentPromotions,membershipScenarios};
}
