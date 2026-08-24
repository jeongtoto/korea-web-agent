export type FailureClass =
  | 'transient_network'
  | 'server_5xx'
  | 'rate_limit'
  | 'spa_not_ready'
  | 'parse_error'
  | 'relay_offline'
  | 'auth_required'
  | 'captcha'
  | 'sku_mismatch'
  | 'bad_request'
  | 'policy_block'
  | 'unknown';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export function classifyFailure(error: unknown): FailureClass {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/captcha|보안문자/i.test(text)) return 'captcha';
  if (/sku\s*mismatch|variant\s*mismatch|model\s*mismatch/i.test(text)) return 'sku_mismatch';
  if (/\b(?:401|403)\b|login required|auth(?:entication)? required/i.test(text)) return 'auth_required';
  if (/policy|blocked domain|not allowlisted|ssrf/i.test(text)) return 'policy_block';
  if (/\b400\b|bad request|invalid request/i.test(text)) return 'bad_request';
  if (/\b429\b|too many requests|rate.?limit/i.test(text)) return 'rate_limit';
  if (/\b5\d\d\b|service unavailable|bad gateway|gateway timeout/i.test(text)) return 'server_5xx';
  if (/relay.*offline|connector.*offline/i.test(text)) return 'relay_offline';
  if (/spa.*not ready|content.*not ready|selector.*not found.*yet/i.test(text)) return 'spa_not_ready';
  if (/parse|unexpected token|invalid html|malformed/i.test(text)) return 'parse_error';
  if (/etimedout|econnreset|enotfound|network|fetch failed|socket hang up/i.test(text)) return 'transient_network';
  return 'unknown';
}

export function retryPolicyFor(failure: FailureClass): RetryPolicy {
  switch (failure) {
    case 'transient_network':
    case 'server_5xx':
    case 'spa_not_ready':
      return { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 1_500 };
    case 'rate_limit':
      return { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 5_000 };
    case 'parse_error':
      return { maxAttempts: 2, baseDelayMs: 150, maxDelayMs: 500 };
    case 'unknown':
      return { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };
    default:
      return { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };
  }
}

export interface WithRetryOptions {
  sleep?: (ms: number) => Promise<void>;
  classify?: (error: unknown) => FailureClass;
}

export async function withRetry<T>(operation: () => Promise<T>, options: WithRetryOptions = {}): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const classify = options.classify ?? classifyFailure;
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      const policy = retryPolicyFor(classify(error));
      if (attempt >= policy.maxAttempts) throw error;
      const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
      if (delay > 0) await sleep(delay);
    }
  }
}
