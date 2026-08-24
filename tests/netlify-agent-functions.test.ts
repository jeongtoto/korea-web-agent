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
  assert.equal(existsSync('netlify/functions/agent-research-background.mjs'), true);
  assert.equal(existsSync('netlify/functions/agent-job.mjs'), true);
  const config = readFileSync('netlify.toml', 'utf8');
  assert.match(config, /from\s*=\s*"\/api\/agent\/research"/);
  assert.match(config, /from\s*=\s*"\/api\/agent\/job"[\s\S]*?to\s*=\s*"\/\.netlify\/functions\/agent-job"/);
});

test('agent job function accepts jobId query and keeps legacy id fallback', () => {
  const status = readFileSync('netlify/functions/agent-job.mjs', 'utf8');
  assert.match(status, /searchParams\.get\(['"]jobId['"]\)/);
  assert.match(status, /searchParams\.get\(['"]id['"]\)/);
});

test('agent functions separate queue dispatch, background research, and compact polling without returning raw relay secrets', () => {
  const start = readFileSync('netlify/functions/agent-research.mjs', 'utf8');
  const worker = readFileSync('netlify/functions/agent-research-background.mjs', 'utf8');
  const status = readFileSync('netlify/functions/agent-job.mjs', 'utf8');
  assert.match(start, /createQueuedAgentResearch/);
  assert.doesNotMatch(start, /runAgentResearch/);
  assert.match(worker, /runAgentResearch/);
  assert.match(status, /shapeAgentResearchJob/);
  assert.equal(start.includes('return json(Netlify.env.get(\'KWA_RELAY_SECRET\')'), false);
  assert.equal(worker.includes('return json(Netlify.env.get(\'KWA_RELAY_SECRET\')'), false);
  assert.equal(status.includes('KWA_RELAY_SECRET'), false);
});
