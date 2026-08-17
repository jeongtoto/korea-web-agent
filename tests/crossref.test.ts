import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCrossref } from '../src/providers/crossref.ts';

test('searchCrossref returns DOI-backed academic evidence metadata', async () => {
  let requested = '';
  const fetchImpl = async (input: string | URL | Request) => {
    requested = String(input);
    return new Response(JSON.stringify({
      message: {
        items: [
          {
            DOI: '10.1000/example',
            title: ['Mattress firmness and sleep quality'],
            publisher: 'Example Publisher',
            published: { 'date-parts': [[2025, 2, 1]] },
            abstract: '<jats:p>Randomized trial of sleep ergonomics.</jats:p>',
            type: 'journal-article',
          },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const hits = await searchCrossref('bed sleep ergonomics', fetchImpl as typeof fetch);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.url, 'https://doi.org/10.1000/example');
  assert.match(hits[0]?.title ?? '', /Mattress firmness/);
  assert.match(hits[0]?.snippet ?? '', /2025/);
  assert.match(hits[0]?.snippet ?? '', /Randomized trial/);
  assert.match(requested, /api\.crossref\.org\/works/);
  assert.match(requested, /query\.bibliographic=bed%20sleep%20ergonomics/);
});

test('searchCrossref filters records without title or DOI and limits results', async () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    DOI: index === 0 ? undefined : `10.1000/${index}`,
    title: index === 1 ? [] : [`Paper ${index}`],
    published: { 'date-parts': [[2024]] },
  }));
  const fetchImpl = async () => new Response(JSON.stringify({ message: { items } }), { status: 200 });
  const hits = await searchCrossref('sleep', fetchImpl as typeof fetch, 5);
  assert.ok(hits.length <= 5);
  assert.ok(hits.every((hit) => hit.url.startsWith('https://doi.org/')));
});
