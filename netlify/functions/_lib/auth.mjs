export function relayAuthorized(request, secret) {
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return false;
  const candidate = header.slice('Bearer '.length);
  const left = new TextEncoder().encode(candidate);
  const right = new TextEncoder().encode(secret);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
