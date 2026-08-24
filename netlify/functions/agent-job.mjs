import { shapeAgentResearchJob } from '../../dist/src/agent/research.js';
import { getAgentResearchJobState, getAgentResearchResult } from '../../dist/src/cloud/job-state.js';
import { getStoredResearchJob } from '../../dist/src/cloud/relay-state.js';
import { actionAuthConfigured, actionAuthorized } from './_lib/auth.mjs';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { json } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);

  const actionKey = Netlify.env.get('KWA_ACTION_API_KEY') || '';
  if (!actionAuthConfigured(actionKey)) return json({ error: 'Action API authentication is not configured' }, 503);
  if (!actionAuthorized(request, actionKey)) return json({ error: 'unauthorized' }, 401);

  const searchParams = new URL(request.url).searchParams;
  const id = searchParams.get('jobId') ?? searchParams.get('id');
  if (!id) return json({ error: 'jobId is required' }, 400);
  if (id.length > 200) return json({ error: 'jobId is invalid' }, 400);

  try {
    const store = getKoreaWebAgentStore();
    const rawJob = await getStoredResearchJob(store, id);
    if (rawJob) return json(shapeAgentResearchJob(rawJob));

    const result = await getAgentResearchResult(store, id);
    if (result) return json(result);

    const state = await getAgentResearchJobState(store, id);
    return state ? json(state) : json({ error: 'job not found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
};
