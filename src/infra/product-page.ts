import type { ProductPageDocument } from '../domain/product.js';
import { fetchWithPolicy } from './http.js';

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function meta(html: string, key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1];
    if (property !== key) continue;
    return decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '');
  }
  return '';
}

export function parseApolloCache(html: string): Record<string, unknown> | null {
  const marker = html.indexOf('window.__cache');
  if (marker < 0) return null;
  const start = html.indexOf('{', marker);
  if (start < 0) return null;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseProductPage(url: string, html: string, fetchedAt = new Date()): ProductPageDocument {
  const title = meta(html, 'og:title').replace(/\s*\|\s*Tokopedia\s*$/i, '');
  const rawPrice = meta(html, 'product:price:amount');
  const cache = parseApolloCache(html) ?? {};
  if (!title && !Object.keys(cache).some((key) => /^pdpBasicInfo\d+$/.test(key))) {
    throw new Error(`No Tokopedia product data found at ${url}`);
  }
  return {
    url,
    fetchedAt,
    meta: {
      title,
      price: rawPrice ? Number(rawPrice) : null,
      imageUrl: meta(html, 'og:image'),
      description: meta(html, 'og:description'),
    },
    cache,
  };
}

export async function loadProductPage(url: string): Promise<ProductPageDocument> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/(^|\.)tokopedia\.com$/i.test(parsed.hostname)) {
    throw new Error('Product URL must use HTTPS on tokopedia.com.');
  }
  parsed.search = '';
  parsed.hash = '';
  const response = await fetchWithPolicy(parsed.toString(), { headers: { Accept: 'text/html' } });
  return parseProductPage(parsed.toString(), await response.text());
}
