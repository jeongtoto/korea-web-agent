import type { ResearchJob } from '../core/types.ts';
import { applyPersonalizedRelayResult } from '../relay/merge.ts';
import { enrichShoppingReport } from '../report/shopping-intelligence-report.ts';
import {
  RELAY_READ_ONLY_FIELDS,
  signRelayJob,
  type RelayProductHint,
  type RelayTarget,
  type SignedRelayJob,
  type UnsignedRelayJob,
} from '../relay/protocol.ts';

export interface JsonKeyValueStore {
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface LastSeenRecord { at: number }
interface PendingRelayRecord {
  researchJobId: string;
  job: SignedRelayJob;
  claimedAt?: number;
}
interface RelayQueueIndex { ids: string[] }

export type PersistentRelayState = 'never_seen' | 'online' | 'stale';
export interface PersistentRelayStatus {
  online: boolean;
  state: PersistentRelayState;
  lastSeenAt: number | null;
  heartbeatAgeMs: number | null;
  onlineTtlMs: number;
}

const LAST_SEEN_KEY = 'relay:last-seen';
const QUEUE_INDEX_KEY = 'relay:queue:index';
const PENDING_PREFIX = 'relay:pending:';
const JOB_PREFIX = 'research:job:';
const DEFAULT_ONLINE_TTL_MS = 15_000;
const DEFAULT_CLAIM_TTL_MS = 30_000;
const DEFAULT_RELAY_TIMEOUT_MS = 30_000;

function researchJobKey(id: string): string {
  return `${JOB_PREFIX}${id}`;
}

function pendingKey(relayJobId: string): string {
  return `${PENDING_PREFIX}${relayJobId}`;
}

async function getQueueIds(store: JsonKeyValueStore): Promise<string[]> {
  const index = await store.getJSON<RelayQueueIndex>(QUEUE_INDEX_KEY);
  return Array.isArray(index?.ids) ? [...new Set(index.ids.filter((id) => typeof id === 'string' && id.length > 0))] : [];
}

async function setQueueIds(store: JsonKeyValueStore, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) {
    await store.delete(QUEUE_INDEX_KEY);
    return;
  }
  await store.setJSON(QUEUE_INDEX_KEY, { ids: unique } satisfies RelayQueueIndex);
}

async function removeQueueItem(store: JsonKeyValueStore, relayJobId: string): Promise<void> {
  await store.delete(pendingKey(relayJobId));
  const ids = await getQueueIds(store);
  await setQueueIds(store, ids.filter((id) => id !== relayJobId));
}

function preservePublicShoppingContext(before: ResearchJob, after: ResearchJob, completedAt: string): ResearchJob {
  if (!before.report || !after.report) return after;
  const previous = before.report;
  const report = after.report;

  if (previous.priceHistory) report.priceHistory = previous.priceHistory;
  if (!report.offers && previous.offers) report.offers = previous.offers;
  if (!report.bestOffers && previous.bestOffers) report.bestOffers = previous.bestOffers;
  if (!report.marketCoverage && previous.marketCoverage) report.marketCoverage = previous.marketCoverage;
  if (!report.recommendations && previous.recommendations) report.recommendations = previous.recommendations;
  if (!report.manualChecks && previous.manualChecks) report.manualChecks = previous.manualChecks;

  enrichShoppingReport(report, completedAt);
  return after;
}

export async function saveResearchJob(store: JsonKeyValueStore, job: ResearchJob): Promise<void> {
  await store.setJSON(researchJobKey(job.id), job);
}

export async function getStoredResearchJob(store: JsonKeyValueStore, id: string): Promise<ResearchJob | null> {
  return store.getJSON<ResearchJob>(researchJobKey(id));
}

export async function markPersistentConnectorSeen(store: JsonKeyValueStore, nowMs = Date.now()): Promise<void> {
  await store.setJSON(LAST_SEEN_KEY, { at: nowMs } satisfies LastSeenRecord);
}

export async function getPersistentRelayStatus(
  store: JsonKeyValueStore,
  nowMs = Date.now(),
  onlineTtlMs = DEFAULT_ONLINE_TTL_MS,
): Promise<PersistentRelayStatus> {
  const record = await store.getJSON<LastSeenRecord>(LAST_SEEN_KEY);
  const lastSeenAt = typeof record?.at === 'number' && Number.isFinite(record.at) ? record.at : null;
  if (lastSeenAt === null) {
    return {
      online: false,
      state: 'never_seen',
      lastSeenAt: null,
      heartbeatAgeMs: null,
      onlineTtlMs,
    };
  }
  const heartbeatAgeMs = Math.max(0, nowMs - lastSeenAt);
  const online = heartbeatAgeMs <= onlineTtlMs;
  return {
    online,
    state: online ? 'online' : 'stale',
    lastSeenAt,
    heartbeatAgeMs,
    onlineTtlMs,
  };
}

