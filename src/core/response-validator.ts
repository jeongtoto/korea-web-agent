import type { ProductReport, PurchaseContext, ResearchRequest } from './types.ts';

export type ReliabilityIssueSeverity = 'blocker' | 'warning';

export type ReliabilityIssueCode =
  | 'IDENTITY_INCOMPLETE_IN_WINNER'
  | 'HARD_CONSTRAINT_UNKNOWN_IN_WINNER'
  | 'HARD_CONSTRAINT_FAILED_IN_WINNER'
  | 'SEARCH_METADATA_AS_DECISIVE'
  | 'UNKNOWN_SHIPPING_IN_WINNER'
  | 'ALTERNATIVE_SKU_MISMATCH'
  | 'PERSONALIZED_IDENTITY_MISMATCH'
  | 'HISTORY_IDENTITY_MISMATCH'
  | 'UNOWNED_CARD_IN_OWNED_RANKING'
  | 'POINTS_AS_CASH'
  | 'EXPIRED_PROMOTION'
  | 'MARKET_COVERAGE_INCONSISTENT'
  | 'PURCHASE_CONTEXT_NOT_APPLIED';

export interface ReliabilityIssue {
  code: ReliabilityIssueCode;
  severity: ReliabilityIssueSeverity;
  message: string;
}

interface PurchaseContextApplied {
  ownedCards: string[];
  paymentMethods: string[];
  memberships: string[];
  budget?: number;
  region?: string;
  preferences: string[];
}

type ReportWithContext = ProductReport & { purchaseContextApplied?: PurchaseContextApplied };

function issue(
  code: ReliabilityIssueCode,
  message: string,
  severity: ReliabilityIssueSeverity = 'blocker',
): ReliabilityIssue {
  return { code, severity, message };
}

function compactCard(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function cardIsOwned(cardName: string | undefined, context: PurchaseContext | undefined): boolean {
  if (!cardName) return false;
  const normalized = compactCard(cardName);
  return (context?.ownedCards ?? []).some((card) => {
    const owned = compactCard(card);
    return normalized.includes(owned) || owned.includes(normalized.replace(/카드$/, ''));
  });
}

function normalizedArray(value: string[] | undefined): string[] {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

function expectedContext(context: PurchaseContext): PurchaseContextApplied {
  return {
    ownedCards: normalizedArray(context.ownedCards),
    paymentMethods: normalizedArray(context.paymentMethods),
    memberships: normalizedArray(context.memberships),
    ...(context.budget !== undefined ? { budget: context.budget } : {}),
    ...(context.region?.trim() ? { region: context.region.trim() } : {}),
    preferences: normalizedArray(context.preferences),
  };
}

function sameContext(actual: PurchaseContextApplied, expected: PurchaseContextApplied): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function validateProductReport(
  report: ProductReport,
  request: ResearchRequest,
): ReliabilityIssue[] {
  const issues: ReliabilityIssue[] = [];
  const decisive = [
    report.bestOffers?.cash,
    report.bestOffers?.ownedCard,
    report.bestOffers?.conditionalPayment,
    report.bestOffers?.effective,
  ].filter((winner): winner is NonNullable<typeof winner> => Boolean(winner));

  for (const winner of decisive) {
    const offer = winner.offer;
    if (offer.identityVerdict !== undefined && offer.identityVerdict !== 'exact') {
      issues.push(issue(
        'IDENTITY_INCOMPLETE_IN_WINNER',
        `Decisive ${winner.basis} winner does not have exact product identity.`,
      ));
    }
    if (offer.constraintStatus === 'preliminary') {
      issues.push(issue(
        'HARD_CONSTRAINT_UNKNOWN_IN_WINNER',
        `Decisive ${winner.basis} winner still has an unverified hard constraint.`,
      ));
    }
    if (offer.constraintStatus === 'excluded') {
      issues.push(issue(
        'HARD_CONSTRAINT_FAILED_IN_WINNER',
        `Decisive ${winner.basis} winner fails a hard constraint.`,
      ));
    }
    if (offer.verification === 'search_metadata' || offer.verification === 'unverified') {
      issues.push(issue(
        'SEARCH_METADATA_AS_DECISIVE',
        `Decisive ${winner.basis} winner is not verified on a product or checkout page.`,
      ));
    }
    if (offer.shippingFee === undefined) {
      issues.push(issue(
        'UNKNOWN_SHIPPING_IN_WINNER',
        `Decisive ${winner.basis} winner has unknown shipping cost.`,
      ));
    }
  }

  const alternative = report.bestOffers?.alternativeCondition;
  if (alternative && alternative.offer.identityVerdict !== 'same_except_condition') {
    issues.push(issue(
      'ALTERNATIVE_SKU_MISMATCH',
      'Alternative-condition winner is not verified as the same product except for condition.',
    ));
  }

  const ownedCardWinner = report.bestOffers?.ownedCard;
  if (ownedCardWinner && !cardIsOwned(ownedCardWinner.offer.cardName, request.purchaseContext)) {
    issues.push(issue(
      'UNOWNED_CARD_IN_OWNED_RANKING',
      'Owned-card winner uses a card that is not present in this request purchase context.',
    ));
  }

  const applied = (report as ReportWithContext).purchaseContextApplied;
  if (applied && !request.purchaseContext) {
    issues.push(issue(
      'PURCHASE_CONTEXT_NOT_APPLIED',
      'Report contains user-specific purchase context that was not supplied in this request.',
    ));
  } else if (request.purchaseContext) {
    const expected = expectedContext(request.purchaseContext);
    if (!applied || !sameContext(applied, expected)) {
      issues.push(issue(
        'PURCHASE_CONTEXT_NOT_APPLIED',
        'Report does not accurately echo the request-scoped purchase context that was applied.',
      ));
    }
  }

  for (const coverage of report.marketCoverage ?? []) {
    if (coverage.verified > coverage.found || (coverage.status === 'verified' && coverage.verified <= 0)) {
      issues.push(issue(
        'MARKET_COVERAGE_INCONSISTENT',
        `Market coverage for ${coverage.market} is internally inconsistent.`,
        'warning',
      ));
    }
  }

  if (report.eventWindow?.status === 'expired' && decisive.length > 0) {
    issues.push(issue(
      'EXPIRED_PROMOTION',
      'A decisive offer is shown while the attached promotion window is expired.',
      'warning',
    ));
  }

  return issues;
}
