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
  if (attempt.verification.succeeded > 0 && attempt.offers.eligible > 0) return 'verified';
  if (attempt.failureKind && (attempt.verification.failed > 0 || attempt.status === 'failed')) return 'failed';
  if (attempt.identity.exact + attempt.identity.uncertain > 0 || attempt.offers.extracted > 0) return 'found_unverified';
  return 'no_match';
}

export function deriveMarketCoverage(attempts: ProviderAttempt[]): MarketCoverage[] {
  return attempts.map((attempt) => {
    const found = attempt.identity.exact + attempt.identity.uncertain;
    const verified = Math.min(attempt.offers.eligible, attempt.verification.succeeded);
    const status = derivedStatus(attempt);
    const coverage: MarketCoverage = {
      ...(attempt.providerId ? { providerId: attempt.providerId } : {}),
      market: attempt.market,
      attempted: attempt.discovery.attempted,
      found,
      verified,
      status,
      ...(attempt.comparisonPages !== undefined ? { comparisonPages: attempt.comparisonPages } : {}),
      ...(attempt.expandedSellers !== undefined ? { expandedSellers: attempt.expandedSellers } : {}),
      ...(attempt.exactOffers !== undefined ? { exactOffers: attempt.exactOffers } : {}),
      ...(attempt.eligibleSellers !== undefined ? { eligibleSellers: attempt.eligibleSellers } : {}),
      ...(attempt.failureKind ? { failureKind: attempt.failureKind } : {}),
    };
    if (status === 'failed' && attempt.failureKind) {
      coverage.message = attempt.failureMessage
        ? `${attempt.failureKind}: ${attempt.failureMessage}`
        : attempt.failureKind;
    }
    return coverage;
  });
}
