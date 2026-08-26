import type {
  FactValue,
  ShoppingCandidate,
  ShoppingConstraint,
  ShoppingConstraintState,
} from './types.ts';

export interface ShoppingConstraintEvaluationResult {
  state: ShoppingConstraintState;
  passed: string[];
  unknown: string[];
  failed: string[];
}

function normalizedText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toUpperCase().replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function normalizedList(value: string | string[]): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => normalizedText(item))
    .filter((item): item is string => Boolean(item));
}

function isVerified(fact: FactValue | undefined): boolean {
  return Boolean(fact && ['page_verified', 'official'].includes(fact.verification));
}

function evaluateValue(constraint: ShoppingConstraint, actual: FactValue['value']): boolean | undefined {
  const expected = constraint.expected;

  if (constraint.operator === 'eq') {
    if (typeof expected === 'number') {
      return typeof actual === 'number' && Number.isFinite(actual) ? actual === expected : undefined;
    }
    if (typeof expected === 'boolean') {
      return typeof actual === 'boolean' ? actual === expected : undefined;
    }
    if (typeof expected === 'string') {
      const expectedText = normalizedText(expected);
      const actualText = normalizedText(actual);
      return expectedText && actualText ? actualText === expectedText : undefined;
    }
    if (Array.isArray(expected)) {
      const allowed = normalizedList(expected);
      if (typeof actual === 'string') {
        const actualText = normalizedText(actual);
        return actualText ? allowed.includes(actualText) : undefined;
      }
      if (Array.isArray(actual)) {
        const actualValues = normalizedList(actual);
        return actualValues.length ? actualValues.some((item) => allowed.includes(item)) : undefined;
      }
      return undefined;
    }
  }

  if (constraint.operator === 'min' || constraint.operator === 'max') {
    if (typeof expected !== 'number' || typeof actual !== 'number' || !Number.isFinite(actual)) return undefined;
    return constraint.operator === 'min' ? actual >= expected : actual <= expected;
  }

  if (constraint.operator === 'includes') {
    if (Array.isArray(expected)) {
      const allowed = normalizedList(expected);
      if (typeof actual === 'string') {
        const actualText = normalizedText(actual);
        return actualText ? allowed.includes(actualText) : undefined;
      }
      if (Array.isArray(actual)) {
        const actualValues = normalizedList(actual);
        return actualValues.length ? actualValues.some((item) => allowed.includes(item)) : undefined;
      }
      return undefined;
    }
    if (typeof expected === 'string') {
      const expectedText = normalizedText(expected);
      if (!expectedText) return undefined;
      if (typeof actual === 'string') {
        const actualText = normalizedText(actual);
        return actualText ? actualText.includes(expectedText) : undefined;
      }
      if (Array.isArray(actual)) {
        const actualValues = normalizedList(actual);
        return actualValues.length ? actualValues.some((item) => item.includes(expectedText)) : undefined;
      }
    }
  }

  return undefined;
}

export function evaluateShoppingConstraints(
  candidate: ShoppingCandidate,
  constraints: ShoppingConstraint[],
): ShoppingConstraintEvaluationResult {
  const passed: string[] = [];
  const unknown: string[] = [];
  const failed: string[] = [];

  for (const constraint of constraints.filter((item) => item.strength === 'hard')) {
    const fact = candidate.facts[constraint.field];
    if (!isVerified(fact)) {
      unknown.push(constraint.id);
      continue;
    }

    const verdict = evaluateValue(constraint, fact!.value);
    if (verdict === true) passed.push(constraint.id);
    else if (verdict === false) failed.push(constraint.id);
    else unknown.push(constraint.id);
  }

  const state: ShoppingConstraintState = failed.length
    ? 'EXCLUDED'
    : unknown.length
      ? 'PRELIMINARY'
      : 'ELIGIBLE';

  return { state, passed, unknown, failed };
}
