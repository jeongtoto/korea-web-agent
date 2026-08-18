import type { ResearchIntent } from './types.ts';

function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[?!.~,;:()[\]{}<>"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SPEC_TRIGGERS = [
  '스펙',
  '사양',
  '패널',
  '해상도',
  '주사율',
  '크기',
  '무게',
  '규격',
  '포트',
  '지원해',
  '지원돼',
] as const;

const PURCHASE_TRIGGERS = [
  '어때',
  '살만',
  '사도 돼',
  '사도돼',
  '지금 사',
  '구매',
  '추천',
  '가성비',
  '기다려',
  '기다릴',
] as const;

const PRICE_TRIGGERS = [
  '가격',
  '최저가',
  '얼마',
  '쿠폰',
  '멤버십',
  '적립',
  '배송',
  '특가',
  '할인',
  '혜택',
  '실구매',
] as const;

function includesAny(text: string, triggers: readonly string[]): boolean {
  return triggers.some((trigger) => text.includes(trigger));
}

export function classifyResearchIntent(question: string): ResearchIntent {
  const text = normalizeQuestion(question);
  const hasSpec = includesAny(text, SPEC_TRIGGERS);
  const hasPurchase = includesAny(text, PURCHASE_TRIGGERS);
  const hasPrice = includesAny(text, PRICE_TRIGGERS);
  const specOnly = hasSpec && !hasPurchase && !hasPrice;
  const purchaseDecision = !specOnly && (hasPurchase || hasPrice);
  const priceSensitive = !specOnly && (hasPrice || hasPurchase);

  return {
    productResearch: true,
    purchaseDecision,
    priceSensitive,
    personalizedPriceUseful: priceSensitive,
    specOnly,
  };
}
