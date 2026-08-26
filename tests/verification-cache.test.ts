import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerificationCache } from '../src/providers/verification-cache.ts';

test('equivalent seller URLs share one in-flight loader', async () => {
  const cache = createVerificationCache<number>();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const loader = async () => {
    calls += 1;
    await gate;
    return 42;
  };

  const first = cache.getOrLoad('https://www.11st.co.kr/products/1?option=V3&utm_source=x', loader);
  const second = cache.getOrLoad('https://www.11st.co.kr/products/1?option=V3&NaPm=y', loader);
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [42, 42]);
});

test('rejected loader is evicted so a later retry may execute again', async () => {
  const cache = createVerificationCache<number>();
  let calls = 0;
  const url = 'https://www.11st.co.kr/products/1?option=V3';

  await assert.rejects(cache.getOrLoad(url, async () => {
    calls += 1;
    throw new Error('temporary failure');
  }));

  assert.equal(await cache.getOrLoad(url, async () => {
    calls += 1;
    return 7;
  }), 7);
  assert.equal(calls, 2);
});
