import { getPersistentRelayStatus } from '../../dist/src/cloud/relay-state.js';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { json } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const configured = Boolean(process.env.KWA_RELAY_SECRET && process.env.KWA_RELAY_SECRET.length >= 16);
  if (!configured) return json({ enabled: false, online: false, lastSeenAt: null });
  const status = await getPersistentRelayStatus(getKoreaWebAgentStore());
  return json({ enabled: true, ...status });
};
