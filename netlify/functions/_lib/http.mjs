export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function readJson(request, maxBytes = 64 * 1024) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('Request body is too large');
  return text.trim() ? JSON.parse(text) : {};
}

export function validateResearchRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON object is required');
  if (typeof value.question !== 'string' || !value.question.trim()) throw new Error('question is required');
  if (value.question.length > 2_000) throw new Error('question is too long');
  if (value.url !== undefined && (typeof value.url !== 'string' || value.url.length > 4_000)) throw new Error('url is invalid');
  if (value.includeLocalRelay !== undefined && typeof value.includeLocalRelay !== 'boolean') throw new Error('includeLocalRelay must be boolean');
  const request = { question: value.question.trim() };
  if (typeof value.url === 'string' && value.url.trim()) request.url = value.url.trim();
  if (typeof value.includeLocalRelay === 'boolean') request.includeLocalRelay = value.includeLocalRelay;
  if (['product', 'place', 'service', 'auto'].includes(value.category)) request.category = value.category;
  return request;
}
