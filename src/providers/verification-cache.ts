import { canonicalizeSellerUrl } from './offer-dedupe.ts';

export interface VerificationCache<T> {
  getOrLoad(url: string, loader: () => Promise<T>): Promise<T>;
  clear(): void;
}

export function createVerificationCache<T>(): VerificationCache<T> {
  const inFlight = new Map<string, Promise<T>>();

  return {
    getOrLoad(url, loader) {
      const key = canonicalizeSellerUrl(url);
      const existing = inFlight.get(key);
      if (existing) return existing;

      const pending = Promise.resolve().then(loader);
      inFlight.set(key, pending);
      pending.catch(() => {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      });
      return pending;
    },
    clear() {
      inFlight.clear();
    },
  };
}
