import assert from 'node:assert/strict';
import test from 'node:test';

import { loadProductPage, parseProductPage } from '../src/infra/product-page.js';

test('parseProductPage handles cache JSON with braces inside strings', () => {
  const html = `
    <meta property="og:title" content="ThinkPad Yoga &amp; Pen | Tokopedia">
    <meta content="4300000" property="product:price:amount">
    <script>window.__cache={"pdpBasicInfo1":{"productID":"1","note":"brace }; inside"}};</script>
  `;

  const parsed = parseProductPage('https://www.tokopedia.com/shop/item', html, new Date('2026-08-28T10:00:00Z'));
  assert.equal(parsed.meta.title, 'ThinkPad Yoga & Pen');
  assert.equal(parsed.meta.price, 4_300_000);
  assert.equal((parsed.cache.pdpBasicInfo1 as { note: string }).note, 'brace }; inside');
});

test('parseProductPage fails explicitly when no product evidence exists', () => {
  assert.throws(
    () => parseProductPage('https://www.tokopedia.com/search?q=x', '<html></html>'),
    /No Tokopedia product data/,
  );
});

test('parseProductPage rejects title-only non-product pages', () => {
  assert.throws(
    () => parseProductPage(
      'https://www.tokopedia.com/shop/not-a-product',
      '<meta property="og:title" content="Tokopedia promotion | Tokopedia">',
    ),
    /No Tokopedia product data/,
  );
});

test('loadProductPage rejects deceptive Tokopedia subdomains before fetching', async () => {
  await assert.rejects(
    loadProductPage('https://evil.tokopedia.com/shop/item'),
    /www\.tokopedia\.com/,
  );
});

test('loadProductPage rejects non-product paths before fetching', async () => {
  await assert.rejects(
    loadProductPage('https://www.tokopedia.com/search?q=thinkpad'),
    /product detail path/,
  );
});
