export type PriceDirection = 'up' | 'down' | 'unchanged' | 'insufficient';
export type PricePositionLabel = 'six_month_low' | 'below_average' | 'near_average' | 'above_average' | 'six_month_high' | 'insufficient';
export type RetryFailureType =
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'server_error'
  | 'authentication'
  | 'captcha'
  | 'invalid_sku'
  | 'not_found'
  | 'parse_error'
  | 'unknown';

export interface PriceObservation {
  observedAt: string;
  cashPrice: number;
}

export interface PriceComparison {
  direction: PriceDirection;
  previousPrice?: number;
  currentPrice?: number;
  absoluteChange?: number;
  percentageChange?: number;
}

export interface PricePosition {
  label: PricePositionLabel;
  current: number;
  minimum?: number;
  maximum?: number;
  average?: number;
  sampleCount: number;
}

export interface MembershipScenarioInput {
  cashPaymentPrice: number;
  basePoints?: number;
  membershipPoints?: number;
  membershipName?: string;
  membershipFee?: number;
}

export interface MembershipScenario {
  paymentPrice: number;
  expectedPoints: number;
  membershipFee: number;
  effectivePrice: number;
}

export interface MembershipScenarios {
  membershipName?: string | undefined;
  withoutMembership: MembershipScenario;
  withMembership: MembershipScenario;
}

export interface RetryPlan {
  retryable: boolean;
  maxAttempts: number;
  backoff: 'none' | 'linear' | 'exponential';
  requiresUserAction: boolean;
}

function finiteNonNegative(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.round(value ?? 0) : 0;
}

export function normalizeSku(value: string): string {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/V\s*[.]?\s*(\d+)/g, 'V$1')
    .replace(/\(\s*V(\d+)\s*\)/g, '(V$1)')
    .replace(/[‐‑‒–—−-]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9+()]/g, '');
}

function versionToken(value: string): string | undefined {
  return normalizeSku(value).match(/(?:\(|\b)(V\d+)(?:\)|\b|$)/)?.[1]
    ?? normalizeSku(value).match(/(V\d+)$/)?.[1];
}

function comparisonSku(value: string): string {
  return normalizeSku(value).replace(/\((V\d+)\)/g, '$1');
}

export function sameSku(left: string, right: string): boolean {
  const normalizedLeft = comparisonSku(left);
  const normalizedRight = comparisonSku(right);
  const leftVersion = versionToken(left);
  const rightVersion = versionToken(right);
  if (leftVersion && rightVersion && leftVersion !== rightVersion) return false;
  return normalizedLeft === normalizedRight;
}

export function buildMembershipScenarios(input: MembershipScenarioInput): MembershipScenarios {
  const paymentPrice = finiteNonNegative(input.cashPaymentPrice);
  const basePoints = finiteNonNegative(input.basePoints);
  const membershipPoints = finiteNonNegative(input.membershipPoints);
  const membershipFee = finiteNonNegative(input.membershipFee);
  return {
    membershipName: input.membershipName,
    withoutMembership: {
      paymentPrice,
      expectedPoints: basePoints,
      membershipFee: 0,
      effectivePrice: Math.max(0, paymentPrice - basePoints),
    },
    withMembership: {
      paymentPrice,
      expectedPoints: basePoints + membershipPoints,
      membershipFee,
      effectivePrice: Math.max(0, paymentPrice + membershipFee - basePoints - membershipPoints),
    },
  };
}

export function comparePriceSnapshots(observations: PriceObservation[]): PriceComparison {
  const valid = observations
    .filter((item) => Number.isFinite(item.cashPrice) && item.cashPrice > 0 && !Number.isNaN(Date.parse(item.observedAt)))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  if (valid.length < 2) return { direction: 'insufficient' };
  const previousPrice = valid.at(-2)!.cashPrice;
  const currentPrice = valid.at(-1)!.cashPrice;
  const absoluteChange = currentPrice - previousPrice;
  const percentageChange = Number(((absoluteChange / previousPrice) * 100).toFixed(2));
  return {
    direction: absoluteChange > 0 ? 'up' : absoluteChange < 0 ? 'down' : 'unchanged',
    previousPrice,
    currentPrice,
    absoluteChange,
    percentageChange,
  };
}

export function classifyPricePosition(current: number, historicalPrices: number[]): PricePosition {
  const prices = [current, ...historicalPrices].filter((value) => Number.isFinite(value) && value > 0);
  if (!Number.isFinite(current) || current <= 0 || prices.length < 2) {
    return { label: 'insufficient', current, sampleCount: prices.length };
  }
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const average = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  const averageGap = (current - average) / average;
  let label: PricePositionLabel;
  if (current === minimum) label = 'six_month_low';
  else if (current === maximum) label = 'six_month_high';
  else if (averageGap <= -0.05) label = 'below_average';
  else if (averageGap >= 0.05) label = 'above_average';
  else label = 'near_average';
  return {
    label,
    current,
    minimum,
    maximum,
    average: Math.round(average),
    sampleCount: prices.length,
  };
}

const RETRY_PLANS: Record<RetryFailureType, RetryPlan> = {
  timeout: { retryable: true, maxAttempts: 3, backoff: 'exponential', requiresUserAction: false },
  network: { retryable: true, maxAttempts: 3, backoff: 'exponential', requiresUserAction: false },
  rate_limited: { retryable: true, maxAttempts: 3, backoff: 'exponential', requiresUserAction: false },
  server_error: { retryable: true, maxAttempts: 2, backoff: 'linear', requiresUserAction: false },
  authentication: { retryable: false, maxAttempts: 1, backoff: 'none', requiresUserAction: true },
  captcha: { retryable: false, maxAttempts: 1, backoff: 'none', requiresUserAction: true },
  invalid_sku: { retryable: false, maxAttempts: 1, backoff: 'none', requiresUserAction: false },
  not_found: { retryable: false, maxAttempts: 1, backoff: 'none', requiresUserAction: false },
  parse_error: { retryable: true, maxAttempts: 2, backoff: 'linear', requiresUserAction: false },
  unknown: { retryable: true, maxAttempts: 2, backoff: 'linear', requiresUserAction: false },
};

export function retryPlanForFailure(type: RetryFailureType): RetryPlan {
  return { ...RETRY_PLANS[type] };
}

const SENSITIVE_KEYS = /(?:authorization|token|secret|cookie|ownedcards|memberships|budget|cardname|paymentmethod|email|phone)/i;

export function redactSensitiveLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) return value.map((item) => redactSensitiveLogValue(item, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
    key,
    SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redactSensitiveLogValue(nested, seen),
  ]));
}
