import assert from 'node:assert/strict';

import { LiveTokopediaGateway } from '../src/service/gateway.js';

const productUrl =
  process.env.TOKOPEDIA_SMOKE_PRODUCT_URL ??
  'https://www.tokopedia.com/kalealaptop/laptop-lenovo-thinkpad-yoga-x380-core-i7-gen-8-ram-16-ssd-512-mulus-core-i5-gen-8-ram-8-ssd-256';

const gateway = new LiveTokopediaGateway();
const search = await gateway.search({
  query: 'thinkpad x390 yoga',
  page: 1,
  limit: 5,
  priceMin: 3_000_000,
  priceMax: 5_000_000,
  sort: 'most_sold',
});
assert.equal(search.items.length > 0, true, 'live search returned no products');
assert.equal(search.items.every((item) => item.productId && item.url && item.price.value > 0), true);

const inspection = await gateway.inspectProduct(productUrl);
assert.equal(Boolean(inspection.snapshot.listing.productId), true, 'product ID missing');
assert.equal(inspection.snapshot.skus.length > 0, true, 'variant listing returned no concrete SKUs');
assert.equal(inspection.snapshot.provenance.freshness, 'live');

console.log(
  JSON.stringify(
    {
      search: {
        query: search.query,
        returned: search.items.length,
        first: search.items[0],
        provenance: search.provenance,
      },
      inspection: {
        productId: inspection.snapshot.listing.productId,
        title: inspection.snapshot.listing.title,
        skuCount: inspection.snapshot.skus.length,
        priceRange: inspection.analysis.priceRange,
        issueCodes: inspection.analysis.issues.map((issue) => issue.code),
        provenance: inspection.snapshot.provenance,
      },
    },
    null,
    2,
  ),
);
