import test from 'node:test';
import assert from 'node:assert/strict';
import { searchDuckDuckGo } from '../src/providers/duckduckgo.ts';

const html = `
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Freview%3Fa%3D1">Long-term bed review</a>
  <a class="result__snippet">Used for 12 months &amp; still stable.</a>
</div>
<div class="result">
  <a class="result__a" href="https://www.youtube.com/watch?v=abc">Video review</a>
  <div class="result__snippet">Assembly and noise test</div>
</div>`;

test('searchDuckDuckGo returns normalized result URLs, titles and snippets', async () => {
  const fakeFetch: typeof fetch = async () => new Response(html, { status: 200 });
  const hits = await searchDuckDuckGo('밀도 침대 후기', fakeFetch);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.url, 'https://example.com/review?a=1');
  assert.equal(hits[0]?.title, 'Long-term bed review');
  assert.equal(hits[0]?.snippet, 'Used for 12 months & still stable.');
  assert.equal(hits[1]?.url, 'https://www.youtube.com/watch?v=abc');
});
