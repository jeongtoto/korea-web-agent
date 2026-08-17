import type { SearchHit } from './index.ts';

function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstTitle(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return typeof value[0] === 'string' ? value[0].trim() : '';
}

function publishedYear(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const parts = (value as Record<string, unknown>)['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return '';
  const year = parts[0][0];
  return typeof year === 'number' && Number.isFinite(year) ? String(year) : '';
}

export async function searchCrossref(
  query: string,
  fetchImpl: typeof fetch = fetch,
  limit = 6,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const boundedLimit = Math.max(1, Math.min(10, Math.trunc(limit)));
  const endpoint = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=${boundedLimit}&sort=relevance&order=desc&select=DOI,title,published,publisher,abstract,type`;
  const response = await fetchImpl(endpoint, {
    headers: {
      accept: 'application/json',
      'user-agent': 'KoreaWebAgent/0.1 (research metadata client)',
    },
  });
  if (!response.ok) throw new Error(`Crossref search failed with HTTP ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const message = payload.message;
  if (!message || typeof message !== 'object') return [];
  const items = (message as Record<string, unknown>).items;
  if (!Array.isArray(items)) return [];

  const hits: SearchHit[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const doi = typeof item.DOI === 'string' ? item.DOI.trim() : '';
    const title = firstTitle(item.title);
    if (!doi || !title) continue;
    const year = publishedYear(item.published);
    const publisher = typeof item.publisher === 'string' ? item.publisher.trim() : '';
    const abstract = plainText(item.abstract).slice(0, 600);
    const snippet = [year, publisher, abstract].filter(Boolean).join(' · ');
    hits.push({
      title,
      url: `https://doi.org/${doi}`,
      snippet,
    });
    if (hits.length >= boundedLimit) break;
  }
  return hits;
}
