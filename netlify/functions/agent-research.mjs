import { validateAgentResearchInput } from '../../dist/src/agent/research.js';
import { createQueuedAgentResearch, failAgentResearchJob } from '../../dist/src/cloud/job-state.js';
import { actionAuthConfigured, actionAuthorized } from './_lib/auth.mjs';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { json, readJson } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const actionKey = Netlify.env.get('KWA_ACTION_API_KEY') || '';
  if (!actionAuthConfigured(actionKey)) return json({ error: 'Action API authentication is not configured' }, 503);
  if (!actionAuthorized(request, actionKey)) return json({ error: 'unauthorized' }, 401);

  let input;
  try {
    input = validateAgentResearchInput(await readJson(request, 64 * 1024));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  const store = getKoreaWebAgentStore();
  let queued;
  try {
    queued = await createQueuedAgentResearch(store, input);
    const dispatchUrl = new URL('/.netlify/functions/agent-research-background', request.url).toString();
    const authorization = request.headers.get('authorization') || '';
    const response = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jobId: queued.jobId }),
    });
    if (response.status !== 202) {
      await failAgentResearchJob(store, queued.jobId, `Background dispatch failed with HTTP ${response.status}`);
      return json({ error: 'background research dispatch failed', jobId: queued.jobId }, 502);
    }
    return json(queued, 202);
  } catch (error) {
    if (queued?.jobId) {
      await failAgentResearchJob(store, queued.jobId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    }
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
};
