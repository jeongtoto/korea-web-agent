import type { NormalizedTarget } from '../core/types.ts';

const NAVER_PRODUCT_HOSTS = new Set([
  'brand.naver.com',
  'smartstore.naver.com',
  'm.smartstore.naver.com',
  'product.shoppinglive.naver.com',
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
  if (productsIndex < 0 || productsIndex + 1 >= segments.length) return null;

  const productId = segments[productsIndex + 1];
  if (!productId || !/^\d+$/.test(productId)) return null;

  if (host === 'product.shoppinglive.naver.com') {
    return {
      kind: 'product',
      productId,
      sourceHost: host,
      canonicalUrl: `${url.protocol}//${host}/products/${productId}`,
    };
  }

  if (productsIndex < 1) return null;
  const brand = segments[productsIndex - 1];
  if (!brand) return null;

  return {
    kind: 'product',
    brand: decodeURIComponent(brand),
    productId,
    sourceHost: host,
    canonicalUrl: `${url.protocol}//${host}/${encodeURIComponent(brand)}/products/${productId}`,
  };
}
