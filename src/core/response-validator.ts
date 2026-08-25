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

export interface PurchaseContextApplied {
  ownedCards: string[];
  paymentMethods: string[];
  memberships: string[];
  budget?: number;
  region?: string;
  preferences: string[];
}

type ReportWithReliability = ProductReport & {
  purchaseContextApplied?: PurchaseContextApplied;
  validationWarnings?: ReliabilityIssue[];
};

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

export function normalizePurchaseContextApplied(context: PurchaseContext): PurchaseContextApplied {
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

  const applied = (report as ReportWithReliability).purchaseContextApplied;
  if (applied && !request.purchaseContext) {
    issues.push(issue(
      'PURCHASE_CONTEXT_NOT_APPLIED',
      'Report contains user-specific purchase context that was not supplied in this request.',
    ));
  } else if (request.purchaseContext) {
    const expected = normalizePurchaseContextApplied(request.purchaseContext);
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

export function applyProductReportValidation(
  report: ProductReport,
  request: ResearchRequest,
): ProductReport {
  const output = report as ReportWithReliability;
  if (request.purchaseContext) {
    output.purchaseContextApplied = normalizePurchaseContextApplied(request.purchaseContext);
  } else {
    delete output.purchaseContextApplied;
  }

  const issues = validateProductReport(report, request);
  output.validationWarnings = issues;
  const blockers = issues.filter((entry) => entry.severity === 'blocker');
  if (blockers.length && report.decision === 'BUY') {
    report.decision = 'INSUFFICIENT';
    report.confidence = Math.min(report.confidence, 0.49);
    report.summary = '구매 결론을 내리기 전에 핵심 상품·가격 조건의 추가 검증이 필요합니다.';
    const reason = '서버 신뢰성 검증에서 구매 결론을 차단하는 항목이 확인되었습니다.';
    if (!report.reasons.includes(reason)) report.reasons.push(reason);
    const missing = `추가 검증 필요: ${blockers.map((entry) => entry.message).join(' ')}`;
    if (!report.missingInformation.includes(missing)) report.missingInformation.push(missing);
  }
  return report;
}
