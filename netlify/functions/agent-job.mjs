import { shapeAgentResearchJob } from '../../dist/src/agent/research.js';
import { getStoredResearchJob } from '../../dist/src/cloud/relay-state.js';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { json } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);
  if (id.length > 200) return json({ error: 'id is invalid' }, 400);

  try {
    const job = await getStoredResearchJob(getKoreaWebAgentStore(), id);
    return job ? json(shapeAgentResearchJob(job)) : json({ error: 'job not found' }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 502);
  }
};
