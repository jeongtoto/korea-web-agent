import { semanticProviderFailureKind } from './retry.ts';
import type {
  MarketCoverage,
  ProviderAttempt,
  ProviderFailureKind,
} from './types.ts';

export function providerFailureKind(error: unknown): ProviderFailureKind {
  return semanticProviderFailureKind(error);
}

function derivedStatus(attempt: ProviderAttempt): MarketCoverage['status'] {
  if (!attempt.discovery.attempted) return 'not_attempted';
  if (attempt.failureKind && (attempt.verification.failed > 0 || attempt.status === 'failed')) return 'failed';
  if (attempt.verification.succeeded > 0 && attempt.offers.eligible > 0) return 'verified';
  if (attempt.identity.exact + attempt.identity.uncertain > 0 || attempt.offers.extracted > 0) return 'found_unverified';
  return 'no_match';
}

export function deriveMarketCoverage(attempts: ProviderAttempt[]): MarketCoverage[] {
  return attempts.map((attempt) => {
    const found = attempt.identity.exact + attempt.identity.uncertain;
    const verified = Math.min(attempt.offers.eligible, attempt.verification.succeeded);
    const status = derivedStatus(attempt);
    const coverage: MarketCoverage = {
      market: attempt.market,
      attempted: attempt.discovery.attempted,
      found,
      verified,
      status,
    };
    if (status === 'failed' && attempt.failureKind) {
      coverage.message = attempt.failureMessage
        ? `${attempt.failureKind}: ${attempt.failureMessage}`
        : attempt.failureKind;
    }
    return coverage;
  });
}
