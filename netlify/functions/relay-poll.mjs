import { pollPersistentRelay } from '../../dist/src/cloud/relay-state.js';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { relayAuthorized } from './_lib/auth.mjs';
import { json } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const secret = process.env.KWA_RELAY_SECRET || '';
  if (!relayAuthorized(request, secret)) return json({ error: 'unauthorized' }, 401);
  const job = await pollPersistentRelay(getKoreaWebAgentStore());
  if (!job) return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  return json(job);
};
