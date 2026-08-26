import type { SearchHit } from '../providers/index.ts';
import type { DiscoveryQuery, ShoppingRawHit, ShoppingResearchPlan } from './types.ts';

interface DiscoveryBucket {
  query: DiscoveryQuery;
  hits: SearchHit[];
}

export async function discoverShoppingCandidates(
  plan: ShoppingResearchPlan,
  search: (query: string) => Promise<SearchHit[]>,
): Promise<ShoppingRawHit[]> {
  const candidateQueries = plan.discoveryQueries.filter((query) => query.sourceGroup !== 'review');
  const buckets = await Promise.all(candidateQueries.map(async (query): Promise<DiscoveryBucket> => {
    try {
      const hits = await search(query.query);
      return { query, hits: hits.slice(0, Math.max(0, query.maxHits)) };
    } catch {
      return { query, hits: [] };
    }
  }));

  const output: ShoppingRawHit[] = [];
  const seenUrls = new Set<string>();
  let index = 0;

  while (output.length < plan.limits.rawHits) {
    let added = false;
    for (const bucket of buckets) {
      const hit = bucket.hits[index];
      if (!hit) continue;
      added = true;
      if (seenUrls.has(hit.url)) continue;
      seenUrls.add(hit.url);
      output.push({
        queryId: bucket.query.id,
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        sourceGroup: bucket.query.sourceGroup,
      });
      if (output.length >= plan.limits.rawHits) break;
    }
    if (!added) break;
    index += 1;
  }

  return output;
}
