import assert from 'node:assert/strict';
import test from 'node:test';

import { buildShortlist, type HuntCandidate } from '../src/domain/hunt.js';

const candidates: HuntCandidate[] = [
  {
    productId: 'x390',
    skuId: 'x390-16-256',
    title: 'ThinkPad X390 Yoga i5 8th 16GB 256GB',
    url: 'https://www.tokopedia.com/sparta/x390',
    price: 3_920_000,
    rating: 4.8,
    reviewCount: 20,
    shopTransactions: 1_009,
    stock: 20,
    ramGb: 16,
    specText: 'i5-8265U RAM 16GB SSD 256GB touchscreen stylus',
    issueSeverities: [],
  },
  {
    productId: 'x13',
    skuId: 'x13-16-256',
    title: 'ThinkPad X13 Yoga i5 10th 16GB 256GB',
    url: 'https://www.tokopedia.com/tajusy/x13',
    price: 4_300_000,
    rating: 0,
    reviewCount: 0,
    shopTransactions: 3,
    stock: 1,
    ramGb: 16,
    specText: 'i5-10210U RAM 16GB SSD 256GB touchscreen stylus; listing analysis found an 8GB description conflict',
    issueSeverities: ['high'],
  },
];

test('buildShortlist applies hard constraints before scoring', () => {
  const result = buildShortlist(candidates, {
    priceMin: 3_000_000,
    priceMax: 5_000_000,
    mustInclude: ['yoga'],
    mustExclude: ['x1'],
    minRamGb: 16,
    limit: 5,
  });

  assert.equal(result.rejected.length, 0);
  assert.equal(result.ranked.length, 2);
  assert.equal(result.ranked[0].productId, 'x390');
  assert.equal(result.ranked[0].score > result.ranked[1].score, true);
  assert.equal(result.ranked[1].riskFlags.includes('high_severity_listing_issue'), true);
  assert.equal(result.methodology.hardConstraintsApplied, true);
});

test('buildShortlist deduplicates concrete SKUs without collapsing different variants', () => {
  const result = buildShortlist([candidates[0], candidates[0], { ...candidates[0], skuId: 'x390-16-512', price: 4_410_000 }], {
    priceMin: 3_000_000,
    priceMax: 5_000_000,
    limit: 10,
  });

  assert.deepEqual(result.ranked.map((item) => item.skuId).sort(), ['x390-16-256', 'x390-16-512']);
});

test('buildShortlist uses token boundaries for required terms and excludes classified accessories', () => {
  const result = buildShortlist([
    { ...candidates[0], skuId: 'program', title: 'Program license', specText: 'program utility' },
    { ...candidates[0], skuId: 'charger', classification: 'accessory', classificationReasons: ['accessory_first_title'] },
  ], {
    mustInclude: ['ram'],
    limit: 5,
  });

  assert.equal(result.ranked.length, 0);
  assert.equal(result.rejected.find((item) => item.skuId === 'program')?.rejectionReasons.includes('missing:ram'), true);
  assert.equal(result.rejected.find((item) => item.skuId === 'charger')?.rejectionReasons.includes('classified:accessory'), true);
});
