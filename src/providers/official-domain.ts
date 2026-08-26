import type { NormalizedTarget } from '../core/types.ts';

function normalizedHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const host = value.includes('://') ? new URL(value).hostname : value;
    const normalized = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

function relatedHost(candidate: string, reference: string): boolean {
  return candidate === reference
    || candidate.endsWith(`.${reference}`)
    || reference.endsWith(`.${candidate}`);
}

export function resolvedOfficialHosts(target: NormalizedTarget): string[] {
  const values = [
    normalizedHost(target.sourceHost),
    normalizedHost(target.canonicalUrl),
  ].filter((value): value is string => Boolean(value));
  return [...new Set(values)];
}

export function isVerifiedOfficialDomain(url: string, target: NormalizedTarget): boolean {
  const candidate = normalizedHost(url);
  if (!candidate) return false;
  const references = resolvedOfficialHosts(target);
  if (!references.length) return false;
  return references.some((reference) => relatedHost(candidate, reference));
}
