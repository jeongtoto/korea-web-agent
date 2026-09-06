import type { ProductReport } from '../core/types.ts';
import { buildStandardPriceRows, normalizeEventWindow } from './shopping-response.ts';

function publicCash(report: ProductReport): number | undefined {
  const snapshot = report.price;
  return report.bestOffers?.cash?.amount
    ?? snapshot?.cashPaymentPrice
    ?? snapshot?.salePrice;
}

export function enrichShoppingReport(report: ProductReport, observedAt: string): ProductReport {
  const snapshot = report.price;
  const cash = publicCash(report);

  // Account/member/card economics are intentionally not converted into standard price rows.
  // They remain raw diagnostic signals that presentation can describe as benefit hints, while
  // the user confirms actual eligibility and checkout amount on the seller page.
  delete report.membershipScenarios;

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

  const rows = buildStandardPriceRows({
    ...(cash !== undefined ? { cash } : {}),
  });
  report.standardPriceRows = rows.map((row) => ({
    key: row.key,
    label: row.label,
    ...(row.amount !== undefined ? { amount: row.amount } : {}),
    ...(row.condition ? { condition: row.condition } : {}),
  }));

  return report;
}
