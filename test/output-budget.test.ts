import assert from 'node:assert/strict';
import test from 'node:test';

import { applyOutputBudget } from '../src/presentation/budget.js';

const value = {
  items: Array.from({ length: 8 }, (_, index) => ({
    productId: String(index),
    title: `Product ${index} ${'x'.repeat(80)}`,
    price: index,
  })),
  provenance: { source: 'fixture', retrievedAt: '2026-08-28T10:00:00.000Z' },
};

test('applyOutputBudget is deterministic, bounded, and preserves identity/provenance', () => {
  const first = applyOutputBudget(value, { maxChars: 650, maxItems: 8 });
  const second = applyOutputBudget(value, { maxChars: 650, maxItems: 8 });

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).length <= 650, true);
  assert.equal(first.items.length > 0, true);
  assert.equal(typeof first.items[0].productId, 'string');
  assert.deepEqual(first.provenance, value.provenance);
  assert.equal(first.truncation.truncated, true);
  assert.equal(first.truncation.omittedItems > 0, true);
});

test('applyOutputBudget rejects budgets too small for an auditable envelope', () => {
  assert.throws(() => applyOutputBudget(value, { maxChars: 100, maxItems: 8 }), /at least 512/);
});

test('applyOutputBudget preserves all fields and reports no truncation when the envelope fits', () => {
  const fitting = {
    items: [{ productId: '1', title: 'Product', details: { stock: 4, seller: 'Shop' } }],
    provenance: { source: 'fixture' },
  };

  const result = applyOutputBudget(fitting, { maxChars: 2_000, maxItems: 10 });

  assert.deepEqual(result.items, fitting.items);
  assert.deepEqual(result.provenance, fitting.provenance);
  assert.deepEqual(result.truncation.omittedFields, []);
  assert.equal(result.truncation.truncated, false);
});
