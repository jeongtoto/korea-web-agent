import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('Netlify agent research starts a queued job and dispatches a background worker', () => {
  assert.equal(existsSync('netlify/functions/agent-research-background.mjs'), true);
  const start = readFileSync('netlify/functions/agent-research.mjs', 'utf8');
  assert.match(start, /createQueuedAgentResearch/);
  assert.match(start, /agent-research-background/);
  assert.match(start, /status\s*===\s*202|response\.status\s*!==\s*202/);
  assert.doesNotMatch(start, /await\s+runAgentResearch\(/);
});

test('background worker is explicitly configured for background mode and reuses the queued job id', () => {
  const worker = readFileSync('netlify/functions/agent-research-background.mjs', 'utf8');
  assert.match(worker, /background\s*:\s*true/);
  assert.match(worker, /claimQueuedAgentResearch/);
  assert.match(worker, /runAgentResearch/);
  assert.match(worker, /idFactory\s*:\s*\(\)\s*=>\s*jobId/);
  assert.doesNotMatch(worker, /return\s+json\([^)]*KWA_RELAY_SECRET/);
});

test('agent poll endpoint can report queued state and terminal background result before/without raw relay job', () => {
  const poll = readFileSync('netlify/functions/agent-job.mjs', 'utf8');
  assert.match(poll, /getAgentResearchJobState/);
  assert.match(poll, /getAgentResearchResult/);
  assert.match(poll, /getStoredResearchJob/);
});
