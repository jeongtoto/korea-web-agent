export type PixelPolicy = 'standard' | 'zero_defect';

export interface MaterialVariantFields {
  generation?: string;
  color?: string;
  pixelPolicy?: PixelPolicy;
  refreshRateHz?: number;
}

const GENERATION_RE = /\b(EVO|PRO|PLUS|MAX|ULTRA|NEO|SE|MK\d+|GEN\d+)\b/i;
const GENERATION_ALL_RE = /\b(EVO|PRO|PLUS|MAX|ULTRA|NEO|SE|MK\d+|GEN\d+)\b/gi;
const REFRESH_RATE_RE = /\b(\d{2,3})\s*HZ\b/gi;
const REFRESH_RATE_BEFORE_RESOLUTION_RE = /\b(\d{2,3})\s+(?:FHD|QHD|WQHD|UHD)\b/gi;
const COLOR_PATTERNS: Array<[RegExp, string]> = [
  [/(?:화이트|\bWHITE\b)/i, 'white'],
  [/(?:블랙|\bBLACK\b)/i, 'black'],
  [/(?:실버|\bSILVER\b)/i, 'silver'],
  [/(?:그레이|\bGR(?:A|E)Y\b)/i, 'gray'],
  [/(?:베이지|\bBEIGE\b)/i, 'beige'],
];

function generationNearModel(text: string, model?: string): string | undefined {
  if (!model) return undefined;
  const upper = text.toUpperCase();
  const index = upper.indexOf(model.toUpperCase());
  if (index < 0) return undefined;
  const window = text.slice(index, index + model.length + 40);
  return window.match(GENERATION_RE)?.[1]?.toUpperCase();
}

function colorValues(text: string): Set<string> {
  const matches = new Set<string>();
  for (const [pattern, normalized] of COLOR_PATTERNS) {
    if (pattern.test(text)) matches.add(normalized);
  }
  return matches;
}

function uniqueColor(text: string): string | undefined {
  const matches = colorValues(text);
  return matches.size === 1 ? [...matches][0] : undefined;
}

function monitorLike(text: string): boolean {
  return /(모니터|\b(?:FHD|QHD|WQHD|UHD|IPS|VA|OLED)\b|\d{2,3}\s*HZ\b)/i.test(text);
}

function pixelPolicySignals(text: string): { standard: boolean; zeroDefect: boolean } {
  return {
    zeroDefect: /무결점|ZERO[- ]?DEFECT|PIXEL[- ]?PERFECT/i.test(text),
    standard: /(?:^|[\s/()[\],·-])일반(?:$|[\s/()[\],·-])/i.test(text),
  };
}

function pixelPolicy(text: string): PixelPolicy | undefined {
  if (!monitorLike(text)) return undefined;
  const { standard, zeroDefect } = pixelPolicySignals(text);
  if (zeroDefect === standard) return undefined;
  return zeroDefect ? 'zero_defect' : 'standard';
}

function addRefreshRate(values: Set<number>, raw: string | undefined): void {
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 30 && value <= 1000) values.add(value);
}

function refreshRateValues(text: string): Set<number> {
  const values = new Set<number>();
  for (const match of text.matchAll(REFRESH_RATE_RE)) addRefreshRate(values, match[1]);
  if (monitorLike(text)) {
    for (const match of text.matchAll(REFRESH_RATE_BEFORE_RESOLUTION_RE)) addRefreshRate(values, match[1]);
  }
  return values;
}

function refreshRateHz(text: string): number | undefined {
  const values = refreshRateValues(text);
  return values.size === 1 ? [...values][0] : undefined;
}

export function materialVariantConflicts(text: string): string[] {
  const conflicts: string[] = [];
  const refreshRates = refreshRateValues(text);
  if (refreshRates.size > 1) {
    conflicts.push(`refresh_rate:${[...refreshRates].sort((a, b) => a - b).join('|')}`);
  }

  const colors = colorValues(text);
  if (colors.size > 1) {
    conflicts.push(`color:${[...colors].sort().join('|')}`);
  }

  if (monitorLike(text)) {
    const policy = pixelPolicySignals(text);
    if (policy.standard && policy.zeroDefect) conflicts.push('pixel_policy:standard|zero_defect');
  }

  const generations = new Set(
    [...text.matchAll(GENERATION_ALL_RE)]
      .map((match) => match[1]?.toUpperCase())
      .filter((value): value is string => Boolean(value)),
  );
  if (generations.size > 1) {
    conflicts.push(`generation:${[...generations].sort().join('|')}`);
  }

  return conflicts;
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
