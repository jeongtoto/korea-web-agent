import type {
  CanonicalComponent,
  CanonicalIdentityMatch,
  CanonicalProductIdentity,
  OfferCondition,
} from './types.ts';

const MODEL_TOKEN_RE = /\b[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*\b/gi;
const SIZE_RE = /(?:^|[^0-9])(\d{2,3}(?:\.\d+)?)\s*(?:인치|inch|형)(?=$|[^0-9a-z])/i;
const VERSION_RE = /\b(V\d+(?:\.\d+)?)\b/i;

function normalizedCode(value: string | undefined): string | undefined {
  const output = value?.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return output || undefined;
}

function normalizedText(value: string | undefined): string | undefined {
  const output = value?.toLowerCase().replace(/\s+/g, ' ').trim();
  return output || undefined;
}

function modelTokens(text: string): string[] {
  return [...new Set((text.match(MODEL_TOKEN_RE) ?? [])
    .map((value) => value.toUpperCase())
    .filter((value) => !/^V\d+(?:\.\d+)?$/i.test(value)))];
}

function conditionFromText(text: string): OfferCondition | 'any' {
  if (/(중고|used)/i.test(text)) return 'used';
  if (/(리퍼|refurb)/i.test(text)) return 'refurbished';
  if (/(반품|오픈\s*박스|open\s*box)/i.test(text)) return 'open_box';
  if (/(전시|display)/i.test(text)) return 'display';
  if (/(신품|새제품|새상품|미개봉)/i.test(text)) return 'new';
  return 'any';
}

function versionNearModel(text: string, model: string): string | undefined {
  const index = text.toUpperCase().indexOf(model.toUpperCase());
  if (index < 0) return undefined;
  const window = text.slice(Math.max(0, index - 8), index + model.length + 24);
  return window.match(VERSION_RE)?.[1]?.toUpperCase();
}

function componentType(text: string, model: string): string {
  const index = text.toUpperCase().indexOf(model.toUpperCase());
  const window = index >= 0
    ? text.slice(Math.max(0, index - 24), index + model.length + 32)
    : text;
  return /(스탠드|거치대|이동형|무빙)/i.test(window) ? 'stand' : 'component';
}

export function candidateIdentityFromText(
  text: string,
  condition?: OfferCondition,
): CanonicalProductIdentity {
  const models = modelTokens(text);
  const primaryModel = models[0];
  const requiredComponents: CanonicalComponent[] = models.slice(1).map((model) => {
    const version = versionNearModel(text, model);
    return {
      type: componentType(text, model),
      model,
      ...(version ? { version } : {}),
      quantity: 1,
    };
  });
  const size = text.match(SIZE_RE)?.[1];

  return {
    kind: 'product',
    primary: {
      ...(primaryModel ? { model: primaryModel } : {}),
      ...(size ? { size } : {}),
    },
    requiredComponents,
    optionalComponents: [],
    condition: condition ?? conditionFromText(text),
    source: {
      question: text.replace(/\s+/g, ' ').trim(),
      confidence: primaryModel ? 0.8 : 0.4,
    },
  };
}

function compareField(
  label: string,
  reference: string | undefined,
  candidate: string | undefined,
  matched: string[],
  missing: string[],
  conflicts: string[],
  normalize: (value: string | undefined) => string | undefined = normalizedCode,
): void {
  const expected = normalize(reference);
  if (!expected) return;
  const actual = normalize(candidate);
  if (!actual) {
    missing.push(`${label}: ${reference}`);
    return;
  }
  if (expected !== actual) {
    conflicts.push(`${label}: ${reference} != ${candidate}`);
    return;
  }
  matched.push(`${label}: ${reference}`);
}

function findCandidateComponent(
  reference: CanonicalComponent,
  candidates: CanonicalComponent[],
): CanonicalComponent | undefined {
  const expectedModel = normalizedCode(reference.model);
  if (expectedModel) {
    return candidates.find((candidate) => normalizedCode(candidate.model) === expectedModel);
  }
  return candidates.find((candidate) => normalizedText(candidate.type) === normalizedText(reference.type));
}

function conflictingComponentOfSameType(
  reference: CanonicalComponent,
  candidates: CanonicalComponent[],
): CanonicalComponent | undefined {
  const expectedModel = normalizedCode(reference.model);
  if (!expectedModel) return undefined;
  return candidates.find((candidate) =>
    normalizedText(candidate.type) === normalizedText(reference.type)
      && candidate.model
      && normalizedCode(candidate.model) !== expectedModel);
}

function hasStableReferenceIdentifier(reference: CanonicalProductIdentity): boolean {
  return Boolean(
    normalizedCode(reference.primary.model)
      || normalizedCode(reference.primary.generation)
      || normalizedText(reference.primary.capacity)
      || reference.requiredComponents.some((component) => normalizedCode(component.model)),
  );
}

export function compareCanonicalIdentity(
  reference: CanonicalProductIdentity,
  candidate: CanonicalProductIdentity,
): CanonicalIdentityMatch {
  const matched: string[] = [];
  const missing: string[] = [];
  const conflicts: string[] = [];

  if (reference.brand && candidate.brand) {
    compareField('brand', reference.brand, candidate.brand, matched, missing, conflicts, normalizedText);
  }
  compareField('primary.model', reference.primary.model, candidate.primary.model, matched, missing, conflicts);
  compareField('primary.size', reference.primary.size, candidate.primary.size, matched, missing, conflicts, normalizedText);
  compareField('primary.generation', reference.primary.generation, candidate.primary.generation, matched, missing, conflicts);
  compareField('primary.capacity', reference.primary.capacity, candidate.primary.capacity, matched, missing, conflicts, normalizedText);
  compareField('primary.color', reference.primary.color, candidate.primary.color, matched, missing, conflicts, normalizedText);

  for (const required of reference.requiredComponents) {
    const component = findCandidateComponent(required, candidate.requiredComponents);
    if (!component) {
      const explicitOther = conflictingComponentOfSameType(required, candidate.requiredComponents);
      if (explicitOther?.model) {
        conflicts.push(`component ${required.type}: ${required.model ?? 'required'} != ${explicitOther.model}`);
      } else {
        missing.push(`component ${required.type}: ${required.model ?? 'required'}`);
      }
      continue;
    }

    if (required.model) matched.push(`component ${required.type}: ${required.model}`);
    const expectedVersion = normalizedCode(required.version);
    if (expectedVersion) {
      const actualVersion = normalizedCode(component.version);
      if (!actualVersion) {
        missing.push(`component ${required.model ?? required.type} version: ${required.version}`);
      } else if (actualVersion !== expectedVersion) {
        conflicts.push(`component ${required.model ?? required.type} version: ${required.version} != ${component.version}`);
      } else {
        matched.push(`component ${required.model ?? required.type} version: ${required.version}`);
      }
    }
  }

  if (conflicts.length > 0) {
    return { verdict: 'different', matched, missing, conflicts, confidence: 0 };
  }
  if (missing.length > 0) {
    const denominator = matched.length + missing.length;
    return {
      verdict: 'uncertain',
      matched,
      missing,
      conflicts,
      confidence: denominator ? matched.length / denominator : 0.25,
    };
  }

  if (!hasStableReferenceIdentifier(reference)) {
    return {
      verdict: 'uncertain',
      matched,
      missing: ['stable product identifier'],
      conflicts,
      confidence: Math.min(reference.source.confidence, 0.5),
    };
  }

  if (reference.condition !== 'any') {
    if (candidate.condition === 'any' || candidate.condition === 'unknown') {
      return {
        verdict: 'uncertain',
        matched,
        missing: [`condition: ${reference.condition}`],
        conflicts,
        confidence: 0.75,
      };
    }
    if (candidate.condition !== reference.condition) {
      return { verdict: 'same_except_condition', matched, missing, conflicts, confidence: 0.95 };
    }
    matched.push(`condition: ${reference.condition}`);
  }

  return { verdict: 'exact', matched, missing, conflicts, confidence: 1 };
}