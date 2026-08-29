import assert from 'node:assert/strict';
import test from 'node:test';

import { parseGraphqlBody } from '../src/infra/graphql.js';

test('parseGraphqlBody preserves usable data and surfaces partial-source warnings', () => {
  const result = parseGraphqlBody<{ value: number }>('FixtureQuery', {
    data: { value: 42 },
    errors: [{ message: 'optional reviews field unavailable', path: ['value', 'reviews'] }],
  });

  assert.deepEqual(result.data, { value: 42 });
  assert.deepEqual(result.warnings, [{
    code: 'graphql_partial_error',
    source: 'tokopedia_graphql',
    operation: 'FixtureQuery',
    message: 'optional reviews field unavailable',
    path: ['value', 'reviews'],
  }]);
});

test('parseGraphqlBody fails closed when GraphQL errors leave no data', () => {
  assert.throws(
    () => parseGraphqlBody('FixtureQuery', { errors: [{ message: 'query rejected' }] }),
    /FixtureQuery: query rejected/,
  );
});