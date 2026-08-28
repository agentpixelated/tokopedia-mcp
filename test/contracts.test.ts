import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSearchParams,
  normalizeSearchResult,
  type RawSearchResponse,
} from '../src/domain/search.js';

test('buildSearchParams is deterministic and preserves exact filters', () => {
  const result = buildSearchParams({
    query: 'thinkpad x390 yoga',
    page: 2,
    limit: 24,
    sort: 'most_sold',
    priceMin: 3_000_000,
    priceMax: 5_000_000,
    filters: { condition: '2', rt: '4,5' },
  });

  assert.equal(
    result,
    'device=desktop&enter_method=normal_search&ob=8&page=2&q=thinkpad+x390+yoga&pmin=3000000&pmax=5000000&rows=24&safe_search=false&source=search&st=product&start=24&condition=2&rt=4%2C5',
  );
});

test('normalizeSearchResult returns an auditable envelope and next cursor', () => {
  const raw: RawSearchResponse = {
    data: {
      searchProductV5: {
        header: {
          totalData: 25,
          responseCode: 'SUCCESS',
          keywordProcess: 'thinkpad x390 yoga',
        },
        data: {
          products: [
            {
              id: '10',
              name: 'ThinkPad X390 Yoga i5 16/256',
              url: 'https://www.tokopedia.com/shop/item?extParam=tracking',
              price: { text: 'Rp3.920.000', number: 3_920_000, original: '', discountPercentage: 0 },
              rating: '4.9',
              shop: { id: '20', name: 'Shop', url: 'https://www.tokopedia.com/shop', city: 'Jakarta', tier: 3 },
            },
          ],
        },
      },
    },
  };

  const result = normalizeSearchResult(raw, {
    query: 'thinkpad x390 yoga',
    page: 1,
    limit: 24,
    sort: 'relevance',
  }, new Date('2026-08-28T10:00:00.000Z'));

  assert.equal(result.items[0].url, 'https://www.tokopedia.com/shop/item');
  assert.equal(result.items[0].price.value, 3_920_000);
  assert.equal(result.items[0].shop.tier, 'power');
  assert.equal(result.page.nextPage, 2);
  assert.deepEqual(result.provenance, {
    source: 'tokopedia_graphql',
    operation: 'SearchProductV5Query',
    retrievedAt: '2026-08-28T10:00:00.000Z',
    freshness: 'live',
  });
});

test('normalizeSearchResult ignores Tokopedia keywordProcess sentinel zero', () => {
  const raw: RawSearchResponse = {
    data: {
      searchProductV5: {
        header: { totalData: 0, responseCode: 'SUCCESS', keywordProcess: '0' },
        data: { products: [] },
      },
    },
  };

  const result = normalizeSearchResult(raw, { query: 'thinkpad yoga' });
  assert.equal(result.query, 'thinkpad yoga');
});
