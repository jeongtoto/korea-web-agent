import { validateRelayRequest, type UnsignedRelayJob } from './protocol.ts';
import {
  hasManualVerificationChallenge,
  isNaverLiveCommerceReady,
  parseNaverLiveDeal,
  selectNaverLiveProductCard,
  type NaverLiveProductCard,
} from './naver-live.ts';
import { buildMarketOffer } from '../core/offer-engine.ts';
import type { NormalizedTarget } from '../core/types.ts';
import { assertPublicUrl, isRelayDomainAllowed } from '../core/policy.ts';

export interface BrowserDriver {
  navigate(url: string): Promise<void>;
  readText(selectors: readonly string[]): Promise<string | null>;
  readNaverLiveProductCards?(): Promise<NaverLiveProductCard[]>;
  openNaverLiveProductCard?(card: NaverLiveProductCard): Promise<void>;
  readPageText?(): Promise<string | null>;
  currentUrl?(): Promise<string>;
  close(): Promise<void>;
}

const GENERIC_FIELD_SELECTORS: Record<string, readonly string[]> = {
  title: ['h1', '[class*="product_title"]', '[class*="ProductTitle"]'],
  price: ['[class*="price"]', '[class*="Price"]', '[data-testid*="price"]'],
  couponPrice: ['[class*="coupon"] [class*="price"]', '[class*="Coupon"] [class*="Price"]', '[class*="benefit"] [class*="price"]'],
  membershipPrice: ['[class*="membership"] [class*="price"]', '[class*="member"] [class*="price"]', '[class*="Membership"] [class*="Price"]'],
  estimatedPoints: ['[class*="point"]', '[class*="Point"]', '[class*="reward"]'],
  shippingFee: ['[class*="shipping"] [class*="fee"]', '[class*="delivery"] [class*="fee"]'],
  shippingEta: ['[class*="shipping"]', '[class*="delivery"]', '[class*="Delivery"]'],
  selectedOption: ['[class*="option"] [class*="selected"]', '[class*="Option"] [aria-selected="true"]'],
  availability: ['[class*="stock"]', '[class*="availability"]', '[class*="soldout"]'],
};

type SiteSelectorMap = Partial<Record<string, readonly string[]>>;

const NAVER_COMMERCE_SELECTORS: SiteSelectorMap = {
  title: ['[class*="ProductTitle"]', '[class*="product_title"]', 'h1'],
  price: ['[class*="ProductPrice"]', '[class*="price"]', '[class*="Price"]'],
  couponPrice: ['[class*="CouponPrice"]', '[class*="coupon"] [class*="price"]', '[class*="benefit"] [class*="price"]'],
  membershipPrice: ['[class*="MembershipPrice"]', '[class*="membership"] [class*="price"]', '[class*="member"] [class*="price"]'],
  estimatedPoints: ['[class*="RewardPoint"]', '[class*="point"]', '[class*="reward"]'],
  shippingFee: ['[class*="ShippingFee"]', '[class*="shipping"] [class*="fee"]', '[class*="delivery"] [class*="fee"]'],
  shippingEta: ['[class*="ShippingEta"]', '[class*="shipping"]', '[class*="delivery"]'],
  selectedOption: ['[class*="SelectedOption"]', '[class*="option"] [class*="selected"]'],
  availability: ['[class*="Availability"]', '[class*="availability"]', '[class*="stock"]', '[class*="soldout"]'],
};

const COUPANG_SELECTORS: SiteSelectorMap = {
  title: ['h1', '[class*="prod-buy-header__title"]', '[class*="ProductTitle"]'],
  price: ['[class*="total-price"]', '[class*="sale-price"]', '[class*="Price"]'],
  couponPrice: ['[class*="coupon-price"]', '[class*="CouponPrice"]'],
  membershipPrice: ['[class*="wow-price"]', '[class*="member-price"]', '[class*="MembershipPrice"]'],
  estimatedPoints: ['[class*="cash-benefit"]', '[class*="reward"]', '[class*="RewardPoint"]'],
  shippingFee: ['[class*="shipping-fee"]', '[class*="delivery-fee"]', '[class*="ShippingFee"]'],
  shippingEta: ['[class*="delivery-date"]', '[class*="delivery"]', '[class*="ShippingEta"]'],
  selectedOption: ['[class*="option"] [class*="selected"]', '[class*="SelectedOption"]'],
  availability: ['[class*="out-of-stock"]', '[class*="stock"]', '[class*="Availability"]'],
};

