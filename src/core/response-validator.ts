import type { ProductReport, ResearchRequest } from './types.ts';

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

export function validateProductReport(
  _report: ProductReport,
  _request: ResearchRequest,
): ReliabilityIssue[] {
  return [];
}
