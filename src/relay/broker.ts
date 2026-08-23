import type { PriceSnapshot } from '../core/types.ts';
import {
  sanitizeRelayResult,
  signRelayJob,
  type RelayProductHint,
  type RelayReadOnlyField,
  type SignedRelayJob,
  type UnsignedRelayJob,
} from './protocol.ts';

interface PendingRelayRequest {
  resolve: (value: PriceSnapshot) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RelayBrokerOptions {
  secret: string;
  now?: () => number;
  timeoutMs?: number;
  onlineTtlMs?: number;
  idFactory?: () => string;
}

const DEFAULT_FIELDS: RelayReadOnlyField[] = [
  'title',
  'price',
  'couponPrice',
  'membershipPrice',
  'estimatedPoints',
  'shippingFee',
  'shippingEta',
  'availability',
];

function constantTimeStringEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export class RelayBroker {
  #secret: string;
  #now: () => number;
  #timeoutMs: number;
  #onlineTtlMs: number;
  #idFactory: () => string;
  #lastSeenAt = 0;
  #queue: SignedRelayJob[] = [];
  #pending = new Map<string, PendingRelayRequest>();

  constructor(options: RelayBrokerOptions) {
    if (options.secret.length < 16) throw new Error('Relay secret must be at least 16 characters');
    this.#secret = options.secret;
    this.#now = options.now ?? (() => Date.now());
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#onlineTtlMs = options.onlineTtlMs ?? 12_000;
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
  }

  authorizeBearer(header: string | undefined): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    return constantTimeStringEqual(header.slice('Bearer '.length), this.#secret);
  }

  async isAvailable(): Promise<boolean> {
    return this.#lastSeenAt > 0 && this.#now() - this.#lastSeenAt <= this.#onlineTtlMs;
  }

  lastSeenAt(): number | null {
    return this.#lastSeenAt || null;
  }

  async poll(): Promise<SignedRelayJob | null> {
    this.#lastSeenAt = this.#now();
    while (this.#queue.length) {
      const job = this.#queue.shift();
      if (job && this.#pending.has(job.id)) return job;
    }
    return null;
  }

  async extract(url: string, targetHint?: RelayProductHint): Promise<PriceSnapshot> {
    const now = this.#now();
    const unsigned: UnsignedRelayJob = {
      id: this.#idFactory(),
      url,
      requestedFields: [...DEFAULT_FIELDS],
      ...(targetHint ? { targetHint } : {}),
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.min(this.#timeoutMs + 15_000, 10 * 60_000)).toISOString(),
      nonce: crypto.randomUUID(),
    };
    const signature = await signRelayJob(unsigned, this.#secret);
    const job: SignedRelayJob = { ...unsigned, signature };

    return new Promise<PriceSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(job.id);
        reject(new Error('Local relay timed out'));
      }, this.#timeoutMs);
      this.#pending.set(job.id, { resolve, reject, timer });
      this.#queue.push(job);
    });
  }

  submitResult(jobId: string, rawResult: unknown): boolean {
    const pending = this.#pending.get(jobId);
    if (!pending) return false;
    const result = sanitizeRelayResult(rawResult) as Record<string, unknown>;
    const price: PriceSnapshot = {
      currency: stringField(result.currency) ?? 'KRW',
    };
    const salePrice = numberField(result.price ?? result.salePrice);
    const couponPrice = numberField(result.couponPrice);
    const membershipPrice = numberField(result.membershipPrice);
    const estimatedPoints = numberField(result.estimatedPoints);
    const shippingFee = numberField(result.shippingFee);
    const shippingEta = stringField(result.shippingEta);
    if (salePrice !== undefined) price.salePrice = salePrice;
    if (couponPrice !== undefined) price.couponPrice = couponPrice;
    if (membershipPrice !== undefined) price.membershipPrice = membershipPrice;
    if (estimatedPoints !== undefined) price.estimatedPoints = estimatedPoints;
    if (shippingFee !== undefined) price.shippingFee = shippingFee;
    if (shippingEta) price.shippingEta = shippingEta;

    clearTimeout(pending.timer);
    this.#pending.delete(jobId);
    pending.resolve(price);
    return true;
  }

  submitError(jobId: string, message: string): boolean {
    const pending = this.#pending.get(jobId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.#pending.delete(jobId);
    pending.reject(new Error(`Local relay failed: ${message.slice(0, 500)}`));
    return true;
  }
}