const NAVER_LIVE_READ_INTERVAL_MS = 250;
const NAVER_LIVE_MAX_READ_ATTEMPTS = 33;

function siteSelectors(hostname: string): SiteSelectorMap | undefined {
  if (hostname === 'naver.com' || hostname.endsWith('.naver.com')) return NAVER_COMMERCE_SELECTORS;
  if (hostname === 'coupang.com' || hostname.endsWith('.coupang.com')) return COUPANG_SELECTORS;
  return undefined;
}

function selectorsFor(url: string, field: string): readonly string[] {
  let hostname = '';
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { /* validateRelayRequest already rejects malformed URLs */ }
  const specific = siteSelectors(hostname)?.[field] ?? [];
  const generic = GENERIC_FIELD_SELECTORS[field] ?? [];
  return [...new Set([...specific, ...generic])];
}

function parseKrw(text: string | null): number | undefined {
  if (!text) return undefined;
  const matches = [...text.matchAll(/(?:₩\s*)?([0-9][0-9,]{2,})\s*원?/g)];
  if (!matches.length) return undefined;
  const value = Number((matches[0]?.[1] ?? '').replace(/,/g, ''));
  return Number.isFinite(value) ? value : undefined;
}

function normalizeText(text: string | null): string | undefined {
  const normalized = text?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function naverLiveId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'view.shoppinglive.naver.com') return undefined;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const index = segments.indexOf('lives');
    const value = index >= 0 ? segments[index + 1] : undefined;
    return value && /^\d+$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isNaverLiveViewUrl(url: string): boolean {
  return naverLiveId(url) !== undefined;
}

async function waitForNaverLiveDetailText(driver: BrowserDriver): Promise<string | null> {
  let lastText: string | null = null;
  for (let attempt = 0; attempt < NAVER_LIVE_MAX_READ_ATTEMPTS; attempt += 1) {
    const pageText = driver.readPageText
      ? await driver.readPageText()
      : await driver.readText(['body']);
    if (pageText) lastText = pageText;
    if (hasManualVerificationChallenge(pageText)) {
      throw new Error('manual_verification_required: Complete CAPTCHA or manual verification in the dedicated browser profile.');
    }
    if (isNaverLiveCommerceReady(pageText)) return pageText;
    if (attempt + 1 < NAVER_LIVE_MAX_READ_ATTEMPTS) {
      await new Promise<void>((resolve) => setTimeout(resolve, NAVER_LIVE_READ_INTERVAL_MS));
    }
  }
  return lastText;
}

async function extractNaverLiveDeal(job: UnsignedRelayJob, driver: BrowserDriver): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < NAVER_LIVE_MAX_READ_ATTEMPTS; attempt += 1) {
    const liveText = await driver.readText(['body']);
    if (hasManualVerificationChallenge(liveText)) {
      throw new Error('manual_verification_required: Complete CAPTCHA or manual verification in the dedicated browser profile.');
    }
    if (liveText && isNaverLiveCommerceReady(liveText)) return parseNaverLiveDeal(job.url, liveText);

    if (job.targetHint && driver.readNaverLiveProductCards && driver.openNaverLiveProductCard) {
      const cards = await driver.readNaverLiveProductCards();
      if (cards.length) {
        const selected = selectNaverLiveProductCard(cards, job.targetHint);
        if (!selected) return parseNaverLiveDeal(job.url, '');
        await driver.openNaverLiveProductCard(selected);
        const detailText = await waitForNaverLiveDetailText(driver);
        const sourceUrl = driver.currentUrl ? await driver.currentUrl() : undefined;
        return parseNaverLiveDeal(job.url, `${selected.title}\n${detailText ?? ''}`, {
          title: selected.title,
          ...(sourceUrl ? { sourceUrl } : {}),
        });
      }
    }

    if (attempt + 1 < NAVER_LIVE_MAX_READ_ATTEMPTS) {
      await new Promise<void>((resolve) => setTimeout(resolve, NAVER_LIVE_READ_INTERVAL_MS));
    }
  }
  return parseNaverLiveDeal(job.url, '');
}

