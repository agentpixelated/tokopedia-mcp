import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/server.js';
import type { TokopediaGateway } from '../src/service/gateway.js';

const gateway: TokopediaGateway = {
  async search(input) {
    return {
      query: input.query,
      items: [],
      page: { number: 1, limit: 24, returned: 0, total: 0, nextPage: null },
      provenance: {
        source: 'tokopedia_graphql',
        operation: 'SearchProductV5Query',
        retrievedAt: '2026-08-28T10:00:00.000Z',
        freshness: 'live',
      },
    };
  },
  async inspectProduct() {
    throw new Error('not used');
  },
};

test('MCP exposes focused evidence-first tools and structured output', async () => {
  const server = createServer(gateway);
  const client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    ['analyze_listing', 'budget_results', 'build_shortlist', 'hunt_products', 'inspect_product', 'search_products'],
  );

  const result = await client.callTool({ name: 'search_products', arguments: { query: 'thinkpad yoga' } });
  assert.deepEqual((result.structuredContent as { query: string }).query, 'thinkpad yoga');
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, 'text');

  const budgeted = await client.callTool({
    name: 'budget_results',
    arguments: {
      items: Array.from({ length: 5 }, (_, index) => ({
        productId: String(index),
        title: 'x',
        url: `https://example.test/${index}`,
        price: index,
        classification: 'target',
      })),
      provenance: { source: 'fixture', details: 'y' },
      maxChars: 512,
      maxItems: 5,
    },
  });
  const budgetContent = budgeted.structuredContent as { items: unknown[]; truncation: { omittedItems: number } };
  assert.equal(budgetContent.items.length > 0, true);
  assert.equal(budgeted.content[0].type, 'text');
  if (budgeted.content[0].type === 'text') {
    assert.equal(budgeted.content[0].text.length <= 512, true);
  }

  await Promise.all([client.close(), server.close()]);
});
