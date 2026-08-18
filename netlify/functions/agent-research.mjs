import { runAgentResearch, validateAgentResearchInput } from '../../dist/src/agent/research.js';
import { runResearch, createDefaultResearchDependencies } from '../../dist/src/orchestrator/research.js';
import { runCloudResearch } from '../../dist/src/cloud/research-service.js';
import { searchDuckDuckGo } from '../../dist/src/providers/duckduckgo.js';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { json, readJson } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let input;
  try {
    input = validateAgentResearchInput(await readJson(request, 16 * 1024));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  try {
    const store = getKoreaWebAgentStore();
    const result = await runAgentResearch(input, {
      publicSearch: (query) => searchDuckDuckGo(query),
      cloudResearch: (internalRequest, context) => runCloudResearch(internalRequest, {
        store,
        relaySecret: process.env.KWA_RELAY_SECRET,
        publicResearch: (publicRequest) => runResearch(
          publicRequest,
          createDefaultResearchDependencies({ relayClient: null }),
          context,
        ),
      }),
    });
    return json(result, result.status === 'running' ? 202 : 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
};
