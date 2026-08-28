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

export async function graphqlRequest<T>(operation: string, query: string, variables: Record<string, unknown>): Promise<T> {
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
  const body = (await response.json()) as T & { errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`${operation}: ${body.errors.map((error) => error.message).join('; ')}`);
  return body;
}

export function searchGraphql<T>(params: string): Promise<T> {
  return graphqlRequest<T>('SearchProductV5Query', SEARCH_QUERY, { params });
}
