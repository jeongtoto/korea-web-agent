const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|token|secret|api[_-]?key|ownedcards|memberships|budget|region|preferences|purchasecontext)$/i;

export function redactForLog(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactForLog(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactForLog(item, seen);
  }
  return output;
}
