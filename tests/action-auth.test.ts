import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { actionAuthorized, actionAuthConfigured } from '../netlify/functions/_lib/auth.mjs';

const ACTION_KEY = 'action-key-0123456789abcdef0123456789';
const RELAY_KEY = 'relay-key-abcdef0123456789abcdef0123';

function requestWithBearer(value?: string): Request {
  const headers = new Headers();
  if (value) headers.set('authorization', `Bearer ${value}`);
  return new Request('https://korea-web-agent.netlify.app/api/agent/research', { headers });
}

test('Action auth accepts only the separate configured Action API key', () => {
  assert.equal(actionAuthConfigured(ACTION_KEY), true);
  assert.equal(actionAuthorized(requestWithBearer(ACTION_KEY), ACTION_KEY), true);
  assert.equal(actionAuthorized(requestWithBearer('wrong-key'), ACTION_KEY), false);
  assert.equal(actionAuthorized(requestWithBearer(), ACTION_KEY), false);
  assert.equal(actionAuthorized(requestWithBearer(RELAY_KEY), ACTION_KEY), false);
});

test('Action auth is considered unconfigured for missing or short secrets', () => {
  assert.equal(actionAuthConfigured(''), false);
  assert.equal(actionAuthConfigured('short'), false);
});

test('Custom GPT Action schema defines authenticated start and query-based poll operations', () => {
  assert.equal(existsSync('openapi/korea-web-agent-action.yaml'), true);
  const schema = readFileSync('openapi/korea-web-agent-action.yaml', 'utf8');
  assert.match(schema, /openapi:\s*3\.1\.0/);
  assert.match(schema, /\/api\/agent\/research:/);
  assert.match(schema, /\/api\/agent\/job:/);
  assert.match(schema, /operationId:\s*startProductResearch/);
  assert.match(schema, /operationId:\s*getProductResearchResult/);
  assert.match(schema, /- name:\s*jobId\n\s+in:\s*query/);
  assert.match(schema, /scheme:\s*bearer/);
  assert.doesNotMatch(schema, /KWA_RELAY_SECRET/);
});

test('Custom GPT operation descriptions stay within the 300-character Action limit', () => {
  const schema = readFileSync('openapi/korea-web-agent-action.yaml', 'utf8');
  const startOperation = schema.match(/operationId:\s*startProductResearch\n\s+summary:[^\n]*\n\s+description:\s*([^\n]+)/);
  assert.ok(startOperation, 'startProductResearch description must exist');
  assert.ok(startOperation[1].length <= 300, `startProductResearch description is ${startOperation[1].length} characters`);
});

test('Custom GPT Action price schema exposes Naver live payment and effective-price fields', () => {
  const schema = readFileSync('openapi/korea-web-agent-action.yaml', 'utf8');
  for (const field of [
    'sellerInstantDiscount',
    'couponDiscount',
    'cardInstantDiscount',
    'cashPaymentPrice',
    'totalExpectedPoints',
    'effectivePrice',
    'dealType',
    'liveId',
  ]) {
    assert.match(schema, new RegExp(`\\b${field}:`), `Action schema must expose ${field}`);
  }
});

test('Custom GPT contract preserves resolved product identity across follow-up turns', () => {
  const schema = readFileSync('openapi/korea-web-agent-action.yaml', 'utf8');
  const config = readFileSync('docs/custom-gpt-config.md', 'utf8');
  assert.match(schema, /conversation context/i);
  assert.match(schema, /brand.*model.*variant/i);
  assert.match(config, /follow-up turn/i);
  assert.match(config, /full resolved product identity/i);
});

test('agent functions use Action key auth and never authenticate with relay secret', () => {
  for (const path of ['netlify/functions/agent-research.mjs', 'netlify/functions/agent-job.mjs']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /KWA_ACTION_API_KEY/);
    assert.match(source, /actionAuthorized/);
    assert.doesNotMatch(source, /actionAuthorized\([^\n]*KWA_RELAY_SECRET/);
  }
});
