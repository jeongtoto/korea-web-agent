import { retryPlanForFailure, type RetryFailureType } from './shopping-intelligence.ts';

export interface RetryExecutionOptions {
  sleep?: (ms: number) => Promise<void>;
}

export interface RetryExecutionResult<T> {
  value: T;
  attempts: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyFailure(error: unknown): RetryFailureType {
  const message = messageOf(error).toLowerCase();
  if (/captcha|manual_verification_required|보안문자|자동입력방지/.test(message)) return 'captcha';
  if (/\b401\b|\b403\b|unauthori[sz]ed|forbidden|authentication|login required|로그인 필요/.test(message)) return 'authentication';
  if (/\b429\b|too many requests|rate.?limit/.test(message)) return 'rate_limited';
  if (/etimedout|timed?\s*out|timeout|aborterror/.test(message)) return 'timeout';
  if (/econnreset|econnrefused|enotfound|eai_again|socket hang up|network|fetch failed/.test(message)) return 'network';
  if (/\b5\d\d\b|service unavailable|bad gateway|gateway timeout|internal server error/.test(message)) return 'server_error';
  if (/invalid[_ -]?sku|invalid model|잘못된 모델/.test(message)) return 'invalid_sku';
  if (/\b404\b|not found|찾을 수 없|검색 결과 없음/.test(message)) return 'not_found';
  if (/parse|unexpected token|invalid json|malformed/.test(message)) return 'parse_error';
  return 'unknown';
}

function delayMs(backoff: 'none' | 'linear' | 'exponential', failedAttempt: number): number {
  if (backoff === 'none') return 0;
  if (backoff === 'linear') return 150 * failedAttempt;
  return 150 * (2 ** Math.max(0, failedAttempt - 1));
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryExecutionOptions = {},
): Promise<RetryExecutionResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  let attempts = 0;

  while (true) {
    attempts += 1;
    try {
      return { value: await operation(), attempts };
    } catch (error) {
      const plan = retryPlanForFailure(classifyFailure(error));
      if (!plan.retryable || attempts >= plan.maxAttempts) throw error;
      const delay = delayMs(plan.backoff, attempts);
      if (delay > 0) await sleep(delay);
    }
  }
}
