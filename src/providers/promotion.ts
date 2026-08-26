import type { PromotionState, PromotionType } from '../core/types.ts';

export interface PromotionInput {
  type: PromotionType;
  startsAt?: string;
  endsAt?: string;
  condition?: string;
  accountRequired?: boolean;
}

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function normalizePromotion(
  input: PromotionInput,
  observedAt: string,
): PromotionState {
  if (input.type === 'none') return { type: 'none', active: true };

  const observed = timestamp(observedAt);
  const starts = timestamp(input.startsAt);
  const ends = timestamp(input.endsAt);
  let active: PromotionState['active'] = 'unknown';

  if (observed !== undefined) {
    if (starts !== undefined && observed < starts) active = false;
    else if (ends !== undefined && observed > ends) active = false;
    else if (starts !== undefined || ends !== undefined) active = true;
  }

  return {
    type: input.type,
    active,
    ...(input.startsAt ? { startsAt: input.startsAt } : {}),
    ...(input.endsAt ? { endsAt: input.endsAt } : {}),
    ...(input.condition ? { condition: input.condition } : {}),
    ...(input.accountRequired !== undefined ? { accountRequired: input.accountRequired } : {}),
  };
}

export function isCurrentPublicPromotion(promotion: PromotionState | undefined): boolean {
  if (!promotion || promotion.type === 'none') return true;
  return promotion.active === true && promotion.accountRequired !== true;
}
