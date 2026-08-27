import { assertPublicUrl } from '../core/policy.ts';

export interface SellerRedirectResult {
  originalUrl: string;
  resolvedUrl?: string;
  hops: string[];
  status: 'resolved' | 'not_redirect' | 'failed';
  error?: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Seller redirect resolution failed';
}

export async function resolveSellerRedirect(
  input: string,
  fetchImpl: typeof fetch = fetch,
  maxRedirects = 5,
): Promise<SellerRedirectResult> {
  const originalUrl = input;
  const hops: string[] = [];
  try {
    let current = assertPublicUrl(input).toString();
    const seen = new Set<string>();
    let redirected = false;
    let redirectCount = 0;

    while (true) {
      if (seen.has(current)) {
        return { originalUrl, hops, status: 'failed', error: 'Redirect loop detected' };
      }
      seen.add(current);
      hops.push(current);

      const response = await fetchImpl(current, {
        redirect: 'manual',
        headers: {
          'user-agent': 'KoreaWebAgent/0.1 (+public research; read-only)',
          accept: 'text/html,application/xhtml+xml',
        },
      });

      if (!REDIRECT_STATUSES.has(response.status)) {
        if (response.status >= 400) {
          return {
            originalUrl,
            hops,
            status: 'failed',
            error: `Redirect endpoint HTTP ${response.status}`,
          };
        }
        return redirected
          ? { originalUrl, resolvedUrl: current, hops, status: 'resolved' }
          : { originalUrl, hops, status: 'not_redirect' };
      }

      if (redirectCount >= maxRedirects) {
        return { originalUrl, hops, status: 'failed', error: 'Too many redirects' };
      }

      const location = response.headers.get('location');
      if (!location) {
        return { originalUrl, hops, status: 'failed', error: 'Redirect response is missing Location' };
      }

      current = assertPublicUrl(new URL(location, current).toString()).toString();
      redirectCount += 1;
      redirected = true;
    }
  } catch (error) {
    return { originalUrl, hops, status: 'failed', error: errorMessage(error) };
  }
}
