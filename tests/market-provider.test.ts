import test from 'node:test';
import assert from 'node:assert/strict';

test('required market provider registry exposes approved 13-channel order and budgets', async () => {
  let registry: any;
  try {
    registry = await import('../src/providers/provider-registry.ts');
  } catch {
    assert.fail('provider registry module should exist');
  }

  assert.deepEqual(registry.listMarketProviders().map((provider: any) => provider.id), [
    'naver-shopping',
    'coupang',
    'danawa',
    'enuri',
    '11st',
    'gmarket',
    'auction',
    'ssg',
    'lotteon',
    'himart',
    'official',
    'kakao-talkdeal',
    'toss-shopping',
  ]);

  assert.deepEqual(registry.providerById('danawa')?.budget, {
    discovery: 5,
    verification: 2,
    sellerExpansion: 6,
  });
  assert.deepEqual(registry.providerById('naver-shopping')?.budget, {
    discovery: 8,
    verification: 5,
    sellerExpansion: 5,
  });
});
