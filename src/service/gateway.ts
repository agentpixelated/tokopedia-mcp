import { analyzeListing, extractProductSnapshot, type ProductSnapshot } from '../domain/product.js';
import {
  buildSearchParams,
  normalizeSearchResult,
  type RawSearchResponse,
  type SearchInput,
} from '../domain/search.js';
import { searchGraphql } from '../infra/graphql.js';
import { loadProductPage } from '../infra/product-page.js';

export type SearchResult = ReturnType<typeof normalizeSearchResult>;

export interface ProductInspection {
  snapshot: ProductSnapshot;
  analysis: ReturnType<typeof analyzeListing>;
}

export interface TokopediaGateway {
  search(input: SearchInput): Promise<SearchResult>;
  inspectProduct(url: string): Promise<ProductInspection>;
}

export class LiveTokopediaGateway implements TokopediaGateway {
  async search(input: SearchInput): Promise<SearchResult> {
    const raw = await searchGraphql<RawSearchResponse>(buildSearchParams(input));
    return normalizeSearchResult(raw, input);
  }

  async inspectProduct(url: string): Promise<ProductInspection> {
    const snapshot = extractProductSnapshot(await loadProductPage(url));
    return { snapshot, analysis: analyzeListing(snapshot) };
  }
}
