export type PixelPolicy = 'standard' | 'zero_defect';

export interface MaterialVariantFields {
  generation?: string;
  color?: string;
  pixelPolicy?: PixelPolicy;
  refreshRateHz?: number;
}

const GENERATION_RE = /\b(EVO|PRO|PLUS|MAX|ULTRA|NEO|SE|MK\d+|GEN\d+)\b/i;
const REFRESH_RATE_RE = /\b(\d{2,3})\s*HZ\b/gi;

function generationNearModel(text: string, model?: string): string | undefined {
  if (!model) return undefined;
  const upper = text.toUpperCase();
  const index = upper.indexOf(model.toUpperCase());
  if (index < 0) return undefined;
  const window = text.slice(index, index + model.length + 40);
  return window.match(GENERATION_RE)?.[1]?.toUpperCase();
}

function uniqueColor(text: string): string | undefined {
  const matches = new Set<string>();
  const colors: Array<[RegExp, string]> = [
    [/(?:화이트|\bWHITE\b)/i, 'white'],
    [/(?:블랙|\bBLACK\b)/i, 'black'],
    [/(?:실버|\bSILVER\b)/i, 'silver'],
    [/(?:그레이|\bGR(?:A|E)Y\b)/i, 'gray'],
    [/(?:베이지|\bBEIGE\b)/i, 'beige'],
  ];
  for (const [pattern, normalized] of colors) {
    if (pattern.test(text)) matches.add(normalized);
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}

function monitorLike(text: string): boolean {
  return /(모니터|\b(?:FHD|QHD|WQHD|UHD|IPS|VA|OLED)\b|\d{2,3}\s*HZ\b)/i.test(text);
}

function pixelPolicy(text: string): PixelPolicy | undefined {
  if (!monitorLike(text)) return undefined;
  const zeroDefect = /무결점|ZERO[- ]?DEFECT|PIXEL[- ]?PERFECT/i.test(text);
  const standard = /(?:^|[\s/()[\],·-])일반(?:$|[\s/()[\],·-])/i.test(text);
  if (zeroDefect === standard) return undefined;
  return zeroDefect ? 'zero_defect' : 'standard';
}

function refreshRateHz(text: string): number | undefined {
  const values = new Set<number>();
  for (const match of text.matchAll(REFRESH_RATE_RE)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 30 && value <= 1000) values.add(value);
  }
  return values.size === 1 ? [...values][0] : undefined;
}

export function extractMaterialVariant(text: string, model?: string): MaterialVariantFields {
  const generation = generationNearModel(text, model);
  const color = uniqueColor(text);
  const policy = pixelPolicy(text);
  const refresh = refreshRateHz(text);
  return {
    ...(generation ? { generation } : {}),
    ...(color ? { color } : {}),
    ...(policy ? { pixelPolicy: policy } : {}),
    ...(refresh !== undefined ? { refreshRateHz: refresh } : {}),
  };
}
