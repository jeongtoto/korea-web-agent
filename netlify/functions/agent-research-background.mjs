import { runAgentResearch } from '../../dist/src/agent/research.js';
import {
  claimQueuedAgentResearch,
  failAgentResearchJob,
  finishAgentResearchJob,
  releaseAgentResearchInput,
} from '../../dist/src/cloud/job-state.js';
import { runResearch, createDefaultResearchDependencies } from '../../dist/src/orchestrator/research.js';
import { runCloudResearch } from '../../dist/src/cloud/research-service.js';
import { searchDuckDuckGo } from '../../dist/src/providers/duckduckgo.js';
import { actionAuthConfigured, actionAuthorized } from './_lib/auth.mjs';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { readJson } from './_lib/http.mjs';

export default async (request) => {
  if (request.method !== 'POST') return;

  const actionKey = Netlify.env.get('KWA_ACTION_API_KEY') || '';
  if (!actionAuthConfigured(actionKey) || !actionAuthorized(request, actionKey)) return;

  let jobId;
  try {
    const body = await readJson(request, 8 * 1024);
    jobId = typeof body?.jobId === 'string' ? body.jobId : '';
    if (!jobId) return;

    const store = getKoreaWebAgentStore();
    const input = await claimQueuedAgentResearch(store, jobId);
    if (!input) return;

    const result = await runAgentResearch(input, {
      publicSearch: (query) => searchDuckDuckGo(query),
      cloudResearch: (internalRequest, context) => runCloudResearch(internalRequest, {
        store,
        relaySecret: Netlify.env.get('KWA_RELAY_SECRET') || undefined,
        publicResearch: (publicRequest) => runResearch(
          publicRequest,
          createDefaultResearchDependencies({
            relayClient: null,
            idFactory: () => jobId,
          }),
          context,
        ),
      }),
    });

    if (result.status === 'running' || result.status === 'queued') {
      await releaseAgentResearchInput(store, jobId);
      return;
    }
    await finishAgentResearchJob(store, jobId, result);
  } catch (error) {
    if (jobId) {
      const store = getKoreaWebAgentStore();
      await failAgentResearchJob(store, jobId, error instanceof Error ? error.message : String(error)).catch(() => undefined);
    }
  }
};
