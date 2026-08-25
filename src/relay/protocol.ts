import { canonicalIdentityKey } from '../core/canonical-identity.ts';
import { assertPublicUrl, isRelayDomainAllowed } from '../core/policy.ts';
import type { CanonicalProductIdentity, NormalizedTarget } from '../core/types.ts';

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
  'commerceOffer',
  'liveDeal',
] as const;

export type RelayReadOnlyField = (typeof RELAY_READ_ONLY_FIELDS)[number];

const RELAY_BASE_PRODUCT_HINT_FIELDS = [
  'brand',
  'name',
  'model',
  'variant',
  'productId',
  'liveId',
] as const;

export const RELAY_PRODUCT_HINT_FIELDS = [
  ...RELAY_BASE_PRODUCT_HINT_FIELDS,
  'canonicalKey',
  'requiredComponents',
] as const;

export type RelayProductHintField = (typeof RELAY_PRODUCT_HINT_FIELDS)[number];
export type RelayBaseProductHintField = (typeof RELAY_BASE_PRODUCT_HINT_FIELDS)[number];

export interface RelayRequiredComponentHint {
  model?: string;
  version?: string;
}

export interface RelayProductHint {
  brand?: string;
  name?: string;
  model?: string;
  variant?: string;
  productId?: string;
  liveId?: string;
  canonicalKey?: string;
  requiredComponents?: RelayRequiredComponentHint[];
}

export interface RelayTarget {
  url: string;
  market: string;
  targetHint?: RelayProductHint;
}

const RELAY_PRODUCT_HINT_LIMITS: Record<RelayBaseProductHintField, number> = {
  brand: 200,
  name: 500,
  model: 200,
  variant: 200,
  productId: 200,
  liveId: 200,
};
const RELAY_CANONICAL_KEY_LIMIT = 800;
const RELAY_COMPONENT_LIMIT = 8;
const RELAY_COMPONENT_FIELD_LIMIT = 200;

export function toRelayProductHint(
  target: NormalizedTarget | undefined,
  canonicalIdentity?: CanonicalProductIdentity,
): RelayProductHint | undefined {
  if (!target && !canonicalIdentity) return undefined;
  const hint: RelayProductHint = {};
  if (target) {
    for (const field of RELAY_BASE_PRODUCT_HINT_FIELDS) {
      const value = target[field];
      if (typeof value !== 'string') continue;
      const normalized = value.trim();
      if (normalized) hint[field] = normalized.slice(0, RELAY_PRODUCT_HINT_LIMITS[field]);
    }
  }
  const key = canonicalIdentity ? canonicalIdentityKey(canonicalIdentity) : undefined;
  if (key) hint.canonicalKey = key.slice(0, RELAY_CANONICAL_KEY_LIMIT);
  const requiredComponents = canonicalIdentity?.requiredComponents.flatMap(({ model, version }) => {
    const normalizedModel = model?.trim();
    const normalizedVersion = version?.trim();
    if (!normalizedModel && !normalizedVersion) return [];
    return [{
      ...(normalizedModel ? { model: normalizedModel.slice(0, RELAY_COMPONENT_FIELD_LIMIT) } : {}),
      ...(normalizedVersion ? { version: normalizedVersion.slice(0, RELAY_COMPONENT_FIELD_LIMIT) } : {}),
    }];
  }).slice(0, RELAY_COMPONENT_LIMIT);
  if (requiredComponents?.length) hint.requiredComponents = requiredComponents;
  return Object.keys(hint).length ? hint : undefined;
}

export interface UnsignedRelayJob {
  id: string;
  url: string;
  requestedFields: RelayReadOnlyField[];
  targetHint?: RelayProductHint;
  targets?: RelayTarget[];
  issuedAt: string;
  expiresAt: string;
  nonce: string;
}

function validateRequiredComponents(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > RELAY_COMPONENT_LIMIT) {
    throw new Error('Relay targetHint requiredComponents must contain one to eight entries');
  }
  for (const component of value) {
    if (!component || typeof component !== 'object' || Array.isArray(component)) {
      throw new Error('Relay targetHint required component is invalid');
    }
    const object = component as Record<string, unknown>;
    const keys = Object.keys(object);
    if (!keys.length || keys.some((key) => key !== 'model' && key !== 'version')) {
      throw new Error('Relay targetHint required component fields are unsupported');
    }
    let populated = false;
    for (const key of ['model', 'version'] as const) {
      const fieldValue = object[key];
      if (fieldValue === undefined) continue;
      if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
        throw new Error(`Relay targetHint required component field must be a non-empty string: ${key}`);
      }
      if (fieldValue.length > RELAY_COMPONENT_FIELD_LIMIT) {
        throw new Error(`Relay targetHint required component field is too long: ${key}`);
      }
      populated = true;
    }
    if (!populated) throw new Error('Relay targetHint required component must contain model or version');
  }
}

function validateTargetHint(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Relay targetHint must be a non-empty object');
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (!keys.length) throw new Error('Relay targetHint must be a non-empty object');
  const allowed = new Set<string>(RELAY_PRODUCT_HINT_FIELDS);
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`Relay targetHint field is unsupported: ${key}`);
    if (key === 'requiredComponents') {
      validateRequiredComponents(object[key]);
      continue;
    }
    const fieldValue = object[key];
    if (typeof fieldValue !== 'string' || !fieldValue.trim()) {
      throw new Error(`Relay targetHint field must be a non-empty string: ${key}`);
    }
    const limit = key === 'canonicalKey'
      ? RELAY_CANONICAL_KEY_LIMIT
      : RELAY_PRODUCT_HINT_LIMITS[key as RelayBaseProductHintField];
    if (fieldValue.length > limit) {
      throw new Error(`Relay targetHint field is too long: ${key}`);
    }
  }
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

  if (job.targets !== undefined) {
    if (!Array.isArray(job.targets) || job.targets.length === 0 || job.targets.length > 8) throw new Error('Relay targets must contain one to eight entries');
    const seen = new Set<string>();
    for (const target of job.targets) {
      if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error('Relay target is invalid');
      const targetUrl = assertPublicUrl(target.url);
      if (!isRelayDomainAllowed(targetUrl.hostname)) throw new Error('Relay target domain is not allowlisted');
      if (seen.has(targetUrl.toString())) throw new Error('Relay targets must be unique');
      seen.add(targetUrl.toString());
      if (typeof target.market !== 'string' || !target.market.trim() || target.market.length > 100) throw new Error('Relay target market is invalid');
      if (target.targetHint !== undefined) validateTargetHint(target.targetHint);
    }
  }

  const allowed = new Set<string>(RELAY_READ_ONLY_FIELDS);
  if (!Array.isArray(job.requestedFields) || job.requestedFields.length === 0) throw new Error('At least one read-only field is required');
  for (const field of job.requestedFields as string[]) {
    if (!allowed.has(field)) throw new Error(`Relay field is not read-only or unsupported: ${field}`);
  }
  if (job.targetHint !== undefined) validateTargetHint(job.targetHint);
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
