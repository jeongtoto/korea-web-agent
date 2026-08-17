import type { SearchHit } from './index.ts';

function decodeEntities(input: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return named[entity.toLowerCase()] ?? full;
  });
}

function text(input: string): string {
  return decodeEntities(input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function normalizeDdgUrl(href: string): string | null {
  const decoded = decodeEntities(href);
  const absolute = decoded.startsWith('//') ? `https:${decoded}` : decoded;
  try {
    const url = new URL(absolute);
    if (url.hostname.endsWith('duckduckgo.com') && url.pathname.startsWith('/l/')) {
      const target = url.searchParams.get('uddg');
      if (!target) return null;
      const targetUrl = new URL(target);
      if (!['http:', 'https:'].includes(targetUrl.protocol)) return null;
      return targetUrl.toString();
    }
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const resultRegex = /<div\b[^>]*class=["'][^"']*\bresult\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*\bresult\b|$)/gi;
  for (const blockMatch of html.matchAll(resultRegex)) {
    const block = blockMatch[1] ?? '';
    const anchor = block.match(/<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor?.[1] || !anchor[2]) continue;
    const url = normalizeDdgUrl(anchor[1]);
    if (!url) continue;
    const snippetMatch = block.match(/<(?:a|div|span)\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i);
    hits.push({
      title: text(anchor[2]),
      url,
      snippet: snippetMatch?.[1] ? text(snippetMatch[1]) : '',
    });
  }
  return hits.slice(0, 10);
}

export async function searchDuckDuckGo(query: string, fetchImpl: typeof fetch = fetch): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const response = await fetchImpl(endpoint, {
    headers: {
      'user-agent': 'KoreaWebAgent/0.1 (+public research; read-only)',
      accept: 'text/html',
    },
  });
  if (!response.ok) throw new Error(`Search failed with HTTP ${response.status}`);
  return parseDuckDuckGoHtml(await response.text());
}
