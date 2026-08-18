import type { EvidenceClass, NormalizedTarget } from './types.ts';
import type { SearchHit } from '../providers/index.ts';

function clampSignal(value: number): number {
  return Math.max(-0.8, Math.min(0.8, value));
}

function countPresent(text: string, phrases: readonly string[]): number {
  return phrases.reduce((count, phrase) => count + (text.includes(phrase) ? 1 : 0), 0);
}

function explicitSentiment(text: string): number | undefined {
  const negativePhrases = [
    '비추천', '불만', '고장', '불량', '흔들', '삐걱', '문제', '아쉽', '별로', '불편', '느림', '끊김', '소음', '단점',
  ] as const;
  const positivePhrases = [
    '만족', '튼튼', '안정적', '좋다', '좋음', '선명', '편리', '괜찮', '가성비 좋', '장점', '추천',
  ] as const;

  const negativeCount = countPresent(text, negativePhrases);
  const positiveText = text.replaceAll('비추천', '');
  const positiveCount = countPresent(positiveText, positivePhrases);
  if (negativeCount === 0 && positiveCount === 0) return undefined;
  return clampSignal((positiveCount - negativeCount) * 0.3);
}

function explicitPriceSignal(text: string): number | undefined {
  const positivePhrases = ['역대 최저', '최저가', '특가', '할인', '저렴', '가성비', '행사가', '가격 메리트'] as const;
  const negativePhrases = ['비싸', '고가', '가격 상승', '가격 올랐', '정가 구매', '할인 없음'] as const;
  const positiveCount = countPresent(text, positivePhrases);
  const negativeCount = countPresent(text, negativePhrases);
  if (positiveCount === 0 && negativeCount === 0) return undefined;
  return clampSignal((positiveCount - negativeCount) * 0.3);
}

function explicitKrwPrice(text: string): number | undefined {
  const matches = [...text.matchAll(/(?:₩\s*)?(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/g)];
  const candidates: Array<{ value: number; priority: number }> = [];

  for (const match of matches) {
    const value = Number((match[1] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 1_000 || match.index === undefined) continue;
    const start = Math.max(0, match.index - 18);
    const end = Math.min(text.length, match.index + match[0].length + 18);
    const context = text.slice(start, end);

    let priority = 0;
    if (/(쿠폰가|쿠폰 적용|멤버십가|회원가|최저가|할인가|행사가)/.test(context)) priority += 5;
    else if (/(판매가|현재가|현재|특가|가격)/.test(context)) priority += 4;
    else if (/(정가|정상가)/.test(context)) priority += 1;

    if (/(적립|포인트|리워드|캐시|배송비|배송료)/.test(context) && !/(판매가|현재가|쿠폰가|멤버십가|회원가|할인가)/.test(context)) {
      priority -= 6;
    }
    if (priority >= 0) candidates.push({ value, priority });
  }

  if (!candidates.length) return undefined;
  candidates.sort((a, b) => (b.priority - a.priority) || (b.value - a.value));
  return candidates[0]?.value;
}

export function deriveExplicitSearchSignals(
  hit: SearchHit,
  evidenceClass: EvidenceClass,
  target: NormalizedTarget,
): Record<string, unknown> {
  const text = `${hit.title} ${hit.snippet}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const data: Record<string, unknown> = {};
  const sentiment = explicitSentiment(text);
  const priceSignal = explicitPriceSignal(text);
  if (sentiment !== undefined) data.sentiment = sentiment;
  if (priceSignal !== undefined) data.priceSignal = priceSignal;

  if (evidenceClass === 'retailer_listing') {
    const price = explicitKrwPrice(text);
    if (price !== undefined) {
      const product: Record<string, unknown> = {
        offers: { price, currency: 'KRW' },
      };
      if (target.name) product.name = target.name;
      if (target.brand) product.brand = target.brand;
      data.product = product;
    }
  }
  return data;
}
