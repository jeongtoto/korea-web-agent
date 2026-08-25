import test from 'node:test';
import assert from 'node:assert/strict';

test('server-side product response validator is available', async () => {
  await assert.doesNotReject(async () => {
    const module = await import('../src/core/response-validator.ts');
    assert.equal(typeof module.validateProductReport, 'function');
  });
});
