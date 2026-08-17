import { validateRelayRequest, type UnsignedRelayJob } from './protocol.ts';

export interface BrowserDriver {
  navigate(url: string): Promise<void>;
  readText(selectors: readonly string[]): Promise<string | null>;
  close(): Promise<void>;
}

const FIELD_SELECTORS: Record<string, readonly string[]> = {
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

export async function extractAuthenticatedFields(job: UnsignedRelayJob, driver: BrowserDriver): Promise<Record<string, unknown>> {
  validateRelayRequest(job);
  await driver.navigate(job.url);

  const output: Record<string, unknown> = {};
  for (const field of job.requestedFields) {
    const selectors = FIELD_SELECTORS[field];
    if (!selectors) throw new Error(`No read-only extractor for field: ${field}`);
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
  const page = context.pages()[0] ?? await context.newPage();

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
    async close() {
      await context.close();
    },
  };
}