function isExpired(job: SignedRelayJob, nowMs: number): boolean {
  const expiresAt = Date.parse(job.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

export async function queuePersistentRelay(
  store: JsonKeyValueStore,
  researchJobId: string,
  url: string,
  secret: string,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_RELAY_TIMEOUT_MS,
  targetHint?: RelayProductHint,
  targets?: RelayTarget[],
): Promise<SignedRelayJob> {
  const unsigned: UnsignedRelayJob = {
    id: crypto.randomUUID(),
    url,
    requestedFields: [...RELAY_READ_ONLY_FIELDS],
    ...(targetHint ? { targetHint } : {}),
    ...(targets?.length ? { targets: targets.slice(0, 8) } : {}),
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + Math.min(Math.max(1, timeoutMs), 10 * 60_000)).toISOString(),
    nonce: crypto.randomUUID(),
  };
  const signature = await signRelayJob(unsigned, secret);
  const job: SignedRelayJob = { ...unsigned, signature };
  await store.setJSON(pendingKey(job.id), { researchJobId, job } satisfies PendingRelayRecord);
  const ids = await getQueueIds(store);
  await setQueueIds(store, [...ids, job.id]);
  return job;
}

export async function pollPersistentRelay(
  store: JsonKeyValueStore,
  nowMs = Date.now(),
  claimTtlMs = DEFAULT_CLAIM_TTL_MS,
): Promise<SignedRelayJob | null> {
  await markPersistentConnectorSeen(store, nowMs);
  const ids = await getQueueIds(store);
  if (!ids.length) return null;

  const retained: string[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]!;
    const pending = await store.getJSON<PendingRelayRecord>(pendingKey(id));
    if (!pending) continue;
    if (isExpired(pending.job, nowMs)) {
      await store.delete(pendingKey(id));
      continue;
    }

    retained.push(id, ...ids.slice(index + 1));
    await setQueueIds(store, retained);
    if (typeof pending.claimedAt === 'number' && nowMs - pending.claimedAt < claimTtlMs) return null;

    const claimed: PendingRelayRecord = { ...pending, claimedAt: nowMs };
    await store.setJSON(pendingKey(id), claimed);
    return pending.job;
  }

  await setQueueIds(store, retained);
  return null;
}

export async function completePersistentRelay(
  store: JsonKeyValueStore,
  relayJobId: string,
  rawResult: unknown,
  completedAt = new Date().toISOString(),
): Promise<ResearchJob> {
  const pending = await store.getJSON<PendingRelayRecord>(pendingKey(relayJobId));
  if (!pending || pending.job.id !== relayJobId) throw new Error('Pending relay job not found');
  const researchJob = await getStoredResearchJob(store, pending.researchJobId);
  if (!researchJob) throw new Error('Stored research job not found');
  const merged = preservePublicShoppingContext(
    researchJob,
    applyPersonalizedRelayResult(researchJob, rawResult, completedAt),
    completedAt,
  );
  await saveResearchJob(store, merged);
  await removeQueueItem(store, relayJobId);
  return merged;
}

export async function failPersistentRelay(
  store: JsonKeyValueStore,
  relayJobId: string,
  message: string,
  completedAt = new Date().toISOString(),
): Promise<ResearchJob> {
  const pending = await store.getJSON<PendingRelayRecord>(pendingKey(relayJobId));
  if (!pending || pending.job.id !== relayJobId) throw new Error('Pending relay job not found');
  const researchJob = await getStoredResearchJob(store, pending.researchJobId);
  if (!researchJob) throw new Error('Stored research job not found');
  const publicStatus: ResearchJob['status'] = researchJob.evidence.length === 0
    ? (researchJob.errors.length ? 'failed' : 'completed')
    : (researchJob.errors.length ? 'partial' : 'completed');
  const safeMessage = message.slice(0, 500);
  const failed: ResearchJob = {
    ...researchJob,
    status: publicStatus,
    updatedAt: completedAt,
    completedAt,
    relay: {
      available: true,
      used: false,
      mode: 'public_only',
      message: `PC relay failed; public-only evidence was used. ${safeMessage}`,
    },
    errors: [...researchJob.errors, `local_relay: ${safeMessage}`],
  };
  if (/manual_verification_required|captcha|보안문자/i.test(message) && failed.report) {
    failed.report.manualChecks = [
      ...(failed.report.manualChecks ?? []),
      { type: 'captcha', message: '전용 브라우저에서 보안문자 또는 수동 확인을 완료한 뒤 다시 실행해야 합니다.', ...(failed.request.url ? { url: failed.request.url } : {}) },
    ];
  }
  await saveResearchJob(store, failed);
  await removeQueueItem(store, relayJobId);
  return failed;
}
