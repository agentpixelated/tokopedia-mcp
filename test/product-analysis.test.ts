import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeListing,
  extractProductSnapshot,
  type ProductPageDocument,
} from '../src/domain/product.js';

function fixture(): ProductPageDocument {
  return {
    url: 'https://www.tokopedia.com/tajusy-tech/x13-yoga',
    fetchedAt: new Date('2026-08-28T10:00:00.000Z'),
    meta: {
      title: 'Lenovo ThinkPad X13 Yoga i5 Gen 10 16GB 256GB',
      price: 4_300_000,
      imageUrl: 'https://images.example/item.jpg',
      description: 'Laptop bisnis convertible',
    },
    cache: {
      pdpBasicInfo100: {
        productID: '100',
        shopID: '200',
        shopName: 'Tajusy Tech',
        condition: 'USED',
        status: 'ACTIVE',
        url: 'https://www.tokopedia.com/tajusy-tech/x13-yoga',
      },
      '$pdpBasicInfo100.stats': { rating: 0, countReview: '0' },
      '$pdpBasicInfo100.txStats': { itemSoldFmt: '0' },
      '$ROOT_QUERY.pdpMainInfo({"productKey":"x13-yoga"}).components.3.data.0.variant': {
        isVariant: true,
        parentID: '90',
      },
      '$ROOT_QUERY.pdpMainInfo({"productKey":"x13-yoga"}).components.4.data.0.variants.0': {
        name: 'RAM / SSD',
        identifier: 'size',
        option: [{ productVariantOptionID: '1', value: '16GB / 256GB', stock: 1 }],
      },
      '$ROOT_QUERY.pdpMainInfo({"productKey":"x13-yoga"}).components.4.data.0.children.0': {
        productID: '100',
        price: 4_300_000,
        priceFmt: 'Rp4.300.000',
        productName: 'X13 Yoga 16GB / 256GB',
        productURL: 'https://www.tokopedia.com/tajusy-tech/x13-yoga',
        optionID: { type: 'json', json: ['1'] },
        optionName: { type: 'json', json: ['16GB / 256GB'] },
        stock: { stock: 1, isBuyable: true },
        isCOD: true,
      },
      '$ROOT_QUERY.pdpMainInfo({"productKey":"x13-yoga"}).components.5.data.0.productDetailDescription': {
        content: 'Intel Core i5-10210U. RAM 8GB LPDDR3 onboard. SSD 256GB. Include stylus pen.',
      },
      '$ROOT_QUERY.pdpMainInfo({"productKey":"x13-yoga"}).components.5.data.0.content.0': {
        title: 'Kondisi',
        subtitle: 'Bekas',
      },
    },
  };
}

test('extractProductSnapshot preserves parent listing and concrete SKU truth separately', () => {
  const snapshot = extractProductSnapshot(fixture());

  assert.equal(snapshot.listing.productId, '100');
  assert.equal(snapshot.listing.displayPrice.value, 4_300_000);
  assert.equal(snapshot.skus.length, 1);
  assert.equal(snapshot.skus[0].stock.value, 1);
  assert.equal(snapshot.skus[0].stock.status, 'in_stock');
  assert.deepEqual(snapshot.skus[0].options, [{ axis: 'RAM / SSD', value: '16GB / 256GB' }]);
  assert.equal(snapshot.description.includes('RAM 8GB'), true);
});

test('analyzeListing flags title-description RAM conflict with field-level evidence', () => {
  const analysis = analyzeListing(extractProductSnapshot(fixture()));
  const conflict = analysis.issues.find((issue) => issue.code === 'memory_conflict');

  assert.ok(conflict);
  assert.equal(conflict.severity, 'high');
  assert.equal(conflict.evidence.length >= 2, true);
  assert.deepEqual(
    conflict.evidence.map((entry) => entry.source),
    ['title', 'description'],
  );
  assert.equal(analysis.confidence, 'low');
  assert.equal(analysis.verificationQuestions.some((question) => question.includes('BIOS')), true);
});

test('analyzeListing flags parent-price ambiguity when SKU prices differ', () => {
  const snapshot = extractProductSnapshot(fixture());
  snapshot.skus.push({
    ...snapshot.skus[0],
    productId: '101',
    price: { currency: 'IDR', value: 4_800_000, formatted: 'Rp4.800.000' },
    options: [{ axis: 'RAM / SSD', value: '16GB / 512GB' }],
  });

  const analysis = analyzeListing(snapshot);
  assert.equal(analysis.issues.some((issue) => issue.code === 'variant_price_range'), true);
  assert.deepEqual(analysis.priceRange, { min: 4_300_000, max: 4_800_000, currency: 'IDR' });
});
