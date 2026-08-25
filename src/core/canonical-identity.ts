import type {
  CanonicalComponent,
  CanonicalProductIdentity,
  NormalizedTarget,
  OfferCondition,
} from './types.ts';

const MODEL_TOKEN_RE = /\b[A-Z]{2,}[A-Z0-9_-]*\d[A-Z0-9_-]*\b/gi;
const SIZE_RE = /(?:^|[^0-9])(\d{2,3}(?:\.\d+)?)\s*(?:인치|inch|형)(?=$|[^0-9a-z])/i;
const VERSION_RE = /\b(V\d+(?:\.\d+)?)\b/i;

function compact(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeCode(value: string | undefined): string | undefined {
  const normalized = compact(value).toUpperCase().replace(/\s+/g, '');
  return normalized || undefined;
}

function normalizeBrand(value: string | undefined): string | undefined {
  const normalized = compact(value);
  if (!normalized) return undefined;
  return /[a-z]/i.test(normalized) && !/[가-힣]/.test(normalized)
    ? normalized.toUpperCase()
    : normalized;
}

function explicitCondition(question: string): OfferCondition | 'any' {
  const value = question.toLowerCase();
  if (/(중고|used)/i.test(value)) return 'used';
  if (/(리퍼|refurb)/i.test(value)) return 'refurbished';
  if (/(반품|오픈\s*박스|open\s*box)/i.test(value)) return 'open_box';
  if (/(전시|display)/i.test(value)) return 'display';
  if (/(신품|새제품|새상품|미개봉\s*신품|new\s*(?:product)?)/i.test(value)) return 'new';
  return 'any';
}

function modelTokens(question: string): string[] {
  return [...new Set((question.match(MODEL_TOKEN_RE) ?? []).map((token) => token.toUpperCase()))];
}

function inclusionSuppressed(question: string): boolean {
  return /(본체\s*만|본품\s*만|단품|스탠드\s*(?:별도|미포함)|거치대\s*(?:별도|미포함))/i.test(question);
}

function wordingImpliesBundle(question: string): boolean {
  return /\+|세트|셋트|패키지|번들|포함/i.test(question);
}

function versionNearModel(question: string, model: string): string | undefined {
  const upper = question.toUpperCase();
  const index = upper.indexOf(model.toUpperCase());
  if (index < 0) return undefined;
  const window = question.slice(Math.max(0, index - 8), index + model.length + 24);
  return window.match(VERSION_RE)?.[1]?.toUpperCase();
}

function componentType(question: string, model: string): string {
  const upper = question.toUpperCase();
  const index = upper.indexOf(model.toUpperCase());
  const window = index >= 0
    ? question.slice(Math.max(0, index - 24), index + model.length + 32)
    : question;
  if (/(스탠드|거치대|이동형|무빙)/i.test(window)) return 'stand';
  return 'component';
}

function buildRequiredComponents(
  question: string,
  primaryModel: string | undefined,
): CanonicalComponent[] {
  if (inclusionSuppressed(question) || !wordingImpliesBundle(question)) return [];
  const models = modelTokens(question).filter((model) => model !== primaryModel);
  return models.map((model) => ({
    type: componentType(question, model),
    model,
    ...(versionNearModel(question, model) ? { version: versionNearModel(question, model) } : {}),
    quantity: 1,
  }));
}

function inferredPrimaryModel(target: NormalizedTarget, question: string): string | undefined {
  const explicit = normalizeCode(target.model);
  if (explicit) return explicit;
  return modelTokens(question)[0];
}

export function compileCanonicalIdentity(
  target: NormalizedTarget,
  question: string,
): CanonicalProductIdentity {
  const primaryModel = inferredPrimaryModel(target, question);
  const size = question.match(SIZE_RE)?.[1]
    ?? target.variant?.match(SIZE_RE)?.[1];
  const brand = normalizeBrand(target.brand);
  const requiredComponents = buildRequiredComponents(question, primaryModel);

  return {
    kind: 'product',
    ...(brand ? { brand } : {}),
    primary: {
      ...(primaryModel ? { model: primaryModel } : {}),
      ...(size ? { size } : {}),
    },
    requiredComponents,
    optionalComponents: [],
    condition: explicitCondition(question),
    source: {
      question: compact(question),
      ...(target.canonicalUrl ? { url: target.canonicalUrl } : {}),
      confidence: primaryModel ? 0.9 : 0.6,
    },
  };
}

export function canonicalIdentityKey(
  identity: CanonicalProductIdentity,
): string | undefined {
  const model = normalizeCode(identity.primary.model);
  if (!model) return undefined;

  const parts = [
    normalizeBrand(identity.brand),
    model,
    compact(identity.primary.size) || undefined,
    ...identity.requiredComponents.map((component) => {
      const componentModel = normalizeCode(component.model);
      if (!componentModel) return undefined;
      const version = normalizeCode(component.version);
      return version ? `${componentModel}@${version}` : componentModel;
    }),
    identity.condition === 'any' ? undefined : identity.condition.toUpperCase(),
  ].filter((value): value is string => Boolean(value));

  return parts.join(':');
}
