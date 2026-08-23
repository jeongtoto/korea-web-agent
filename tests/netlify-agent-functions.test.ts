import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { validateAgentResearchInput } from '../src/agent/research.ts';

test('agent input validator accepts query-only requests and rejects private/local URLs', () => {
  assert.deepEqual(validateAgentResearchInput({ query: '와이드뷰 43인치 4K V3 스탠드 어때?' }), {
    query: '와이드뷰 43인치 4K V3 스탠드 어때?',
  });
  assert.throws(() => validateAgentResearchInput({ query: '테스트', url: 'http://127.0.0.1/private' }), /private|local/i);
});

test('Netlify publishes start and direct query-based status functions for ChatGPT Action polling', () => {
  assert.equal(existsSync('netlify/functions/agent-research.mjs'), true);
  assert.equal(existsSync('netlify/functions/agent-job.mjs'), true);
  const config = readFileSync('netlify.toml', 'utf8');
  assert.match(config, /from\s*=\s*"\/api\/agent\/research"/);
  assert.match(config, /from\s*=\s*"\/api\/agent\/job"[\s\S]*?to\s*=\s*"\/\.netlify\/functions\/agent-job"/);
});

test('agent functions use the compact agent service instead of returning raw relay secrets', () => {
  const start = readFileSync('netlify/functions/agent-research.mjs', 'utf8');
  const status = readFileSync('netlify/functions/agent-job.mjs', 'utf8');
  assert.match(start, /runAgentResearch/);
  assert.match(status, /shapeAgentResearchJob/);
  assert.equal(start.includes('KWA_RELAY_SECRET') && start.includes('return json(process.env.KWA_RELAY_SECRET'), false);
  assert.equal(status.includes('KWA_RELAY_SECRET'), false);
});
