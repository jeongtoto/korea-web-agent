import { completePersistentRelay, failPersistentRelay } from '../../dist/src/cloud/relay-state.js';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { relayAuthorized } from './_lib/auth.mjs';
import { json, readJson } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const secret = process.env.KWA_RELAY_SECRET || '';
  if (!relayAuthorized(request, secret)) return json({ error: 'unauthorized' }, 401);
  let payload;
  try { payload = await readJson(request, 32 * 1024); }
  catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }
  if (!payload || typeof payload !== 'object' || typeof payload.jobId !== 'string') return json({ error: 'jobId is required' }, 400);
  try {
    const store = getKoreaWebAgentStore();
    if (typeof payload.error === 'string') await failPersistentRelay(store, payload.jobId, payload.error);
    else await completePersistentRelay(store, payload.jobId, payload.result);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
};
