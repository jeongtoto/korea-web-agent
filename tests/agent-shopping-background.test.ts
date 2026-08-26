import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Netlify background worker injects Shopping Intelligence with cached public exact-price verification', async () => {
  const source = await readFile(new URL('../netlify/functions/agent-research-background.mjs', import.meta.url), 'utf8');

  assert.match(source, /runShoppingResearch/);
  assert.match(source, /fetchDirectPage/);
  assert.match(source, /shoppingResearch\s*:/);
  assert.match(source, /exactPriceCache/);
  assert.match(source, /includeLocalRelay:\s*false/);
  assert.doesNotMatch(source, /shoppingResearch[\s\S]{0,300}relaySecret/);
});
