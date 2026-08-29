export interface PageableItem {
  productId: string;
  url: string;
}

export interface SourcePage<T extends PageableItem> {
  items: T[];
  hasMore: boolean;
}

export interface CollectPagesOptions {
  maxPages: number;
}

export interface PaginationSummary {
  pagesFetched: number;
  fetchedCount: number;
  returnedCount: number;
  dedupedCount: number;
  hasMore: boolean;
  stopReason: 'source_exhausted' | 'repeated_page' | 'max_pages';
}

export function canonicalProductUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return value.trim();
  }
}

function identity(item: PageableItem): string {
  return item.productId.trim() || canonicalProductUrl(item.url);
}

function fingerprint<T extends PageableItem>(items: T[]): string {
  return items.map(identity).sort().join('\n');
}

export async function collectPages<T extends PageableItem>(
  fetchPage: (page: number) => Promise<SourcePage<T>> | SourcePage<T>,
  options: CollectPagesOptions,
): Promise<{ items: T[]; pagination: PaginationSummary }> {
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
    throw new Error('maxPages must be a positive integer.');
  }
  const items = new Map<string, T>();
  const pageFingerprints = new Set<string>();
  let pagesFetched = 0;
  let fetchedCount = 0;
  let dedupedCount = 0;
  let hasMore = true;
  let stopReason: PaginationSummary['stopReason'] = 'max_pages';

  for (let page = 1; page <= options.maxPages; page++) {
    const source = await fetchPage(page);
    pagesFetched += 1;
    fetchedCount += source.items.length;
    hasMore = source.hasMore;
    const currentFingerprint = fingerprint(source.items);
    if (pageFingerprints.has(currentFingerprint)) {
      stopReason = 'repeated_page';
      break;
    }
    pageFingerprints.add(currentFingerprint);
    for (const item of source.items) {
      const key = identity(item);
      if (items.has(key)) dedupedCount += 1;
      else items.set(key, item);
    }
    if (!source.hasMore) {
      stopReason = 'source_exhausted';
      break;
    }
  }

  return {
    items: [...items.values()],
    pagination: {
      pagesFetched,
      fetchedCount,
      returnedCount: items.size,
      dedupedCount,
      hasMore,
      stopReason,
    },
  };
}
