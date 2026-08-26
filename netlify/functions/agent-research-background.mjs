import { runAgentResearch } from '../../dist/src/agent/research.js';
import {
  claimQueuedAgentResearch,
  failAgentResearchJob,
  finishAgentResearchJob,
  releaseAgentResearchInput,
} from '../../dist/src/cloud/job-state.js';
import { runResearch, createDefaultResearchDependencies } from '../../dist/src/orchestrator/research.js';
import { runCloudResearch } from '../../dist/src/cloud/research-service.js';
import { fetchDirectPage } from '../../dist/src/providers/direct-page.js';
import { searchDuckDuckGo } from '../../dist/src/providers/duckduckgo.js';
import { runShoppingResearch } from '../../dist/src/shopping/shopping-orchestrator.js';
import { actionAuthConfigured, actionAuthorized } from './_lib/auth.mjs';
import { getKoreaWebAgentStore } from './_lib/store.mjs';
import { readJson } from './_lib/http.mjs';

function exactTargetFor(candidate) {
  const target = {
    kind: 'product',
    name: candidate.title,
  };
  if (candidate.brand) target.brand = candidate.brand;
  if (candidate.model) target.model = candidate.model;
  if (candidate.sourceUrls?.[0]) target.canonicalUrl = candidate.sourceUrls[0];
  return target;
}

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
    const exactPriceCache = new Map();

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
      shoppingResearch: (query, purchaseContext) => runShoppingResearch(query, purchaseContext, {
        publicSearch: (searchQuery) => searchDuckDuckGo(searchQuery),
        directPage: (url) => fetchDirectPage(url),
        now: () => new Date(),
        personalizationAvailable: false,
        priceVerifier: async (assessment, scope) => {
          const candidate = assessment.candidate;
          let exact = exactPriceCache.get(candidate.key);
          if (!exact) {
            const exactRequest = {
              question: `${candidate.title} 현재 신품 가격과 배송비 포함 실결제가를 검증해줘`,
              category: 'product',
              includeLocalRelay: false,
            };
            if (purchaseContext) exactRequest.purchaseContext = purchaseContext;
            if (candidate.sourceUrls?.[0]) exactRequest.url = candidate.sourceUrls[0];
            const target = exactTargetFor(candidate);
            exact = runResearch(
              exactRequest,
              createDefaultResearchDependencies({
                relayClient: null,
                idFactory: () => `${jobId}-${candidate.key}`.slice(0, 180),
              }),
              {
                identityConfidence: Math.max(0.65, assessment.confidenceDimensions.identity),
                resolvedTarget: target,
                resolutionAmbiguous: false,
              },
            );
            exactPriceCache.set(candidate.key, exact);
          }
          const exactJob = await exact;
          return {
            candidateKey: candidate.key,
            scope,
            offers: exactJob.report?.offers ?? [],
            errors: exactJob.errors ?? [],
          };
        },
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
