import { runResearch, createDefaultResearchDependencies } from '../../dist/src/orchestrator/research.js';
import { runCloudResearch } from '../../dist/src/cloud/research-service.js';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { json, readJson, validateResearchRequest } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let input;
  try { input = validateResearchRequest(await readJson(request)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 400); }

  try {
    const store = getKoreaWebAgentStore();
    const job = await runCloudResearch(input, {
      store,
      relaySecret: process.env.KWA_RELAY_SECRET,
      publicResearch: (publicRequest) => runResearch(publicRequest, createDefaultResearchDependencies({ relayClient: null })),
    });
    return json(job, job.status === 'running' ? 202 : 201);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
};
