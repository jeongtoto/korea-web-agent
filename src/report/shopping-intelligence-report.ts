import type { ProductReport } from '../core/types.ts';
import { buildMembershipScenarios } from '../core/shopping-intelligence.ts';
import { buildStandardPriceRows, normalizeEventWindow } from './shopping-response.ts';

function snapshotCash(report: ProductReport): number | undefined {
  const snapshot = report.personalizedPrice ?? report.price;
  return snapshot?.cashPaymentPrice
    ?? report.bestOffers?.cash?.amount
    ?? snapshot?.salePrice;
}

function conditionalPrice(report: ProductReport): { amount?: number; condition?: string } {
  const owned = report.bestOffers?.ownedCard;
  if (owned) return {
    amount: owned.amount,
    ...(owned.offer.cardName ? { condition: owned.offer.cardName } : {}),
  };
  const conditional = report.bestOffers?.conditionalPayment;
  if (conditional) {
    const condition = conditional.offer.paymentMethod ?? conditional.offer.cardName;
    return {
      amount: conditional.amount,
      ...(condition ? { condition } : {}),
    };
  }
  return {};
}

export function enrichShoppingReport(report: ProductReport, observedAt: string): ProductReport {
  const snapshot = report.personalizedPrice ?? report.price;
  const cash = snapshotCash(report);
  const conditional = conditionalPrice(report);

  if (snapshot && cash !== undefined && (snapshot.basePoints !== undefined || snapshot.membershipPoints !== undefined)) {
    const scenarios = buildMembershipScenarios({
      cashPaymentPrice: cash,
      ...(snapshot.basePoints !== undefined ? { basePoints: snapshot.basePoints } : {}),
      ...(snapshot.membershipPoints !== undefined ? { membershipPoints: snapshot.membershipPoints } : {}),
    });
    report.membershipScenarios = {
      ...(scenarios.membershipName ? { membershipName: scenarios.membershipName } : {}),
      withoutMembership: { ...scenarios.withoutMembership },
      withMembership: { ...scenarios.withMembership },
    };
  }

  if (snapshot?.liveEndAt) {
    const eventWindow = normalizeEventWindow({
      endsAt: snapshot.liveEndAt,
      observedAt,
    });
    report.eventWindow = {
      ...(eventWindow.startsOn ? { startsOn: eventWindow.startsOn } : {}),
      ...(eventWindow.endsOn ? { endsOn: eventWindow.endsOn } : {}),
      status: eventWindow.status,
    };
  }

  const withoutMembershipEffective = report.membershipScenarios?.withoutMembership.effectivePrice
    ?? report.bestOffers?.effective?.amount;
  const withMembershipEffective = report.membershipScenarios?.withMembership.effectivePrice;
  const rows = buildStandardPriceRows({
    ...(cash !== undefined ? { cash } : {}),
    ...(conditional.amount !== undefined ? { card: conditional.amount } : {}),
    ...(conditional.condition ? { cardCondition: conditional.condition } : {}),
    ...(withoutMembershipEffective !== undefined ? { withoutMembershipEffective } : {}),
    ...(withMembershipEffective !== undefined ? { withMembershipEffective } : {}),
  });
  report.standardPriceRows = rows.map((row) => ({
    key: row.key,
    label: row.label,
    ...(row.amount !== undefined ? { amount: row.amount } : {}),
    ...(row.condition ? { condition: row.condition } : {}),
  }));

  return report;
}
