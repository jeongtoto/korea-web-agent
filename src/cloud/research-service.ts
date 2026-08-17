import type { ResearchJob, ResearchRequest } from '../core/types.ts';
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

export async function runCloudResearch(request: ResearchRequest, options: CloudResearchOptions): Promise<ResearchJob> {
  const nowMs = options.nowMs ?? (() => Date.now());
  const publicRequest: ResearchRequest = { ...request, includeLocalRelay: false };
  const publicJob = await options.publicResearch(publicRequest);
  let job: ResearchJob = {
    ...publicJob,
    request: { ...request },
  };

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
    await queuePersistentRelay(options.store, waiting.id, request.url!, options.relaySecret!, nowMs());
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
