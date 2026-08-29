import { fetchWithPolicy } from './http.js';

const ENDPOINT = 'https://gql.tokopedia.com/graphql';

// Tokopedia validates this public operation against the exact web-app selection
// set. Seemingly unused fields are intentionally kept to avoid schema rejection.
const SEARCH_QUERY = `query SearchProductV5Query($params: String!) {
  searchProductV5(params: $params) {
    header {
      totalData
      responseCode
      keywordProcess
      keywordIntention
      additionalParams
    }
    data {
      totalDataText
      related { relatedKeyword position }
      suggestion { currentKeyword suggestion query text }
      products {
        oldID: id
        id: id_str_auto_
        name
        url
        applink
        mediaURL { image image300 }
        shop {
          oldID: id
          id: id_str_auto_
          name
          url
          city
          tier
        }
        badge { oldID: id id: id_str_auto_ title url }
        price { text number range original discountPercentage }
        freeShipping { url }
        labelGroups { position title type url }
        labelGroupsVariant { title type typeVariant hexColor }
        category {
          oldID: id
          id: id_str_auto_
          name
          breadcrumb
        }
        rating
        wishlist
        meta {
          oldParentID: parentID
          parentID: parentID_str_auto_
          oldWarehouseID: warehouseID
          warehouseID: warehouseID_str_auto_
          isImageBlurred
          isPortrait
        }
      }
    }
  }
}`;

export interface GraphqlWarning {
  code: 'graphql_partial_error';
  source: 'tokopedia_graphql';
  operation: string;
  message: string;
  path: Array<string | number>;
}

interface GraphqlBody<T> {
  data?: T;
  errors?: Array<{ message: string; path?: Array<string | number> }>;
}

export function parseGraphqlBody<T>(
  operation: string,
  body: GraphqlBody<T>,
): { data: T; warnings: GraphqlWarning[] } {
  const errors = body.errors ?? [];
  if (body.data === undefined) {
    const detail = errors.length > 0 ? errors.map((error) => error.message).join('; ') : 'response contained no data';
    throw new Error(`${operation}: ${detail}`);
  }
  return {
    data: body.data,
    warnings: errors.map((error) => ({
      code: 'graphql_partial_error',
      source: 'tokopedia_graphql',
      operation,
      message: error.message,
      path: error.path ?? [],
    })),
  };
}

export async function graphqlRequest<T>(
  operation: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{ data: T; warnings: GraphqlWarning[] }> {
  const response = await fetchWithPolicy(`${ENDPOINT}/${operation}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.tokopedia.com',
      Referer: 'https://www.tokopedia.com/',
      'X-Source': 'tokopedia-lite',
      'X-Version': '1.0',
    },
    body: JSON.stringify({ operationName: operation, query, variables }),
  });
  return parseGraphqlBody<T>(operation, await response.json() as GraphqlBody<T>);
}

export function searchGraphql<T>(params: string): Promise<{ data: T; warnings: GraphqlWarning[] }> {
  return graphqlRequest<T>('SearchProductV5Query', SEARCH_QUERY, { params });
}
