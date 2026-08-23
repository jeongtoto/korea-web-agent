import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAuthenticatedFields, type BrowserDriver } from '../src/relay/playwright-adapter.ts';
import type { UnsignedRelayJob } from '../src/relay/protocol.ts';

function job(
  fields: string[] = ['title', 'price', 'membershipPrice', 'shippingEta'],
  url = 'https://brand.naver.com/mildo/products/7322162980',
): UnsignedRelayJob {
  const now = Date.now();
  return {
    id: 'relay-1',
    url,
    requestedFields: fields as never[],
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    nonce: 'nonce-123456789',
  };
}

class FakeDriver implements BrowserDriver {
  navigatedTo: string[] = [];
  reads: string[][] = [];
  async navigate(url: string): Promise<void> { this.navigatedTo.push(url); }
  async readText(selectors: readonly string[]): Promise<string | null> {
    this.reads.push([...selectors]);
    const key = selectors.join(' ');
    if (key.includes('h1')) return '밀도 원목 수납침대 K';
    if (key.includes('membership')) return '419,000원';
    if (key.includes('shipping')) return '8월 20일 도착 예정';
    if (key.includes('price')) return '439,000원';
    return null;
  }
  async close(): Promise<void> {}
}

class ShoppingLiveDriver implements BrowserDriver {
  navigatedTo: string[] = [];
  async navigate(url: string): Promise<void> { this.navigatedTo.push(url); }
  async readText(selectors: readonly string[]): Promise<string | null> {
    const key = selectors.join(' ');
    if (key.includes('ProductTitle')) return '와이드뷰 43인치 4K V3 스탠드';
    if (key.includes('CouponPrice')) return '399,000원 쿠폰 적용';
    if (key.includes('MembershipPrice')) return '409,000원 멤버십가';
    if (key.includes('ProductPrice')) return '439,000원';
    if (key.includes('RewardPoint')) return '12,000원 적립';
    if (key.includes('ShippingFee')) return '3,000원';
    if (key.includes('ShippingEta')) return '8월 20일 도착 예정';
    if (key.includes('SelectedOption')) return '43인치 / V3 스탠드';
    if (key.includes('Availability')) return '구매 가능';
    return null;
  }
  async close(): Promise<void> {}
}

class NaverLiveViewDriver implements BrowserDriver {
  navigatedTo: string[] = [];
  reads: string[][] = [];
  async navigate(url: string): Promise<void> { this.navigatedTo.push(url); }
  async readText(selectors: readonly string[]): Promise<string | null> {
    this.reads.push([...selectors]);
    if (!selectors.includes('body')) return null;
    return `
      최대 적립 포인트 64,200원
      무료배송
      총 금액 499,000원
      최대할인가 417,160원
      상품금액 720,000원
      판매자 즉시할인 -221,000원
      쿠폰할인(알림받기쿠폰) -59,880원
      카드사 결제할인(보유카드 기준) -21,960원
      최대할인가 417,160원
    `;
  }
  async close(): Promise<void> {}
}

class DelayedNaverLiveViewDriver implements BrowserDriver {
  navigatedTo: string[] = [];
  reads: string[][] = [];
  bodyReads = 0;
  async navigate(url: string): Promise<void> { this.navigatedTo.push(url); }
  async readText(selectors: readonly string[]): Promise<string | null> {
    this.reads.push([...selectors]);
    if (!selectors.includes('body')) return null;
    this.bodyReads += 1;
    if (this.bodyReads < 3) return null;
    return `
      상품금액 720,000원
      판매자 즉시할인 -221,000원
      쿠폰할인(알림받기쿠폰) -59,880원
      카드사 결제할인(보유카드 기준) -21,960원
      최대할인가 417,160원
      최대 적립 포인트 64,200원
      무료배송
    `;
  }
  async close(): Promise<void> {}
}

test('authenticated extraction only navigates and reads deterministic DOM fields', async () => {
  const driver = new FakeDriver();
  const result = await extractAuthenticatedFields(job(), driver);
  assert.deepEqual(driver.navigatedTo, ['https://brand.naver.com/mildo/products/7322162980']);
  assert.equal(result.title, '밀도 원목 수납침대 K');
  assert.equal(result.price, 439000);
  assert.equal(result.membershipPrice, 419000);
  assert.equal(result.shippingEta, '8월 20일 도착 예정');
  assert.ok(driver.reads.length >= 4);
});

test('Shopping Live extraction uses site-aware deterministic selectors for all read-only commerce fields', async () => {
  const url = 'https://product.shoppinglive.naver.com/products/11458011168';
  const driver = new ShoppingLiveDriver();
  const result = await extractAuthenticatedFields(job([
    'title', 'price', 'couponPrice', 'membershipPrice', 'estimatedPoints',
    'shippingFee', 'shippingEta', 'selectedOption', 'availability',
  ], url), driver);

  assert.deepEqual(driver.navigatedTo, [url]);
  assert.deepEqual(result, {
    title: '와이드뷰 43인치 4K V3 스탠드',
    price: 439000,
    couponPrice: 399000,
    membershipPrice: 409000,
    estimatedPoints: 12000,
    shippingFee: 3000,
    shippingEta: '8월 20일 도착 예정',
    selectedOption: '43인치 / V3 스탠드',
    availability: '구매 가능',
  });
});

test('Naver Shopping Live view extraction converts checkout labels into normalized live-deal economics without returning page text', async () => {
  const url = 'https://view.shoppinglive.naver.com/lives/1985890';
  const driver = new NaverLiveViewDriver();
  const result = await extractAuthenticatedFields(job(['liveDeal'], url), driver);

  assert.deepEqual(driver.navigatedTo, [url]);
  assert.deepEqual(result, {
    listPrice: 720000,
    sellerInstantDiscount: 221000,
    couponDiscount: 59880,
    cardInstantDiscount: 21960,
    couponPrice: 439120,
    cashPaymentPrice: 417160,
    salePrice: 417160,
    totalExpectedPoints: 64200,
    estimatedPoints: 64200,
    effectivePrice: 352960,
    shippingFee: 0,
    dealType: 'naver_shopping_live',
    liveId: '1985890',
  });
  assert.equal('bodyText' in result, false);
  assert.equal('rawText' in result, false);
  assert.deepEqual(driver.reads, [['body']]);
});

test('Naver Shopping Live view extraction waits for delayed SPA body content before giving up', async () => {
  const url = 'https://view.shoppinglive.naver.com/lives/1985890';
  const driver = new DelayedNaverLiveViewDriver();
  const result = await extractAuthenticatedFields(job(['liveDeal'], url), driver);

  assert.deepEqual(driver.navigatedTo, [url]);
  assert.equal(driver.bodyReads, 3);
  assert.equal(result.listPrice, 720000);
  assert.equal(result.cashPaymentPrice, 417160);
  assert.equal(result.totalExpectedPoints, 64200);
  assert.equal(result.effectivePrice, 352960);
  assert.equal(result.dealType, 'naver_shopping_live');
  assert.equal(result.liveId, '1985890');
});

test('mutation-like requested fields are rejected before browser navigation', async () => {
  const driver = new FakeDriver();
  await assert.rejects(extractAuthenticatedFields(job(['price', 'purchase']), driver), /read-only|field/i);
  assert.equal(driver.navigatedTo.length, 0);
});
