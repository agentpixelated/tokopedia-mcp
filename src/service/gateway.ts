import { analyzeListing, extractProductSnapshot, type ProductSnapshot } from '../domain/product.js';
import {
  buildSearchParams,
  normalizeSearchResult,
  type RawSearchResponse,
  type SearchInput,
} from '../domain/search.js';
import { searchGraphql, type GraphqlWarning } from '../infra/graphql.js';
import { loadProductPage } from '../infra/product-page.js';

export type SearchResult = ReturnType<typeof normalizeSearchResult> & { warnings?: GraphqlWarning[] };

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
    const response = await searchGraphql<RawSearchResponse['data']>(buildSearchParams(input));
    const result = normalizeSearchResult({ data: response.data }, input);
    return { ...result, warnings: response.warnings };
  }

  async inspectProduct(url: string): Promise<ProductInspection> {
    const snapshot = extractProductSnapshot(await loadProductPage(url));
    return { snapshot, analysis: analyzeListing(snapshot) };
  }
}
