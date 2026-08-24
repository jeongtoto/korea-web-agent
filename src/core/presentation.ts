import type { BestOffers, MembershipScenario, PriceHistorySummary, ShoppingPresentation, ShoppingPresentationRow } from './types.ts';

export interface PresentationInput {
  bestOffers?: BestOffers;
  membershipScenarios?: MembershipScenario[];
  priceHistory?: PriceHistorySummary;
}

function rankedRow(label: ShoppingPresentationRow['label'], ranked: NonNullable<BestOffers[keyof BestOffers]>): ShoppingPresentationRow {
  const offer = ranked.offer;
  return {
    label,
    amount: ranked.amount,
    market: offer.market,
    ...(offer.seller ? { seller: offer.seller } : {}),
    ...(offer.paymentMethod ? { paymentMethod: offer.paymentMethod } : offer.cardName ? { paymentMethod: offer.cardName } : {}),
    ...(offer.membershipName ? { membership: offer.membershipName } : {}),
    ...(offer.points !== undefined ? { expectedPoints: offer.points } : {}),
    ...(offer.effectivePrice !== undefined ? { effectivePrice: offer.effectivePrice } : {}),
    ...(offer.startsAt || offer.endsAt ? { eventPeriod: [offer.startsAt, offer.endsAt].filter(Boolean).join(' ~ ') } : {}),
    verification: offer.verification,
    retrievedAt: offer.retrievedAt,
    notes: ranked.reasons,
  };
}

export function buildPresentation(input: PresentationInput): ShoppingPresentation {
  const rows: ShoppingPresentationRow[] = [];
  if (input.bestOffers?.cash) rows.push(rankedRow('현금 실결제가', input.bestOffers.cash));
  if (input.bestOffers?.ownedCard) rows.push(rankedRow('보유카드가', input.bestOffers.ownedCard));
  if (input.bestOffers?.advertisedPayment) rows.push(rankedRow('광고 결제수단 최저가', input.bestOffers.advertisedPayment));

  const member = input.membershipScenarios?.filter((item) => item.member && item.effectivePrice !== undefined).sort((a, b) => a.effectivePrice! - b.effectivePrice!)[0];
  if (member) rows.push({
    label: '회원 체감가', amount: member.paymentPrice, market: member.market, membership: member.membership,
    expectedPoints: member.expectedPoints, effectivePrice: member.effectivePrice, verification: member.verification,
    retrievedAt: member.retrievedAt, notes: member.notes,
  });
  const nonMember = input.membershipScenarios?.filter((item) => !item.member && item.effectivePrice !== undefined).sort((a, b) => a.effectivePrice! - b.effectivePrice!)[0];
  if (nonMember) rows.push({
    label: '비회원 체감가', amount: nonMember.paymentPrice, market: nonMember.market,
    expectedPoints: nonMember.expectedPoints, effectivePrice: nonMember.effectivePrice, verification: nonMember.verification,
    retrievedAt: nonMember.retrievedAt, notes: nonMember.notes,
  });
  if (input.bestOffers?.alternativeCondition) rows.push(rankedRow('리퍼/반품/중고', input.bestOffers.alternativeCondition));
  if (input.priceHistory) rows.push({
    label: '180일 가격 위치',
    ...(input.priceHistory.currentPrice !== undefined ? { amount: input.priceHistory.currentPrice } : {}),
    verification: 'observed_history',
    retrievedAt: input.priceHistory.lastObservedAt ?? new Date(0).toISOString(),
    notes: [input.priceHistory.position, `${input.priceHistory.observationCount}개 관측`, input.priceHistory.coverage],
  });
  return { schemaVersion: '1', rows };
}
