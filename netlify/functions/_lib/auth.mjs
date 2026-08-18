function constantTimeEqual(leftValue, rightValue) {
  const left = new TextEncoder().encode(leftValue);
  const right = new TextEncoder().encode(rightValue);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}

function bearerCandidate(request) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const candidate = header.slice('Bearer '.length).trim();
  return candidate || null;
}

export function relayAuthorized(request, secret) {
  if (!secret || secret.length < 16) return false;
  const candidate = bearerCandidate(request);
  return candidate ? constantTimeEqual(candidate, secret) : false;
}

export function actionAuthConfigured(secret) {
  return typeof secret === 'string' && secret.length >= 24;
}

export function actionAuthorized(request, secret) {
  if (!actionAuthConfigured(secret)) return false;
  const candidate = bearerCandidate(request);
  return candidate ? constantTimeEqual(candidate, secret) : false;
}
