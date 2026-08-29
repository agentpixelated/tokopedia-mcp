import assert from 'node:assert/strict';
import test from 'node:test';

import { extractProductSnapshot, type ProductPageDocument } from '../src/domain/product.js';

function documentWith(cache: Record<string, unknown>): ProductPageDocument {
  return {
    url: 'https://www.tokopedia.com/shop/sparse-product',
    fetchedAt: new Date('2026-08-28T10:00:00.000Z'),
    meta: {
      title: 'Sparse product',
      price: 4_000_000,
      imageUrl: '',
      description: '',
    },
    cache: {
      pdpBasicInfo900: {
        productID: '900',
        shopID: '10',
        shopName: 'Shop',
        status: 'ACTIVE',
        url: 'https://www.tokopedia.com/shop/sparse-product',
      },
      ...cache,
    },
  };
}

test('variant extraction discovers sparse indexes and resolves multi-hop Apollo references', () => {
  const prefix = '$ROOT_QUERY.pdpMainInfo({"productKey":"sparse-product"})';
  const snapshot = extractProductSnapshot(documentWith({
    [`${prefix}.components.103.data.0.variant`]: { isVariant: true, parentID: '800' },
    [`${prefix}.components.221.data.0.variants.4`]: {
      name: 'RAM',
      option: [{ type: 'id', id: 'option-hop-1' }],
    },
    'option-hop-1': { type: 'id', id: 'option-hop-2' },
    'option-hop-2': { productVariantOptionID: 'ram-16', value: '16GB' },
    [`${prefix}.components.221.data.0.children.205`]: {
      productID: 'sku-16',
      productName: 'Sparse product 16GB',
      productURL: 'https://www.tokopedia.com/shop/sparse-product?sku=16',
      price: 4_200_000,
      optionID: { type: 'json', json: ['ram-16'] },
      optionName: { type: 'json', json: ['16GB'] },
      stock: { type: 'id', id: 'stock-hop-1' },
      isCOD: true,
    },
    'stock-hop-1': { type: 'id', id: 'stock-hop-2' },
    'stock-hop-2': { stock: 3, isBuyable: true },
  }));

  assert.equal(snapshot.listing.parentId, '800');
  assert.equal(snapshot.skus.length, 1);
  assert.deepEqual(snapshot.skus[0].options, [{ axis: 'RAM', value: '16GB' }]);
  assert.deepEqual(snapshot.skus[0].stock, { value: 3, status: 'in_stock' });
  assert.deepEqual(snapshot.variantTruth, {
    state: 'confirmed',
    declared: true,
    axesFound: 1,
    skusFound: 1,
    diagnostics: [],
  });
});

test('declared variants with unresolved references remain unknown rather than none or out of stock', () => {
  const prefix = '$ROOT_QUERY.pdpMainInfo({"productKey":"sparse-product"})';
  const snapshot = extractProductSnapshot(documentWith({
    [`${prefix}.components.9.data.0.variant`]: { isVariant: true, parentID: '800' },
    [`${prefix}.components.11.data.0.variants.0`]: {
      name: 'RAM',
      option: [{ type: 'id', id: 'missing-option' }],
    },
  }));

  assert.equal(snapshot.skus.length, 0);
  assert.equal(snapshot.variantTruth.state, 'unknown');
  assert.equal(snapshot.variantTruth.declared, true);
  assert.equal(snapshot.variantTruth.diagnostics[0]?.code, 'missing_reference');
});

test('invalid option tuples and duplicate SKU IDs make otherwise usable extraction partial', () => {
  const prefix = '$ROOT_QUERY.pdpMainInfo({"productKey":"sparse-product"})';
  const child = {
    productID: 'duplicate',
    productName: 'Sparse product',
    productURL: 'https://www.tokopedia.com/shop/sparse-product',
    price: 4_200_000,
    optionID: { type: 'json', json: ['ram-16'] },
    optionName: { type: 'json', json: ['16GB', '256GB'] },
    stock: { stock: null, isBuyable: true },
  };
  const snapshot = extractProductSnapshot(documentWith({
    [`${prefix}.components.0.data.0.variant`]: { isVariant: true },
    [`${prefix}.components.1.data.0.variants.0`]: { name: 'RAM', option: [] },
    [`${prefix}.components.1.data.0.children.0`]: child,
    [`${prefix}.components.1.data.0.children.7`]: child,
  }));

  assert.equal(snapshot.skus.length, 1);
  assert.deepEqual(snapshot.skus[0].stock, { value: null, status: 'unknown' });
  assert.equal(snapshot.skus[0].buyable, true);
  assert.equal(snapshot.variantTruth.state, 'partial');
  assert.deepEqual(
    snapshot.variantTruth.diagnostics.map((diagnostic) => diagnostic.code),
    ['option_tuple_mismatch', 'duplicate_sku_id'],
  );
});