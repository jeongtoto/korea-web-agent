import type { AgentResearchInput, AgentResearchResult } from '../agent/research.ts';
import type { ResearchJobStatus } from '../core/types.ts';
import type { JsonKeyValueStore } from './relay-state.ts';

const STATE_PREFIX = 'research:agent-state:';
const INPUT_PREFIX = 'research:agent-input:';
const RESULT_PREFIX = 'research:agent-result:';

export interface AgentResearchJobState {
  jobId: string;
  status: ResearchJobStatus;
  createdAt: string;
  updatedAt: string;
  pollUrl: string;
  error?: string;
}

export interface CreateQueuedAgentOptions {
  id?: string;
  nowMs?: number;
}

function stateKey(id: string): string { return `${STATE_PREFIX}${id}`; }
function inputKey(id: string): string { return `${INPUT_PREFIX}${id}`; }
function resultKey(id: string): string { return `${RESULT_PREFIX}${id}`; }
function pollUrl(id: string): string { return `/api/agent/job?jobId=${encodeURIComponent(id)}`; }
function iso(nowMs: number): string { return new Date(nowMs).toISOString(); }

function boundedId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed || trimmed.length > 200 || !/^[A-Za-z0-9._-]+$/.test(trimmed)) throw new Error('jobId is invalid');
  return trimmed;
}

export async function createQueuedAgentResearch(
  store: JsonKeyValueStore,
  input: AgentResearchInput,
  options: CreateQueuedAgentOptions = {},
): Promise<AgentResearchJobState> {
  const jobId = boundedId(options.id ?? `agent-${crypto.randomUUID()}`);
  const nowMs = options.nowMs ?? Date.now();
  const at = iso(nowMs);
  const state: AgentResearchJobState = {
    jobId,
    status: 'queued',
    createdAt: at,
    updatedAt: at,
    pollUrl: pollUrl(jobId),
  };
  await store.setJSON(inputKey(jobId), input);
  await store.setJSON(stateKey(jobId), state);
  return state;
}

export async function getAgentResearchJobState(
  store: JsonKeyValueStore,
  jobId: string,
): Promise<AgentResearchJobState | null> {
  return store.getJSON<AgentResearchJobState>(stateKey(boundedId(jobId)));
}

export async function claimQueuedAgentResearch(
  store: JsonKeyValueStore,
  jobId: string,
  nowMs = Date.now(),
): Promise<AgentResearchInput | null> {
  const id = boundedId(jobId);
  const state = await store.getJSON<AgentResearchJobState>(stateKey(id));
  const input = await store.getJSON<AgentResearchInput>(inputKey(id));
  if (!state || !input) return null;
  if (!['queued', 'running'].includes(state.status)) return null;
  const running: AgentResearchJobState = {
    ...state,
    status: 'running',
    updatedAt: iso(nowMs),
  };
  delete running.error;
  await store.setJSON(stateKey(id), running);
  return input;
}

export async function releaseAgentResearchInput(
  store: JsonKeyValueStore,
  jobId: string,
): Promise<void> {
  await store.delete(inputKey(boundedId(jobId)));
}

export async function finishAgentResearchJob(
  store: JsonKeyValueStore,
  jobId: string,
  result: AgentResearchResult,
  nowMs = Date.now(),
): Promise<AgentResearchJobState> {
  const id = boundedId(jobId);
  const existing = await store.getJSON<AgentResearchJobState>(stateKey(id));
  if (!existing) throw new Error('Agent research job not found');
  const terminalStatus: ResearchJobStatus = ['completed', 'partial', 'failed'].includes(result.status)
    ? result.status
    : 'completed';
  const state: AgentResearchJobState = {
    ...existing,
    status: terminalStatus,
    updatedAt: iso(nowMs),
  };
  delete state.error;
  await store.setJSON(resultKey(id), { ...result, jobId: id, status: terminalStatus });
  await store.setJSON(stateKey(id), state);
  await releaseAgentResearchInput(store, id);
  return state;
}

export async function failAgentResearchJob(
  store: JsonKeyValueStore,
  jobId: string,
  error: string,
  nowMs = Date.now(),
): Promise<AgentResearchJobState> {
  const id = boundedId(jobId);
  const existing = await store.getJSON<AgentResearchJobState>(stateKey(id));
  if (!existing) throw new Error('Agent research job not found');
  const state: AgentResearchJobState = {
    ...existing,
    status: 'failed',
    updatedAt: iso(nowMs),
    error: error.slice(0, 500),
  };
  await store.setJSON(stateKey(id), state);
  await releaseAgentResearchInput(store, id);
  return state;
}

export async function getAgentResearchResult(
  store: JsonKeyValueStore,
  jobId: string,
): Promise<AgentResearchResult | null> {
  return store.getJSON<AgentResearchResult>(resultKey(boundedId(jobId)));
}
