import { assertPublicUrl, isRelayDomainAllowed } from '../core/policy.ts';

export const RELAY_READ_ONLY_FIELDS = [
  'title',
  'price',
  'couponPrice',
  'membershipPrice',
  'estimatedPoints',
  'shippingFee',
  'shippingEta',
  'selectedOption',
  'availability',
] as const;

export type RelayReadOnlyField = (typeof RELAY_READ_ONLY_FIELDS)[number];

export interface UnsignedRelayJob {
  id: string;
  url: string;
  requestedFields: RelayReadOnlyField[];
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

export interface SignedRelayJob extends UnsignedRelayJob {
  signature: string;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite values are not allowed in relay payloads');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  throw new Error('Relay payload contains a non-JSON value');
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 16) throw new Error('Relay secret is too short');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function validateRelayRequest(job: UnsignedRelayJob, nowMs = Date.now()): void {
  if (!job.id.trim()) throw new Error('Relay job id is required');
  if (!job.nonce.trim() || job.nonce.length < 8) throw new Error('Relay nonce is required');

  const issuedAt = Date.parse(job.issuedAt);
  const expiresAt = Date.parse(job.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) throw new Error('Relay timestamps are invalid');
  if (expiresAt <= nowMs) throw new Error('Relay job is expired');
  if (issuedAt > nowMs + 60_000) throw new Error('Relay job issuedAt is in the future');
  if (expiresAt - issuedAt > 10 * 60_000) throw new Error('Relay job lifetime is too long');

  const url = assertPublicUrl(job.url);
  if (!isRelayDomainAllowed(url.hostname)) throw new Error('Relay domain is not allowlisted');

  const allowed = new Set<string>(RELAY_READ_ONLY_FIELDS);
  if (!Array.isArray(job.requestedFields) || job.requestedFields.length === 0) throw new Error('At least one read-only field is required');
  for (const field of job.requestedFields as string[]) {
    if (!allowed.has(field)) throw new Error(`Relay field is not read-only or unsupported: ${field}`);
  }
}

export async function signRelayJob(job: UnsignedRelayJob, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonicalize(job)));
  return bytesToHex(signature);
}

export async function verifyRelayJob(job: SignedRelayJob, secret: string, nowMs = Date.now()): Promise<boolean> {
  try {
    validateRelayRequest(job, nowMs);
    const signature = hexToBytes(job.signature);
    if (!signature) return false;
    const { signature: _signature, ...unsigned } = job;
    const key = await importHmacKey(secret);
    return crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(canonicalize(unsigned)));
  } catch {
    return false;
  }
}

const SECRET_KEY_PATTERN = /(?:^|[_-])(cookie|cookies|token|tokens|password|passwd|localstorage|session|authorization|set[_-]?cookie)(?:$|[_-])/i;

function sanitizeValue(value: unknown, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-JSON number at ${path}`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => sanitizeValue(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(`_${key}_`) || /cookie|token|password|localstorage|session|authorization/i.test(key)) {
        throw new Error(`Secret-bearing relay key is forbidden: ${key}`);
      }
      if (nested === undefined) continue;
      output[key] = sanitizeValue(nested, `${path}.${key}`);
    }
    return output;
  }
  throw new Error(`Non-JSON relay value at ${path}`);
}

export function sanitizeRelayResult<T = unknown>(value: T): T {
  return sanitizeValue(value, '$') as T;
}
