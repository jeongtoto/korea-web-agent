import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateShoppingConstraints } from '../src/shopping/constraint-gate.ts';
import type { FactValue, ShoppingCandidate, ShoppingConstraint } from '../src/shopping/types.ts';

function fact(value: FactValue['value'], verification: FactValue['verification'] = 'page_verified'): FactValue {
  return { value, verification, sourceUrl: 'https://example.com/product' };
}

function candidate(facts: Record<string, FactValue>): ShoppingCandidate {
  return {
    key: 'candidate',
    title: 'candidate',
    variant: {},
    bundle: [],
    condition: 'new',
    sourceUrls: ['https://example.com/product'],
    discoveryScore: 0.8,
    facts,
    constraintState: 'PRELIMINARY',
  };
}

const tvConstraints: ShoppingConstraint[] = [
  { id: 'size', field: 'screenSizeInch', operator: 'eq', expected: 43, strength: 'hard' },
  { id: 'resolution', field: 'resolution', operator: 'eq', expected: '4K', strength: 'hard' },
  { id: 'portable', field: 'portableStand', operator: 'eq', expected: true, strength: 'hard' },
];

test('verified FHD is excluded by a hard 4K requirement even when other facts pass', () => {
  const result = evaluateShoppingConstraints(candidate({
    screenSizeInch: fact(43),
    resolution: fact('FHD'),
    portableStand: fact(true),
  }), tvConstraints);

  assert.equal(result.state, 'EXCLUDED');
  assert.deepEqual(result.failed, ['resolution']);
});

test('search metadata wording alone cannot satisfy or fail a hard constraint', () => {
  const result = evaluateShoppingConstraints(candidate({
    screenSizeInch: fact(43, 'search_metadata'),
    resolution: fact('4K', 'search_metadata'),
    portableStand: fact(true, 'search_metadata'),
  }), tvConstraints);

  assert.equal(result.state, 'PRELIMINARY');
  assert.equal(result.unknown.length, 3);
  assert.equal(result.failed.length, 0);
});

test('page-verified 43-inch 4K portable display is eligible', () => {
  const result = evaluateShoppingConstraints(candidate({
    screenSizeInch: fact(43),
    resolution: fact('4K'),
    portableStand: fact(true),
  }), tvConstraints);

  assert.equal(result.state, 'ELIGIBLE');
  assert.equal(result.passed.length, 3);
});

test('verified single bedding size is excluded when queen is required', () => {
  const constraints: ShoppingConstraint[] = [
    { id: 'queen', field: 'bedSize', operator: 'includes', expected: ['Q', 'QUEEN'], strength: 'hard' },
  ];
  const result = evaluateShoppingConstraints(candidate({ bedSize: fact('SINGLE') }), constraints);
  assert.equal(result.state, 'EXCLUDED');
});
