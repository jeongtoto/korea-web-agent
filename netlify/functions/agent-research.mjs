import { runAgentResearch, validateAgentResearchInput } from '../../dist/src/agent/research.js';
import { runResearch, createDefaultResearchDependencies } from '../../dist/src/orchestrator/research.js';
import { runCloudResearch } from '../../dist/src/cloud/research-service.js';
import { searchDuckDuckGo } from '../../dist/src/providers/duckduckgo.js';
import { actionAuthConfigured, actionAuthorized } from './_lib/auth.mjs';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { enrichWithPriceHistory } from './_lib/price-history.mjs';
import { redactForLog } from './_lib/redact.mjs';
import { json, readJson } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const actionKey = process.env.KWA_ACTION_API_KEY || '';
  if (!actionAuthConfigured(actionKey)) return json({ error: 'Action API authentication is not configured' }, 503);
  if (!actionAuthorized(request, actionKey)) return json({ error: 'unauthorized' }, 401);

  let input;
  try { input = validateAgentResearchInput(await readJson(request, 64 * 1024)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }

  try {
    const store = getKoreaWebAgentStore();
    const result = await runAgentResearch(input, {
      publicSearch: (query) => searchDuckDuckGo(query),
      cloudResearch: (internalRequest, context) => runCloudResearch(internalRequest, {
        store,
        relaySecret: process.env.KWA_RELAY_SECRET,
        publicResearch: (publicRequest) => runResearch(publicRequest, createDefaultResearchDependencies({ relayClient: null }), context),
      }),
    });
    const enriched = await enrichWithPriceHistory(store, result);
    return json(enriched, enriched.status === 'running' ? 202 : 200);
  } catch (error) {
    console.error('agent-research failed', redactForLog({ error: error instanceof Error ? error.message : String(error) }));
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
};