export async function extractAuthenticatedFields(job: UnsignedRelayJob, driver: BrowserDriver): Promise<Record<string, unknown>> {
  validateRelayRequest(job);
  await driver.navigate(job.url);
  if (driver.currentUrl) {
    const current = assertPublicUrl(await driver.currentUrl());
    if (!isRelayDomainAllowed(current.hostname)) throw new Error('Relay navigation left the allowlisted commerce domains');
  }

  const output: Record<string, unknown> = {};
  const naverLiveView = isNaverLiveViewUrl(job.url);
  for (const field of job.requestedFields) {
    if (naverLiveView) {
      if (field !== 'liveDeal') continue;
      Object.assign(output, await extractNaverLiveDeal(job, driver));
      continue;
    }
    if (field === 'liveDeal') continue;

    if (field === 'commerceOffer') {
      const hint = job.targetHint ?? {};
      const target: NormalizedTarget = {
        kind: 'product',
        ...(hint.brand ? { brand: hint.brand } : {}),
        ...(hint.name ? { name: hint.name } : {}),
        ...(hint.model ? { model: hint.model } : {}),
        ...(hint.variant ? { variant: hint.variant } : {}),
        ...(hint.productId ? { productId: hint.productId } : {}),
        ...(hint.liveId ? { liveId: hint.liveId } : {}),
      };
      let offer: ReturnType<typeof buildMarketOffer> = null;
      for (let attempt = 0; attempt < 20 && !offer; attempt += 1) {
        const title = normalizeText(await driver.readText(selectorsFor(job.url, 'title')));
        const pageText = driver.readPageText ? await driver.readPageText() : await driver.readText(['body']);
        if (hasManualVerificationChallenge(pageText)) {
          throw new Error('manual_verification_required: Complete CAPTCHA or manual verification in the dedicated browser profile.');
        }
        offer = buildMarketOffer({ title: title ?? hint.name ?? '상품', url: job.url, snippet: (pageText ?? '').slice(0, 250_000) }, target, new Date().toISOString());
        if (!offer && attempt < 19) await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
      if (offer) {
        output.title = offer.title;
        if (offer.listPrice !== undefined) output.listPrice = offer.listPrice;
        if (offer.salePrice !== undefined) output.price = offer.salePrice;
        if (offer.couponPrice !== undefined) output.couponPrice = offer.couponPrice;
        if (offer.membershipPrice !== undefined) output.membershipPrice = offer.membershipPrice;
        if (offer.cardPrice !== undefined) output.cardPrice = offer.cardPrice;
        if (offer.cardName) output.cardName = offer.cardName;
        if (offer.points !== undefined) output.estimatedPoints = offer.points;
        if (offer.shippingFee !== undefined) output.shippingFee = offer.shippingFee;
        if (offer.totalCashPrice !== undefined) output.totalCashPrice = offer.totalCashPrice;
        if (offer.effectivePrice !== undefined) output.effectivePrice = offer.effectivePrice;
        output.condition = offer.condition;
        output.bundleComplete = offer.bundleComplete;
        output.conditions = offer.conditions;
        output.riskFlags = offer.riskFlags;
      }
      continue;
    }

    const selectors = selectorsFor(job.url, field);
    if (!selectors.length) throw new Error(`No read-only extractor for field: ${field}`);
    const raw = await driver.readText(selectors);
    if (['price', 'couponPrice', 'membershipPrice', 'estimatedPoints', 'shippingFee'].includes(field)) {
      const value = parseKrw(raw);
      if (value !== undefined) output[field] = value;
    } else {
      const value = normalizeText(raw);
      if (value !== undefined) output[field] = value;
    }
  }
  return output;
}

export interface PlaywrightDriverOptions {
  profileDir: string;
  executablePath?: string;
  headless?: boolean;
}

export async function createPlaywrightBrowserDriver(options: PlaywrightDriverOptions): Promise<BrowserDriver> {
  const moduleName = 'playwright-core';
  let playwright: any;
  try {
    playwright = await import(moduleName);
  } catch {
    throw new Error('playwright-core is not installed. Install it locally before enabling authenticated browser extraction.');
  }

  const launchOptions: Record<string, unknown> = {
    headless: options.headless ?? false,
  };
  if (options.executablePath) launchOptions.executablePath = options.executablePath;

  const context = await playwright.chromium.launchPersistentContext(options.profileDir, launchOptions);
  let page = context.pages()[0] ?? await context.newPage();

  function validatedProductDestination(value: string | null): string | null {
    if (!value) return null;
    try {
      const parsed = new URL(value, page.url());
      if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'product.shoppinglive.naver.com') return null;
      if (parsed.pathname !== '/bridge/v4/product/shopping') return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  return {
    async navigate(url: string) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    },
    async readText(selectors: readonly string[]) {
      for (const selector of selectors) {
        try {
          const locator = page.locator(selector).first();
          const count = await locator.count();
          if (!count) continue;
          const value = await locator.textContent({ timeout: 1_500 });
          if (typeof value === 'string' && value.trim()) return value;
        } catch {
          // Try the next deterministic selector; no page-provided instruction is executed.
        }
      }
      return null;
    },
    async readNaverLiveProductCards() {
      const links = page.locator('a[href*="product.shoppinglive.naver.com/bridge/v4/product/shopping"]');
      const count = Math.min(await links.count(), 100);
      const cards: NaverLiveProductCard[] = [];
      for (let index = 0; index < count; index += 1) {
        const link = links.nth(index);
        try {
          if (!await link.isVisible()) continue;
          const destinationUrl = validatedProductDestination(await link.getAttribute('href'));
          if (!destinationUrl) continue;
          let title = (await link.textContent({ timeout: 1_500 }) ?? '').replace(/\s+/g, ' ').trim();
          let ancestor = link;
          for (let depth = 0; depth < 8 && (!title || title === '상품 상세 페이지' || !/원/.test(title)); depth += 1) {
            ancestor = ancestor.locator('xpath=..');
            const candidate = (await ancestor.textContent({ timeout: 1_500 }) ?? '').replace(/\s+/g, ' ').trim();
            if (candidate.length >= 20 && candidate.length <= 700) title = candidate;
          }
          if (!title || title.length > 700) continue;
          cards.push({ locatorIndex: index, title, destinationUrl });
        } catch {
          // Ignore a card that disappears while the SPA updates; only stable deterministic cards are candidates.
        }
      }
      return cards;
    },
    async openNaverLiveProductCard(card: NaverLiveProductCard) {
      const links = page.locator('a[href*="product.shoppinglive.naver.com/bridge/v4/product/shopping"]');
      if (card.locatorIndex < 0 || card.locatorIndex >= await links.count()) throw new Error('Naver Live product card is no longer available');
      const link = links.nth(card.locatorIndex);
      if (!await link.isVisible()) throw new Error('Naver Live product card is no longer visible');
      const destinationUrl = validatedProductDestination(await link.getAttribute('href'));
      if (!destinationUrl || destinationUrl !== card.destinationUrl) throw new Error('Naver Live product card destination changed before navigation');

      const newPagePromise = context.waitForEvent('page', { timeout: 7_000 }).catch(() => null);
      await link.click({ timeout: 15_000 });
      const openedPage = await newPagePromise;
      if (openedPage) page = openedPage;
      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
    },
    async readPageText() {
      const texts: string[] = [];
      for (const frame of page.frames()) {
        try {
          const value = await frame.locator('body').textContent({ timeout: 2_000 });
          if (typeof value === 'string' && value.trim()) texts.push(value);
        } catch {
          // Cross-origin or transient frames are skipped; no frame content is returned to cloud.
        }
      }
      return texts.length ? texts.join('\n') : null;
    },
    async currentUrl() {
      return page.url();
    },
    async close() {
      await context.close();
    },
  };
}
