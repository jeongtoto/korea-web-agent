import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaUrl = new URL('../openapi/korea-web-agent-action.yaml', import.meta.url);

async function yaml(): Promise<string> {
  return readFile(schemaUrl, 'utf8');
}

test('v0.6.2 Action schema preserves operation IDs and exposes public conditional pricing additively', async () => {
  const value = await yaml();
  assert.match(value, /operationId:\s*startProductResearch/);
  assert.match(value, /operationId:\s*getProductResearchResult/);
  assert.match(value, /publicConditional:/);
  assert.match(value, /public_conditional/);
});

test('v0.6.2 Action schema exposes provider coverage diagnostics without bumping release metadata early', async () => {
  const value = await yaml();
  assert.match(value, /providerId:/);
  assert.match(value, /comparisonPages:/);
  assert.match(value, /expandedSellers:/);
  assert.match(value, /exactOffers:/);
  assert.match(value, /eligibleSellers:/);
  assert.match(value, /failureKind:/);
  assert.match(value, /version:\s*0\.6\.1\b/);
});
