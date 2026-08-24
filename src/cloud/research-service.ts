import type { RelayCandidate, ResearchJob, ResearchRequest } from '../core/types.ts';
import { toRelayProductHint } from '../relay/protocol.ts';
import type { RelayTarget } from '../relay/protocol.ts';
import { assertPublicUrl, isRelayDomainAllowed } from '../core/policy.ts';
import { enrichShoppingReport } from '../report/shopping-intelligence-report.ts';
import { appendPriceObservation } from './price-history.ts';
import {
  getPersistentRelayStatus,
  queuePersistentRelay,
  saveResearchJob,
  type JsonKeyValueStore,
} from './relay-state.ts';

export interface CloudResearchOptions {
  store: JsonKeyValueStore;
  relaySecret?: string;
  nowMs?: () => number;
  publicResearch: (request: ResearchRequest) => Promise<ResearchJob>;
}

async function attachPublicShoppingIntelligence(
  job: ResearchJob,
  store: JsonKeyValueStore,
  nowMs: number,
): Promise<ResearchJob> {
  if (!job.report) return job;
  enrichShoppingReport(job.report, job.updatedAt);

  const cashWinner = job.report.bestOffers?.cash;
  const fallbackCash = job.report.price?.cashPaymentPrice;
  const cashPrice = cashWinner?.amount ?? fallbackCash;
  if (cashPrice !== undefined && Number.isFinite(cashPrice) && cashPrice > 0) {
    const observedAt = cashWinner?.offer.retrievedAt ?? job.updatedAt;
    const sourceUrl = cashWinner?.offer.url ?? job.report.price?.sourceUrl;
    const market = cashWinner?.offer.market;
    const history = await appendPriceObservation(store, job.target, {
      observedAt,
      cashPrice,
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(market ? { market } : {}),
    }, nowMs);
    if (history) job.report.priceHistory = history;
  }
  return job;
}

export async function runCloudResearch(request: ResearchRequest, options: CloudResearchOptions): Promise<ResearchJob> {
  const nowMs = options.nowMs ?? (() => Date.now());
  const publicRequest: ResearchRequest = { ...request, includeLocalRelay: false };
  const publicJob = await options.publicResearch(publicRequest);
  let job: ResearchJob = {
    ...publicJob,
    request: { ...request },
  };
  job = await attachPublicShoppingIntelligence(job, options.store, nowMs());

  const wantsRelay = Boolean(request.includeLocalRelay && request.url && options.relaySecret);
  if (!wantsRelay) {
    if (request.includeLocalRelay) {
      job = {
        ...job,
        relay: {
          available: false,
          used: false,
          mode: 'public_only',
          message: request.url
            ? 'PC relay is not configured; public-only evidence was used.'
            : 'A URL is required for personalized local-browser research.',
        },
      };
    }
    await saveResearchJob(options.store, job);
    return job;
  }

  const status = await getPersistentRelayStatus(options.store, nowMs());
  if (!status.online) {
    job = {
      ...job,
      relay: {
        available: false,
        used: false,
        mode: 'public_only',
        message: 'PC relay is offline; public-only evidence was used.',
      },
    };
    await saveResearchJob(options.store, job);
    return job;
  }

  const waitingAt = new Date(nowMs()).toISOString();
  const waiting: ResearchJob = {
    ...job,
    status: 'running',
    updatedAt: waitingAt,
    relay: {
      available: true,
      used: false,
      mode: 'public_only',
      message: 'Waiting for the authenticated PC browser to return personalized price and delivery fields.',
    },
  };
  delete waiting.completedAt;
  await saveResearchJob(options.store, waiting);

  try {
    const targetHint = toRelayProductHint(waiting.researchContext?.resolvedTarget ?? waiting.target);
    const discovered = (job.report?.offers ?? [])
      .filter((offer) => {
        try { return offer.eligible && isRelayDomainAllowed(assertPublicUrl(offer.url).hostname); } catch { return false; }
      })
      .sort((a, b) => Math.min(a.cardPrice ?? Infinity, a.paymentPrice ?? Infinity, a.totalCashPrice ?? Infinity, a.effectivePrice ?? Infinity)
        - Math.min(b.cardPrice ?? Infinity, b.paymentPrice ?? Infinity, b.totalCashPrice ?? Infinity, b.effectivePrice ?? Infinity))
      .map((offer) => ({ url: offer.url, market: offer.market }));
    const uniqueCandidates: RelayCandidate[] = [...(request.relayCandidates ?? []), ...discovered]
      .filter((candidate, index, values) => values.findIndex((value) => value.url === candidate.url) === index)
      .slice(0, 8);
    const targets: RelayTarget[] = uniqueCandidates.map((candidate) => {
      const hint = candidate.targetHint as import('../relay/protocol.ts').RelayProductHint | undefined ?? targetHint;
      return { url: candidate.url, market: candidate.market, ...(hint ? { targetHint: hint } : {}) };
    });
    await queuePersistentRelay(options.store, waiting.id, request.url!, options.relaySecret!, nowMs(), 5 * 60_000, targetHint, targets);
    return waiting;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback: ResearchJob = {
      ...job,
      relay: {
        available: true,
        used: false,
        mode: 'public_only',
        message: `PC relay is busy; public-only evidence was returned. ${message}`,
      },
    };
    await saveResearchJob(options.store, fallback);
    return fallback;
  }
}
