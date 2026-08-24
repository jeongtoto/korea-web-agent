import test from 'node:test';
import assert from 'node:assert/strict';
import { redactForLog } from '../netlify/functions/_lib/redact.mjs';

test('recursively masks purchase context and credential-like fields', () => {
  const redacted = redactForLog({
    authorization: 'Bearer secret',
    nested: {
      purchaseContext: {
        ownedCards: ['삼성카드'], memberships: ['네이버플러스'], budget: 300000,
        region: '서울', preferences: ['화이트'],
      },
      harmless: 'ok',
    },
  });
  const text = JSON.stringify(redacted);
  assert.equal(text.includes('삼성카드'), false);
  assert.equal(text.includes('네이버플러스'), false);
  assert.equal(text.includes('300000'), false);
  assert.equal(text.includes('Bearer secret'), false);
  assert.equal((redacted as any).nested.harmless, 'ok');
});

test('does not mutate the original diagnostic object', () => {
  const original = { purchaseContext: { ownedCards: ['신한카드'] }, message: 'safe' };
  const copy = JSON.stringify(original);
  redactForLog(original);
  assert.equal(JSON.stringify(original), copy);
});
