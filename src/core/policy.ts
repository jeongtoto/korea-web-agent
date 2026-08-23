const RELAY_ALLOWLIST = [
  'naver.com', 'coupang.com', 'kream.co.kr', 'danawa.com', 'enuri.com',
  '11st.co.kr', 'gmarket.co.kr', 'auction.co.kr', 'ssg.com', 'lotteon.com',
  'aliexpress.com', 'temu.com', 'daangn.com', 'joongna.com', 'bunjang.co.kr',
] as const;

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const nums = parts.map(Number);
  if (nums.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = nums as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!value.includes(':')) return false;
  if (value === '::1' || value === '::') return true;
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length);
    if (mapped.includes('.')) return isPrivateIpv4(mapped);
    const groups = mapped.split(':').filter(Boolean);
    if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) {
      const high = Number.parseInt(groups[0]!, 16);
      const low = Number.parseInt(groups[1]!, 16);
      const ipv4 = `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
      return isPrivateIpv4(ipv4);
    }
    return true;
  }
  return false;
}

export function assertPublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('A valid public URL is required');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL protocol is not allowed');
  }
  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not allowed');
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    isPrivateIpv4(hostname) ||
    isPrivateIpv6(hostname)
  ) {
    throw new Error('Private or local network URLs are not allowed');
  }

  return url;
}

export function isRelayDomainAllowed(hostname: string, allowlist: readonly string[] = RELAY_ALLOWLIST): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  return allowlist.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}
