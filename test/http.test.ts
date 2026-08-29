import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWithPolicy } from '../src/infra/http.js';

test('fetchWithPolicy retries a transient 503 and succeeds', async () => {
  let calls = 0;
  const response = await fetchWithPolicy('https://example.test', {}, {
    fetchImpl: async () => {
      calls += 1;
      return new Response(calls === 1 ? 'temporary' : 'ok', { status: calls === 1 ? 503 : 200 });
    },
    sleep: async () => undefined,
    retries: 2,
  });

  assert.equal(await response.text(), 'ok');
  assert.equal(calls, 2);
});

test('fetchWithPolicy never retries a permanent 404', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithPolicy('https://example.test/missing', {}, {
      fetchImpl: async () => {
        calls += 1;
        return new Response('missing', { status: 404 });
      },
      sleep: async () => undefined,
      retries: 3,
    }),
    /HTTP 404/,
  );
  assert.equal(calls, 1);
});

test('fetchWithPolicy rejects redirects when redirect mode is manual', async () => {
  await assert.rejects(
    fetchWithPolicy('https://www.tokopedia.com/shop/item', { redirect: 'manual' }, {
      fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://127.0.0.1/private' } }),
      retries: 0,
    }),
    /HTTP 302/,
  );
});
