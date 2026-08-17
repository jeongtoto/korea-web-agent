import type { NormalizedTarget } from '../core/types.ts';

const NAVER_PRODUCT_HOSTS = new Set([
  'brand.naver.com',
  'smartstore.naver.com',
  'm.smartstore.naver.com',
]);

export function parseNaverProductUrl(input: string): NormalizedTarget | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!NAVER_PRODUCT_HOSTS.has(host)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const productsIndex = segments.indexOf('products');
  if (productsIndex < 1 || productsIndex + 1 >= segments.length) return null;

  const brand = segments[productsIndex - 1];
  const productId = segments[productsIndex + 1];
  if (!brand || !productId || !/^\d+$/.test(productId)) return null;

  const canonicalUrl = `${url.protocol}//${host}/${encodeURIComponent(brand)}/products/${productId}`;

  return {
    kind: 'product',
    brand: decodeURIComponent(brand),
    productId,
    sourceHost: host,
    canonicalUrl,
  };
}
