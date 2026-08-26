import { isRelayDomainAllowed } from '../core/policy.ts';
import type { ExtractedSellerLink } from './market-extractor.ts';

function attr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  return pattern.exec(attrs)?.[1];
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function numericWon(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{1,3}(?:,\d{3})+|\d{4,})\s*(?:원|KRW)?/i);
  if (!match?.[1]) return undefined;
  const number = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function knownCommerceHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (isRelayDomainAllowed(host)) return true;
  return host === 'e-himart.co.kr'
    || host.endsWith('.e-himart.co.kr')
    || host === 'store.kakao.com'
    || host.endsWith('.store.kakao.com')
    || host === 'toss.im'
    || host.endsWith('.toss.im');
}

export function extractComparisonSellerLinks(
  html: string,
  baseUrl: URL,
): ExtractedSellerLink[] {
  const links: ExtractedSellerLink[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchor)) {
    const attrs = `${match[1] ?? ''} ${match[3] ?? ''}`;
    const rawHref = match[2];
    if (!rawHref) continue;
    let url: URL;
    try {
      url = new URL(rawHref.replace(/&amp;/gi, '&'), baseUrl);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;

    const sameHost = url.hostname.toLowerCase() === baseUrl.hostname.toLowerCase();
    const sellerBridge = sameHost && /(bridge|redirect|outlink|seller|shop|linkprice|mall)/i.test(`${url.pathname}${url.search}`);
    if (sameHost && !sellerBridge) continue;

    const label = stripTags(match[4] ?? '');
    const sellerName = attr(attrs, 'data-seller-name') ?? attr(attrs, 'data-mall-name') ?? attr(attrs, 'title');
    const advertisedPrice = numericWon(attr(attrs, 'data-price')) ?? numericWon(label);
    const attributable = sellerBridge || Boolean(sellerName) || advertisedPrice !== undefined || knownCommerceHost(url.hostname);
    if (!attributable) continue;

    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const advertisedShipping = /(?:무료\s*배송|무료배송|배송비\s*[:：]?\s*0\s*원)/i.test(label) ? 0 : undefined;
    links.push({
      url: key,
      ...(sellerName ? { sellerName } : {}),
      ...(advertisedPrice !== undefined ? { advertisedPrice } : {}),
      ...(advertisedShipping !== undefined ? { advertisedShipping } : {}),
    });
  }
  return links;
}

export function isComparisonPortalHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'danawa.com'
    || host.endsWith('.danawa.com')
    || host === 'enuri.com'
    || host.endsWith('.enuri.com')
    || host === 'shopping.naver.com'
    || host.endsWith('.shopping.naver.com');
}
