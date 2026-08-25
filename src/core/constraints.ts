import type {
  ConstraintEvaluation,
  ProductConstraint,
} from './types.ts';

const DIMENSIONS_RE = /(\d{3,4})\s*[x×*]\s*(\d{3,4})(?:\s*[x×*]\s*(\d{2,4}))?/i;

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasHardLanguage(question: string): boolean {
  return /(필수|반드시|실제로|완전히|올라가|맞아야|맞아야|지원해야|호환되어야|이상|제외|만\b)/i.test(question);
}

function dimensionConstraints(question: string): ProductConstraint[] {
  const match = question.match(DIMENSIONS_RE);
  if (!match || !hasHardLanguage(question)) return [];
  const width = Number(match[1]);
  const length = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(length)) return [];
  if (!/(매트리스|침대|프레임|올라가|맞아|지원|호환)/i.test(question)) return [];
  return [
    {
      id: 'supported-width-mm',
      label: `지원 폭 ${width}mm 이상`,
      strength: 'hard',
      kind: 'dimension_min',
      field: 'supportedWidthMm',
      expected: width,
      source: 'user',
    },
    {
      id: 'supported-length-mm',
      label: `지원 길이 ${length}mm 이상`,
      strength: 'hard',
      kind: 'dimension_min',
      field: 'supportedLengthMm',
      expected: length,
      source: 'user',
    },
  ];
}

function drawerConstraint(question: string): ProductConstraint[] {
  if (!/(서랍(?:형|식)?[^.!?\n]{0,12}(?:필수|반드시)|(?:필수|반드시)[^.!?\n]{0,12}서랍)/i.test(question)) return [];
  return [{
    id: 'drawer-storage-required',
    label: '서랍 수납 필수',
    strength: 'hard',
    kind: 'boolean_required',
    field: 'drawerStorage',
    expected: true,
    source: 'user',
  }];
}

function headboardConstraint(question: string): ProductConstraint[] {
  const allowed = /무헤드[^.!?\n]{0,12}(?:또는|or|\/)[^.!?\n]{0,12}소파형|소파형[^.!?\n]{0,12}(?:또는|or|\/)[^.!?\n]{0,12}무헤드/i.test(question);
  if (!allowed || !/(만|필수|반드시|제외)/i.test(question)) return [];
  return [{
    id: 'headboard-style-allowed',
    label: '무헤드 또는 소파형 헤드',
    strength: 'hard',
    kind: 'enum_allowed',
    field: 'headboardStyle',
    expected: ['headless', 'sofa'],
    source: 'user',
  }];
}

export function compileProductConstraints(question: string): ProductConstraint[] {
  const value = compact(question);
  return [
    ...dimensionConstraints(value),
    ...drawerConstraint(value),
    ...headboardConstraint(value),
  ];
}

function comparableText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

export function evaluateProductConstraints(
  constraints: ProductConstraint[],
  facts: Record<string, unknown>,
): ConstraintEvaluation[] {
  return constraints.map((constraint) => {
    const actual = facts[constraint.field];
    if (actual === undefined || actual === null || actual === '') {
      return { constraint, status: 'unknown' as const };
    }

    if (constraint.kind === 'dimension_min') {
      if (typeof actual !== 'number' || typeof constraint.expected !== 'number' || !Number.isFinite(actual)) {
        return { constraint, status: 'unknown' as const };
      }
      return {
        constraint,
        status: actual >= constraint.expected ? 'verified_pass' as const : 'verified_fail' as const,
        evidence: `${constraint.field}=${actual}`,
      };
    }

    if (constraint.kind === 'boolean_required') {
      if (typeof actual !== 'boolean' || typeof constraint.expected !== 'boolean') {
        return { constraint, status: 'unknown' as const };
      }
      return {
        constraint,
        status: actual === constraint.expected ? 'verified_pass' as const : 'verified_fail' as const,
        evidence: `${constraint.field}=${actual}`,
      };
    }

    if (constraint.kind === 'enum_allowed') {
      const value = comparableText(actual);
      const allowed = Array.isArray(constraint.expected)
        ? constraint.expected.map((item) => comparableText(item)).filter((item): item is string => Boolean(item))
        : [];
      if (!value || allowed.length === 0) return { constraint, status: 'unknown' as const };
      return {
        constraint,
        status: allowed.includes(value) ? 'verified_pass' as const : 'verified_fail' as const,
        evidence: `${constraint.field}=${String(actual)}`,
      };
    }

    const value = comparableText(actual);
    const expected = comparableText(constraint.expected);
    if (!value || !expected) return { constraint, status: 'unknown' as const };
    return {
      constraint,
      status: value.includes(expected) ? 'verified_pass' as const : 'verified_fail' as const,
      evidence: `${constraint.field}=${String(actual)}`,
    };
  });
}

export function constraintEligibility(
  evaluations: ConstraintEvaluation[],
): 'eligible' | 'preliminary' | 'excluded' {
  const hard = evaluations.filter((item) => item.constraint.strength === 'hard');
  if (hard.some((item) => item.status === 'verified_fail')) return 'excluded';
  if (hard.some((item) => item.status === 'unknown')) return 'preliminary';
  return 'eligible';
}

export function constraintFactsFromText(text: string): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const dimensions = text.match(DIMENSIONS_RE);
  if (dimensions?.[1] && dimensions[2]) {
    facts.supportedWidthMm = Number(dimensions[1]);
    facts.supportedLengthMm = Number(dimensions[2]);
  }
  if (/(서랍형|서랍식|서랍\s*수납|수납\s*서랍)/i.test(text)) facts.drawerStorage = true;
  if (/(서랍\s*없음|무서랍)/i.test(text)) facts.drawerStorage = false;
  if (/무헤드/i.test(text)) facts.headboardStyle = 'headless';
  else if (/소파형/i.test(text)) facts.headboardStyle = 'sofa';
  return facts;
}
