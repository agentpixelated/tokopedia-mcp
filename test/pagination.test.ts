import assert from 'node:assert/strict';
import test from 'node:test';

import { collectPages } from '../src/domain/pagination.js';

test('collectPages canonicalizes identities, deduplicates cross-page results, and reports counts', async () => {
  const pages = [
    {
      items: [
        { productId: '1', url: 'https://www.tokopedia.com/shop/item?utm_source=x', title: 'A' },
        { productId: '', url: 'https://www.tokopedia.com/shop/other?src=one', title: 'B' },
      ],
      hasMore: true,
    },
    {
      items: [
        { productId: '1', url: 'https://www.tokopedia.com/shop/item?utm_source=y', title: 'A changed rank' },
        { productId: '', url: 'https://www.tokopedia.com/shop/other?src=two', title: 'B again' },
        { productId: '3', url: 'https://www.tokopedia.com/shop/third', title: 'C' },
      ],
      hasMore: false,
    },
  ];

  const result = await collectPages(async (page) => pages[page - 1], { maxPages: 5 });

  assert.deepEqual(result.items.map((item) => item.title), ['A', 'B', 'C']);
  assert.deepEqual(result.pagination, {
    pagesFetched: 2,
    fetchedCount: 5,
    returnedCount: 3,
    dedupedCount: 2,
    hasMore: false,
    stopReason: 'source_exhausted',
  });
});

test('collectPages stops on a repeated page fingerprint', async () => {
  let calls = 0;
  const result = await collectPages(async () => {
    calls += 1;
    return {
      items: [{ productId: '1', url: 'https://www.tokopedia.com/shop/item', title: 'A' }],
      hasMore: true,
    };
  }, { maxPages: 10 });

  assert.equal(calls, 2);
  assert.equal(result.pagination.stopReason, 'repeated_page');
  assert.equal(result.pagination.hasMore, true);
});


test('collectPages reports max-pages stop without claiming exhaustion', async () => {
  const result = await collectPages(async (page) => ({
    items: [{ productId: String(page), url: `https://www.tokopedia.com/shop/item-${page}`, title: String(page) }],
    hasMore: true,
  }), { maxPages: 2 });

  assert.equal(result.pagination.pagesFetched, 2);
  assert.equal(result.pagination.stopReason, 'max_pages');
  assert.equal(result.pagination.hasMore, true);
});
