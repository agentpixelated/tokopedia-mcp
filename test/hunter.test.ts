import assert from 'node:assert/strict';
import test from 'node:test';

import { huntProducts } from '../src/service/hunter.js';
import type { TokopediaGateway } from '../src/service/gateway.js';

const gateway: TokopediaGateway = {
  async search(input) {
    return {
      query: input.query,
      items: [
        {
          productId: 'parent-1', title: 'ThinkPad X390 Yoga', url: 'https://www.tokopedia.com/shop/x390',
          price: { currency: 'IDR', value: 3_500_000, formatted: 'Rp3.500.000', originalFormatted: null, discountPercentage: 0 },
          rating: 4.9,
          shop: { shopId: 's1', name: 'Shop', url: 'https://www.tokopedia.com/shop', city: 'Jakarta', tier: 'power' },
        },
      ],
      page: { number: 1, limit: 5, returned: 1, total: 1, nextPage: null },
      provenance: { source: 'tokopedia_graphql', operation: 'SearchProductV5Query', retrievedAt: '2026-08-28T10:00:00.000Z', freshness: 'live' },
    };
  },
  async inspectProduct() {
    return {
      snapshot: {
        listing: {
          productId: 'parent-1', parentId: 'parent', title: 'ThinkPad X390 Yoga 16GB',
          url: 'https://www.tokopedia.com/shop/x390',
          displayPrice: { currency: 'IDR', value: 3_500_000, formatted: 'Rp3.500.000' },
          condition: 'USED', status: 'ACTIVE', shop: { shopId: 's1', name: 'Shop' },
          rating: 4.9, reviewCount: 20, soldText: '30',
        },
        description: 'i5-8265U RAM 16GB touchscreen stylus', specs: [],
        skus: [
          { productId: 'sku-low', title: 'X390 Yoga 8GB', url: 'https://www.tokopedia.com/shop/x390-8', price: { currency: 'IDR', value: 3_500_000, formatted: 'Rp3.500.000' }, options: [{ axis: 'RAM', value: '8GB' }], stock: { value: 2, status: 'in_stock' }, buyable: true, cod: true },
          { productId: 'sku-good', title: 'X390 Yoga 16GB', url: 'https://www.tokopedia.com/shop/x390-16', price: { currency: 'IDR', value: 3_920_000, formatted: 'Rp3.920.000' }, options: [{ axis: 'RAM', value: '16GB' }], stock: { value: 4, status: 'in_stock' }, buyable: true, cod: true },
        ],
        provenance: { source: 'tokopedia_product_page', retrievedAt: '2026-08-28T10:01:00.000Z', freshness: 'live' },
      },
      analysis: {
        issues: [], confidence: 'high',
        priceRange: { min: 3_500_000, max: 3_920_000, currency: 'IDR' },
        verificationQuestions: ['Confirm exact unit.'],
      },
    };
  },
};

test('huntProducts discovers listings, expands SKUs, and ranks only matching concrete variants', async () => {
  const result = await huntProducts(gateway, {
    queries: ['thinkpad x390 yoga'], listingsPerQuery: 5, maxListingsToInspect: 5,
    criteria: { priceMin: 3_000_000, priceMax: 5_000_000, minRamGb: 16, mustInclude: ['yoga'], limit: 5 },
  });

  assert.equal(result.shortlist.ranked.length, 1);
  assert.equal(result.shortlist.ranked[0].skuId, 'sku-good');
  assert.equal(result.shortlist.ranked[0].shopTransactions, null);
  assert.equal(result.shortlist.ranked[0].productSoldCount, 30);
  assert.equal(result.shortlist.rejected.some((item) => item.skuId === 'sku-low'), true);
  assert.equal(result.inspectedListings, 1);
  assert.deepEqual(result.failures, []);
});

test('huntProducts deduplicates the same listing returned by multiple queries', async () => {
  let inspections = 0;
  const countingGateway: TokopediaGateway = {
    ...gateway,
    async inspectProduct(url) {
      inspections += 1;
      return gateway.inspectProduct(url);
    },
  };
  await huntProducts(countingGateway, {
    queries: ['x390 yoga', 'thinkpad x390'], listingsPerQuery: 5, maxListingsToInspect: 5,
    criteria: { limit: 5 },
  });
  assert.equal(inspections, 1);
});

test('huntProducts bounds concurrent product-page inspections', async () => {
  let active = 0;
  let peak = 0;
  const manyGateway: TokopediaGateway = {
    ...gateway,
    async search(input) {
      const result = await gateway.search(input);
      return {
        ...result,
        items: Array.from({ length: 6 }, (_, index) => ({
          ...result.items[0],
          productId: `parent-${index}`,
          url: `https://www.tokopedia.com/shop/x390-${index}`,
        })),
      };
    },
    async inspectProduct(url) {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const result = await gateway.inspectProduct(url);
      return {
        ...result,
        snapshot: {
          ...result.snapshot,
          listing: { ...result.snapshot.listing, productId: url },
        },
      };
    },
  };

  await huntProducts(manyGateway, {
    queries: ['x390 yoga'],
    listingsPerQuery: 6,
    maxListingsToInspect: 6,
    inspectionConcurrency: 2,
    criteria: { limit: 5 },
  });

  assert.equal(peak, 2);
});
