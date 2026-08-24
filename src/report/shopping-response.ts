export interface ClarificationInput {
  question: string;
  recommendationMode: boolean;
  known: Record<string, string | number | boolean | undefined>;
}

export interface ClarificationDecision {
  action: 'ask' | 'proceed';
  question?: string;
  assumptions: string[];
}

export interface StandardPriceInput {
  cash?: number;
  card?: number;
  cardCondition?: string;
  withoutMembershipEffective?: number;
  withMembershipEffective?: number;
  membershipName?: string;
}

export interface StandardPriceRow {
  key: 'cash' | 'card' | 'effective_without_membership' | 'effective_with_membership';
  label: string;
  amount?: number;
  condition?: string;
}

export interface EventWindowInput {
  startsAt?: string;
  endsAt?: string;
  observedAt: string;
}

export interface NormalizedEventWindow {
  startsOn?: string;
  endsOn?: string;
  status: 'upcoming' | 'active' | 'expired' | 'unknown';
}

export function decideClarification(input: ClarificationInput): ClarificationDecision {
  if (!input.recommendationMode) {
    const hasIdentity = Boolean(input.known.model || input.known.url || input.known.productId);
    if (!hasIdentity) {
      return {
        action: 'ask',
        question: '정확한 동일 상품 비교를 위해 모델명 또는 상품 URL을 알려주세요.',
        assumptions: [],
      };
    }
    return { action: 'proceed', assumptions: [] };
  }

  const assumptions: string[] = [];
  if (input.known.budget === undefined) assumptions.push('예산 미지정: 가성비 중심으로 폭넓게 비교');
  if (input.known.size === undefined) assumptions.push('크기 미지정: 카테고리 대표 규격을 우선 비교');
  return { action: 'proceed', assumptions };
}

export function buildStandardPriceRows(input: StandardPriceInput): StandardPriceRow[] {
  return [
    { key: 'cash', label: '현금 실결제가', amount: input.cash },
    { key: 'card', label: '카드 적용 결제가', amount: input.card, condition: input.cardCondition },
    {
      key: 'effective_without_membership',
      label: '멤버십 미가입 체감가',
      amount: input.withoutMembershipEffective,
    },
    {
      key: 'effective_with_membership',
      label: '멤버십 가입 체감가',
      amount: input.withMembershipEffective,
      condition: input.membershipName,
    },
  ];
}

function validDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function dateOnly(value: string | undefined): string | undefined {
  const parsed = validDate(value);
  if (parsed === undefined || !value) return undefined;
  return value.slice(0, 10);
}

export function normalizeEventWindow(input: EventWindowInput): NormalizedEventWindow {
  const observedAt = validDate(input.observedAt);
  const startsAt = validDate(input.startsAt);
  const endsAt = validDate(input.endsAt);
  let status: NormalizedEventWindow['status'] = 'unknown';
  if (observedAt !== undefined) {
    if (startsAt !== undefined && observedAt < startsAt) status = 'upcoming';
    else if (endsAt !== undefined && observedAt > endsAt) status = 'expired';
    else if (startsAt !== undefined || endsAt !== undefined) status = 'active';
  }
  return {
    startsOn: dateOnly(input.startsAt),
    endsOn: dateOnly(input.endsAt),
    status,
  };
}
