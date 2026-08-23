import type { ResearchJob } from '../core/types.ts';
import { applyPersonalizedRelayResult } from '../relay/merge.ts';
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

const LAST_SEEN_KEY = 'relay:last-seen';
const PENDING_KEY = 'relay:pending';
const JOB_PREFIX = 'research:job:';
const DEFAULT_ONLINE_TTL_MS = 15_000;
const DEFAULT_CLAIM_TTL_MS = 30_000;
const DEFAULT_RELAY_TIMEOUT_MS = 30_000;

function researchJobKey(id: string): string {
  return `${JOB_PREFIX}${id}`;
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
): Promise<{ online: boolean; lastSeenAt: number | null }> {
  const record = await store.getJSON<LastSeenRecord>(LAST_SEEN_KEY);
  const lastSeenAt = typeof record?.at === 'number' && Number.isFinite(record.at) ? record.at : null;
  return {
    online: lastSeenAt !== null && nowMs - lastSeenAt <= onlineTtlMs,
    lastSeenAt,
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
  const existing = await store.getJSON<PendingRelayRecord>(PENDING_KEY);
  if (existing && !isExpired(existing.job, nowMs)) throw new Error('Persistent relay is busy with another active job');
  if (existing) await store.delete(PENDING_KEY);

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
  await store.setJSON(PENDING_KEY, { researchJobId, job } satisfies PendingRelayRecord);
  return job;
}

export async function pollPersistentRelay(
  store: JsonKeyValueStore,
  nowMs = Date.now(),
  claimTtlMs = DEFAULT_CLAIM_TTL_MS,
): Promise<SignedRelayJob | null> {
  await markPersistentConnectorSeen(store, nowMs);
  const pending = await store.getJSON<PendingRelayRecord>(PENDING_KEY);
  if (!pending) return null;
  if (isExpired(pending.job, nowMs)) {
    await store.delete(PENDING_KEY);
    return null;
  }
  if (typeof pending.claimedAt === 'number' && nowMs - pending.claimedAt < claimTtlMs) return null;
  const claimed: PendingRelayRecord = { ...pending, claimedAt: nowMs };
  await store.setJSON(PENDING_KEY, claimed);
  return pending.job;
}

export async function completePersistentRelay(
  store: JsonKeyValueStore,
  relayJobId: string,
  rawResult: unknown,
  completedAt = new Date().toISOString(),
): Promise<ResearchJob> {
  const pending = await store.getJSON<PendingRelayRecord>(PENDING_KEY);
  if (!pending || pending.job.id !== relayJobId) throw new Error('Pending relay job not found');
  const researchJob = await getStoredResearchJob(store, pending.researchJobId);
  if (!researchJob) throw new Error('Stored research job not found');
  const merged = applyPersonalizedRelayResult(researchJob, rawResult, completedAt);
  await saveResearchJob(store, merged);
  await store.delete(PENDING_KEY);
  return merged;
}

export async function failPersistentRelay(
  store: JsonKeyValueStore,
  relayJobId: string,
  message: string,
  completedAt = new Date().toISOString(),
): Promise<ResearchJob> {
  const pending = await store.getJSON<PendingRelayRecord>(PENDING_KEY);
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
  await store.delete(PENDING_KEY);
  return failed;
}
