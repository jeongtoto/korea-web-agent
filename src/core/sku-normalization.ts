import type { NormalizedTarget } from './types.ts';

function nfkc(value: string | undefined): string {
  return (value ?? '').normalize('NFKC').trim();
}

export function extractVersionTokens(value?: string): string[] {
  const text = nfkc(value).toUpperCase();
  return [...new Set([...text.matchAll(/\bV\s*[-_.]?\s*(\d+[A-Z0-9-]*)\b/g)].map((match) => `V${match[1]}`))];
}

export function normalizeModelCode(value?: string): string {
  return nfkc(value)
    .toUpperCase()
    .replace(/\bV\s*[-_.]?\s*(\d+[A-Z0-9-]*)\b/g, 'V$1')
    .replace(/[^0-9A-Z가-힣]+/g, '')
    .trim();
}

export function normalizeVariant(value?: string): string {
  return nfkc(value)
    .replace(/(\d+)\s*(?:inch|인치|형)\b/gi, '$1인치')
    .replace(/\(?\s*[vV]\s*[-_.]?\s*(\d+[A-Za-z0-9-]*)\s*\)?/g, ' V$1')
    .replace(/[_/,+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/(\d+)인치/g, '$1인치');
}

function modelLikeTokens(value?: string): string[] {
  const text = nfkc(value).toUpperCase();
  const raw = text.match(/[A-Z]{2,}[A-Z0-9]*(?:[-_ /]?[A-Z0-9]+)*\d[A-Z0-9-]*/g) ?? [];
  return raw
    .map((token) => normalizeModelCode(token))
    .filter((token) => token.length >= 4 && !/^V\d/.test(token) && !/^\d+/.test(token));
}

function sizeTokens(value?: string): string[] {
  return [...new Set([...nfkc(value).matchAll(/(\d+)\s*(?:inch|인치|형)\b/gi)].map((match) => `${match[1]}인치`))];
}

export function skuFingerprint(target: NormalizedTarget): string {
  const whole = [target.brand, target.model, target.variant, target.name].filter(Boolean).join(' ');
  const brand = normalizeModelCode(target.brand);
  const codes = [...new Set([
    ...(target.model ? [normalizeModelCode(target.model)] : []),
    ...modelLikeTokens(target.name),
  ].filter(Boolean))].sort();
  const versions = extractVersionTokens(whole).sort();
  const sizes = sizeTokens(whole).sort();
  return [brand, ...codes, ...versions, ...sizes].filter(Boolean).join('|');
}

export function sameNormalizedSku(a: NormalizedTarget, b: NormalizedTarget): boolean {
  const aVersions = extractVersionTokens([a.model, a.variant, a.name].filter(Boolean).join(' '));
  const bVersions = extractVersionTokens([b.model, b.variant, b.name].filter(Boolean).join(' '));
  if (aVersions.length && bVersions.length && !aVersions.some((version) => bVersions.includes(version))) return false;

  const aModel = normalizeModelCode(a.model);
  const bModel = normalizeModelCode(b.model);
  if (aModel && bModel && aModel !== bModel) return false;

  const aSizes = sizeTokens([a.variant, a.name].filter(Boolean).join(' '));
  const bSizes = sizeTokens([b.variant, b.name].filter(Boolean).join(' '));
  if (aSizes.length && bSizes.length && !aSizes.some((size) => bSizes.includes(size))) return false;

  return skuFingerprint(a) === skuFingerprint(b) || Boolean(aModel && bModel && aModel === bModel);
}
