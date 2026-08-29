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

export interface VariantDiagnostic {
  code:
    | 'reference_cycle'
    | 'missing_reference'
    | 'option_tuple_mismatch'
    | 'duplicate_sku_id'
    | 'missing_sku_id'
    | 'missing_price';
  path: string;
  detail: string;
}

export interface VariantTruth {
  state: 'confirmed' | 'partial' | 'unknown' | 'none';
  declared: boolean | null;
  axesFound: number;
  skusFound: number;
  diagnostics: VariantDiagnostic[];
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
  variantTruth: VariantTruth;
  evidence: Record<string, {
    source: 'page_meta' | 'apollo_cache';
    path: string;
  }>;
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

function resolveRef(
  value: unknown,
  cache: Record<string, unknown>,
  diagnostics?: VariantDiagnostic[],
  path = '',
): unknown {
  let current = value;
  const seen = new Set<string>();
  while (true) {
    const object = asObject(current);
    if (object?.type !== 'id' || typeof object.id !== 'string') return current;
    if (seen.has(object.id)) {
      diagnostics?.push({ code: 'reference_cycle', path, detail: `Apollo reference cycle at ${object.id}.` });
      return null;
    }
    seen.add(object.id);
    if (!(object.id in cache)) {
      diagnostics?.push({ code: 'missing_reference', path, detail: `Apollo reference ${object.id} is missing.` });
      return null;
    }
    current = cache[object.id];
  }
}

function resolveStringArray(value: unknown): string[] {
  const object = asObject(value);
  return object?.type === 'json' && Array.isArray(object.json) ? object.json.map(String) : [];
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInteger(value: unknown): number {
  const number = finiteNumber(value);
  return number === null || number < 0 ? 0 : Math.trunc(number);
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
  const counts = new Map<string, number>();
  for (const key of Object.keys(cache)) {
    const boundary = key.indexOf('.components.');
    if (!key.includes('pdpMainInfo') || boundary < 0) continue;
    const prefix = key.slice(0, boundary);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

function entriesFor(cache: Record<string, unknown>, prefix: string | null, suffix: RegExp): Array<[string, unknown]> {
  if (!prefix) return [];
  return Object.entries(cache)
    .filter(([key]) => key.startsWith(`${prefix}.components.`) && suffix.test(key))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
}

function findVariantDeclaration(cache: Record<string, unknown>, prefix: string | null) {
  for (const [path, raw] of entriesFor(cache, prefix, /\.data\.0\.variant$/)) {
    const variant = asObject(raw);
    if (!variant) continue;
    return {
      declared: typeof variant.isVariant === 'boolean' ? variant.isVariant : null,
      parentId: variant.parentID === undefined ? '' : String(variant.parentID),
      path,
    };
  }
  return { declared: null, parentId: '', path: '' };
}

function findDescription(cache: Record<string, unknown>, prefix: string | null): string {
  for (const [, raw] of entriesFor(cache, prefix, /\.data\.0\.productDetailDescription$/)) {
    const description = asObject(raw);
    if (typeof description?.content === 'string') return description.content;
  }
  return '';
}

function findSpecs(cache: Record<string, unknown>, prefix: string | null) {
  const specs: Array<{ label: string; value: string }> = [];
  for (const [, raw] of entriesFor(cache, prefix, /\.data\.0\.content\.\d+$/)) {
    const value = asObject(raw);
    if (typeof value?.title === 'string' && typeof value.subtitle === 'string' && value.subtitle) {
      specs.push({ label: value.title, value: value.subtitle });
    }
  }
  return specs;
}

function findAxes(cache: Record<string, unknown>, prefix: string | null, diagnostics: VariantDiagnostic[]) {
  const axes: Array<{ name: string; optionMap: Map<string, string> }> = [];
  for (const [path, raw] of entriesFor(cache, prefix, /\.data\.0\.variants\.\d+$/)) {
    const axis = asObject(raw);
    if (!axis) continue;
    const optionMap = new Map<string, string>();
    if (Array.isArray(axis.option)) {
      for (let index = 0; index < axis.option.length; index++) {
        const option = asObject(resolveRef(axis.option[index], cache, diagnostics, `${path}.option.${index}`));
        if (option) optionMap.set(String(option.productVariantOptionID ?? ''), String(option.value ?? ''));
      }
    }
    axes.push({ name: String(axis.name ?? axis.identifier ?? `option_${axes.length + 1}`), optionMap });
  }
  return axes;
}

function findSkus(
  cache: Record<string, unknown>,
  prefix: string | null,
  axes: Array<{ name: string; optionMap: Map<string, string> }>,
  diagnostics: VariantDiagnostic[],
): ProductSku[] {
  const skus: ProductSku[] = [];
  const seen = new Set<string>();
  for (const [path, raw] of entriesFor(cache, prefix, /\.data\.0\.children\.\d+$/)) {
    const child = asObject(raw);
    if (!child) continue;
    const productId = String(child.productID ?? '');
    if (!productId) {
      diagnostics.push({ code: 'missing_sku_id', path, detail: 'Variant child has no productID.' });
      continue;
    }
    if (seen.has(productId)) {
      diagnostics.push({ code: 'duplicate_sku_id', path, detail: `Duplicate SKU ID ${productId}.` });
      continue;
    }
    seen.add(productId);

    const optionIds = resolveStringArray(child.optionID);
    const optionNames = resolveStringArray(child.optionName);
    const tupleLength = Math.max(optionIds.length, optionNames.length);
    if ((optionIds.length > 0 && optionNames.length > 0 && optionIds.length !== optionNames.length)
      || (axes.length > 0 && tupleLength !== axes.length)) {
      diagnostics.push({
        code: 'option_tuple_mismatch',
        path,
        detail: `Expected ${axes.length} option values; found ${optionIds.length} IDs and ${optionNames.length} names.`,
      });
    }
    const options = Array.from({ length: tupleLength }, (_, index) => ({
      axis: axes[index]?.name ?? `option_${index + 1}`,
      value: optionNames[index] || axes[index]?.optionMap.get(optionIds[index]) || '',
    }));

    const stockObject = asObject(resolveRef(child.stock, cache, diagnostics, `${path}.stock`));
    const stockValue = finiteNumber(stockObject?.stock);
    const price = finiteNumber(child.price) ?? 0;
    if (price <= 0) diagnostics.push({ code: 'missing_price', path, detail: `SKU ${productId} has no positive numeric price.` });
    skus.push({
      productId,
      title: String(child.productName ?? ''),
      url: String(child.productURL ?? ''),
      price: {
        currency: 'IDR',
        value: price,
        formatted: String(child.priceFmt ?? formatIdr(price)),
      },
      options,
      stock: {
        value: stockValue,
        status: stockValue === null ? 'unknown' : stockValue > 0 ? 'in_stock' : 'out_of_stock',
      },
      buyable: stockObject?.isBuyable !== false && (stockValue === null || stockValue > 0),
      cod: Boolean(child.isCOD),
    });
  }
  return skus;
}

function buildVariantTruth(
  declaration: ReturnType<typeof findVariantDeclaration>,
  axesFound: number,
  skusFound: number,
  diagnostics: VariantDiagnostic[],
): VariantTruth {
  let state: VariantTruth['state'];
  if (diagnostics.length > 0 && skusFound > 0) state = 'partial';
  else if (declaration.declared === true && skusFound === 0) state = 'unknown';
  else if (skusFound > 0) state = 'confirmed';
  else if (declaration.declared === false) state = 'none';
  else state = 'unknown';
  return { state, declared: declaration.declared, axesFound, skusFound, diagnostics };
}

export function extractProductSnapshot(document: ProductPageDocument): ProductSnapshot {
  const basic = findBasic(document.cache);
  const prefix = findPrefix(document.cache);
  const diagnostics: VariantDiagnostic[] = [];
  const declaration = findVariantDeclaration(document.cache, prefix);
  const axes = findAxes(document.cache, prefix, diagnostics);
  const skus = findSkus(document.cache, prefix, axes, diagnostics);
  const rawPrice = finiteNumber(document.meta.price) ?? skus[0]?.price.value ?? 0;
  const stats = basic ? asObject(document.cache[`$${basic.key}.stats`]) : null;
  const txStats = basic ? asObject(document.cache[`$${basic.key}.txStats`]) : null;
  return {
    listing: {
      productId: String(basic?.value.productID ?? ''),
      parentId: declaration.parentId,
      title: document.meta.title,
      url: String(basic?.value.url ?? document.url),
      displayPrice: { currency: 'IDR', value: rawPrice, formatted: formatIdr(rawPrice) },
      condition: String(basic?.value.condition ?? ''),
      status: String(basic?.value.status ?? ''),
      shop: {
        shopId: String(basic?.value.shopID ?? ''),
        name: String(basic?.value.shopName ?? ''),
      },
      rating: finiteNumber(stats?.rating),
      reviewCount: nonNegativeInteger(stats?.countReview),
      soldText: String(txStats?.itemSoldFmt ?? txStats?.countSold ?? '0'),
    },
    description: findDescription(document.cache, prefix) || document.meta.description,
    specs: findSpecs(document.cache, prefix),
    skus,
    variantTruth: buildVariantTruth(declaration, axes.length, skus.length, diagnostics),
    evidence: {
      'listing.title': { source: 'page_meta', path: 'meta[property="og:title"]' },
      'listing.displayPrice': { source: 'page_meta', path: 'meta[property="product:price:amount"]' },
      'listing.identity': { source: 'apollo_cache', path: basic?.key ?? 'pdpBasicInfo*' },
      description: { source: prefix ? 'apollo_cache' : 'page_meta', path: prefix ? `${prefix}.components.*.data.0.productDetailDescription` : 'meta[property="og:description"]' },
      specs: { source: 'apollo_cache', path: `${prefix ?? 'pdpMainInfo*'}.components.*.data.0.content.*` },
      skus: { source: 'apollo_cache', path: `${prefix ?? 'pdpMainInfo*'}.components.*.data.0.children.*` },
      variantTruth: { source: 'apollo_cache', path: declaration.path || `${prefix ?? 'pdpMainInfo*'}.components.*.data.0.variant` },
    },
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
      summary: 'Storage differs between title and description.',
      evidence: [
        { source: 'title', value: snapshot.listing.title },
        { source: 'description', value: snapshot.description },
      ],
    });
  }
  const prices = snapshot.skus.map((sku) => sku.price.value).filter((value) => value > 0 && Number.isFinite(value));
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
