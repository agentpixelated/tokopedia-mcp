export type SearchSort = 'relevance' | 'price_low' | 'price_high' | 'newest' | 'most_sold';

export interface SearchInput {
  query: string;
  page?: number;
  limit?: number;
  sort?: SearchSort;
  priceMin?: number;
  priceMax?: number;
  filters?: Record<string, string>;
}

export interface RawSearchProduct {
  id: string;
  name: string;
  url: string;
  price: {
    text: string;
    number: number;
    original?: string;
    discountPercentage?: number;
  };
  rating?: string | number;
  shop: {
    id: string;
    name: string;
    url: string;
    city: string;
    tier: number;
  };
}

export interface RawSearchResponse {
  data: {
    searchProductV5: {
      header: {
        totalData: number;
        responseCode: string;
        keywordProcess: string;
      };
      data: { products: RawSearchProduct[] | null };
    };
  };
}

const SORT_VALUES: Record<SearchSort, number> = {
  relevance: 23,
  price_low: 3,
  price_high: 4,
  newest: 5,
  most_sold: 8,
};

export function buildSearchParams(input: SearchInput): string {
  const page = input.page ?? 1;
  const limit = input.limit ?? 24;
  const params = new URLSearchParams({
    device: 'desktop',
    enter_method: 'normal_search',
    ob: String(SORT_VALUES[input.sort ?? 'relevance']),
    page: String(page),
    q: input.query,
    pmin: input.priceMin === undefined ? '' : String(input.priceMin),
    pmax: input.priceMax === undefined ? '' : String(input.priceMax),
    rows: String(limit),
    safe_search: 'false',
    source: 'search',
    st: 'product',
    start: String((page - 1) * limit),
  });
  for (const [key, value] of Object.entries(input.filters ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (value !== '') params.set(key, value);
  }
  return params.toString();
}

function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

function tierName(tier: number): 'official' | 'power' | 'regular' | 'unknown' {
  if (tier === 2) return 'official';
  if (tier === 3) return 'power';
  if (tier === 1 || tier === 0) return 'regular';
  return 'unknown';
}

export function normalizeSearchResult(raw: RawSearchResponse, input: SearchInput, now = new Date()) {
  const page = input.page ?? 1;
  const limit = input.limit ?? 24;
  const result = raw.data.searchProductV5;
  const total = result.header.totalData;
  return {
    query:
      result.header.keywordProcess && result.header.keywordProcess !== '0'
        ? result.header.keywordProcess
        : input.query,
    items: (result.data.products ?? []).map((product) => ({
      productId: product.id,
      title: product.name,
      url: canonicalUrl(product.url),
      price: {
        currency: 'IDR' as const,
        value: product.price.number,
        formatted: product.price.text,
        originalFormatted: product.price.original || null,
        discountPercentage: product.price.discountPercentage ?? 0,
      },
      rating: product.rating === undefined || product.rating === '' ? null : Number(product.rating),
      shop: {
        shopId: product.shop.id,
        name: product.shop.name,
        url: canonicalUrl(product.shop.url),
        city: product.shop.city,
        tier: tierName(product.shop.tier),
      },
    })),
    page: {
      number: page,
      limit,
      returned: (result.data.products ?? []).length,
      total,
      nextPage: page * limit < total ? page + 1 : null,
    },
    provenance: {
      source: 'tokopedia_graphql' as const,
      operation: 'SearchProductV5Query',
      retrievedAt: now.toISOString(),
      freshness: 'live' as const,
    },
  };
}
