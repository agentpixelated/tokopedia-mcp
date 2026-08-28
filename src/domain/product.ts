export interface ProductPageDocument {
  url: string;
  fetchedAt: Date;
  meta: {
    title: string;
    price: number | null;
    imageUrl: string;
    description: string;
  };
  cache: Record<string, unknown>;
}

export interface Money {
  currency: 'IDR';
  value: number;
  formatted: string;
}

export interface ProductSku {
  productId: string;
  title: string;
  url: string;
  price: Money;
  options: Array<{ axis: string; value: string }>;
  stock: { value: number | null; status: 'in_stock' | 'out_of_stock' | 'unknown' };
  buyable: boolean;
  cod: boolean;
}

export interface ProductSnapshot {
  listing: {
    productId: string;
    parentId: string;
    title: string;
    url: string;
    displayPrice: Money;
    condition: string;
    status: string;
    shop: { shopId: string; name: string };
    rating: number | null;
    reviewCount: number;
    soldText: string;
  };
  description: string;
  specs: Array<{ label: string; value: string }>;
  skus: ProductSku[];
  provenance: {
    source: 'tokopedia_product_page';
    retrievedAt: string;
    freshness: 'live';
  };
}

export interface ListingIssue {
  code: 'memory_conflict' | 'storage_conflict' | 'cpu_conflict' | 'condition_conflict' | 'variant_price_range';
  severity: 'low' | 'medium' | 'high';
  summary: string;
  evidence: Array<{ source: 'title' | 'description' | 'spec' | 'sku'; value: string }>;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveRef(value: unknown, cache: Record<string, unknown>): unknown {
  const object = asObject(value);
  if (object?.type === 'id' && typeof object.id === 'string') return cache[object.id] ?? value;
  return value;
}

function resolveStringArray(value: unknown): string[] {
  const object = asObject(value);
  return object?.type === 'json' && Array.isArray(object.json) ? object.json.map(String) : [];
}

function formatIdr(value: number): string {
  return `Rp${value.toLocaleString('id-ID')}`;
}

function findBasic(cache: Record<string, unknown>): { key: string; value: Record<string, unknown> } | null {
  const key = Object.keys(cache).find((candidate) => /^pdpBasicInfo\d+$/.test(candidate));
  const value = key ? asObject(cache[key]) : null;
  return key && value ? { key, value } : null;
}

function findPrefix(cache: Record<string, unknown>): string | null {
  const key = Object.keys(cache).find((candidate) => candidate.includes('pdpMainInfo') && candidate.includes('.components.'));
  return key ? key.slice(0, key.indexOf('.components.')) : null;
}

function findParentId(cache: Record<string, unknown>, prefix: string | null): string {
  if (!prefix) return '';
  for (let component = 0; component < 40; component++) {
    const variant = asObject(cache[`${prefix}.components.${component}.data.0.variant`]);
    if (variant?.parentID !== undefined) return String(variant.parentID);
  }
  return '';
}

function findDescription(cache: Record<string, unknown>, prefix: string | null): string {
  if (!prefix) return '';
  for (let component = 0; component < 40; component++) {
    const description = asObject(
      cache[`${prefix}.components.${component}.data.0.productDetailDescription`],
    );
    if (typeof description?.content === 'string') return description.content;
  }
  return '';
}

function findSpecs(cache: Record<string, unknown>, prefix: string | null) {
  const specs: Array<{ label: string; value: string }> = [];
  if (!prefix) return specs;
  for (let component = 0; component < 40; component++) {
    for (let row = 0; row < 100; row++) {
      const value = asObject(cache[`${prefix}.components.${component}.data.0.content.${row}`]);
      if (!value) continue;
      if (typeof value.title === 'string' && typeof value.subtitle === 'string' && value.subtitle) {
        specs.push({ label: value.title, value: value.subtitle });
      }
    }
  }
  return specs;
}

function findAxes(cache: Record<string, unknown>, prefix: string | null) {
  const axes: Array<{ name: string; optionMap: Map<string, string> }> = [];
  if (!prefix) return axes;
  for (let component = 0; component < 40; component++) {
    for (let axisIndex = 0; axisIndex < 10; axisIndex++) {
      const axis = asObject(cache[`${prefix}.components.${component}.data.0.variants.${axisIndex}`]);
      if (!axis) continue;
      const optionMap = new Map<string, string>();
      if (Array.isArray(axis.option)) {
        for (const rawOption of axis.option) {
          const option = asObject(resolveRef(rawOption, cache));
          if (option) optionMap.set(String(option.productVariantOptionID ?? ''), String(option.value ?? ''));
        }
      }
      axes.push({ name: String(axis.name ?? axis.identifier ?? `option_${axisIndex + 1}`), optionMap });
    }
    if (axes.length > 0) break;
  }
  return axes;
}

function findSkus(cache: Record<string, unknown>, prefix: string | null, axes: ReturnType<typeof findAxes>): ProductSku[] {
  const skus: ProductSku[] = [];
  if (!prefix) return skus;
  for (let component = 0; component < 40; component++) {
    for (let childIndex = 0; childIndex < 500; childIndex++) {
      const child = asObject(cache[`${prefix}.components.${component}.data.0.children.${childIndex}`]);
      if (!child) continue;
      const optionIds = resolveStringArray(child.optionID);
      const optionNames = resolveStringArray(child.optionName);
      const stockObject = asObject(resolveRef(child.stock, cache));
      const stockValue = stockObject && stockObject.stock !== undefined ? Number(stockObject.stock) : null;
      const options = optionNames.map((value, index) => ({
        axis: axes[index]?.name ?? `option_${index + 1}`,
        value: value || axes[index]?.optionMap.get(optionIds[index]) || '',
      }));
      const price = Number(child.price ?? 0);
      skus.push({
        productId: String(child.productID ?? ''),
        title: String(child.productName ?? ''),
        url: String(child.productURL ?? ''),
        price: {
          currency: 'IDR',
          value: price,
          formatted: String(child.priceFmt ?? formatIdr(price)),
        },
        options,
        stock: {
          value: Number.isFinite(stockValue) ? stockValue : null,
          status: !Number.isFinite(stockValue) ? 'unknown' : stockValue! > 0 ? 'in_stock' : 'out_of_stock',
        },
        buyable: stockObject?.isBuyable !== false && (stockValue === null || stockValue > 0),
        cod: Boolean(child.isCOD),
      });
    }
    if (skus.length > 0) break;
  }
  return skus;
}

export function extractProductSnapshot(document: ProductPageDocument): ProductSnapshot {
  const basic = findBasic(document.cache);
  const prefix = findPrefix(document.cache);
  const axes = findAxes(document.cache, prefix);
  const skus = findSkus(document.cache, prefix, axes);
  const rawPrice = document.meta.price ?? skus[0]?.price.value ?? 0;
  const stats = basic ? asObject(document.cache[`$${basic.key}.stats`]) : null;
  const txStats = basic ? asObject(document.cache[`$${basic.key}.txStats`]) : null;
  return {
    listing: {
      productId: String(basic?.value.productID ?? ''),
      parentId: findParentId(document.cache, prefix),
      title: document.meta.title,
      url: String(basic?.value.url ?? document.url),
      displayPrice: { currency: 'IDR', value: rawPrice, formatted: formatIdr(rawPrice) },
      condition: String(basic?.value.condition ?? ''),
      status: String(basic?.value.status ?? ''),
      shop: {
        shopId: String(basic?.value.shopID ?? ''),
        name: String(basic?.value.shopName ?? ''),
      },
      rating: stats?.rating === undefined ? null : Number(stats.rating),
      reviewCount: Number(stats?.countReview ?? 0),
      soldText: String(txStats?.itemSoldFmt ?? txStats?.countSold ?? '0'),
    },
    description: findDescription(document.cache, prefix) || document.meta.description,
    specs: findSpecs(document.cache, prefix),
    skus,
    provenance: {
      source: 'tokopedia_product_page',
      retrievedAt: document.fetchedAt.toISOString(),
      freshness: 'live',
    },
  };
}

function extractMemory(text: string): string[] {
  return [...text.matchAll(/\b(4|8|12|16|24|32|64)\s*gb\b/gi)].map((match) => `${match[1]}GB`);
}

function extractStorage(text: string): string[] {
  return [...text.matchAll(/\b(128|256|512)\s*gb\b|\b([1-4])\s*tb\b/gi)].map((match) =>
    match[1] ? `${match[1]}GB` : `${match[2]}TB`,
  );
}

function different(a: string[], b: string[]): boolean {
  return a.length > 0 && b.length > 0 && !a.some((value) => b.includes(value));
}

export function analyzeListing(snapshot: ProductSnapshot) {
  const issues: ListingIssue[] = [];
  const titleMemory = extractMemory(snapshot.listing.title);
  const descriptionMemory = extractMemory(snapshot.description);
  if (different(titleMemory, descriptionMemory)) {
    issues.push({
      code: 'memory_conflict',
      severity: 'high',
      summary: `Memory differs between title (${titleMemory.join(', ')}) and description (${descriptionMemory.join(', ')}).`,
      evidence: [
        { source: 'title', value: snapshot.listing.title },
        { source: 'description', value: snapshot.description },
      ],
    });
  }
  const titleStorage = extractStorage(snapshot.listing.title).filter((value) => !titleMemory.includes(value));
  const descriptionStorage = extractStorage(snapshot.description).filter((value) => !descriptionMemory.includes(value));
  if (different(titleStorage, descriptionStorage)) {
    issues.push({
      code: 'storage_conflict',
      severity: 'high',
      summary: `Storage differs between title and description.`,
      evidence: [
        { source: 'title', value: snapshot.listing.title },
        { source: 'description', value: snapshot.description },
      ],
    });
  }
  const prices = snapshot.skus.map((sku) => sku.price.value).filter((value) => value > 0);
  const min = prices.length ? Math.min(...prices) : snapshot.listing.displayPrice.value;
  const max = prices.length ? Math.max(...prices) : snapshot.listing.displayPrice.value;
  if (min !== max) {
    issues.push({
      code: 'variant_price_range',
      severity: 'medium',
      summary: `Concrete SKU prices range from ${formatIdr(min)} to ${formatIdr(max)}.`,
      evidence: snapshot.skus.map((sku) => ({
        source: 'sku' as const,
        value: `${sku.options.map((option) => option.value).join(' / ')}: ${sku.price.formatted}`,
      })),
    });
  }
  const high = issues.some((issue) => issue.severity === 'high');
  const questions: string[] = [];
  if (issues.some((issue) => issue.code === 'memory_conflict')) {
    questions.push('Send a current BIOS photo/video proving the installed RAM and exact model.');
  }
  if (issues.some((issue) => issue.code === 'storage_conflict')) {
    questions.push('Send a storage-health screenshot showing the installed SSD capacity.');
  }
  questions.push('Confirm the exact selected variant, current stock, included accessories, and warranty in chat.');
  return {
    issues,
    confidence: high ? ('low' as const) : issues.length ? ('medium' as const) : ('high' as const),
    priceRange: { min, max, currency: 'IDR' as const },
    verificationQuestions: questions,
  };
}
