import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { analyzeListing, type ProductSnapshot } from './domain/product.js';
import { buildShortlist, type HuntCandidate } from './domain/hunt.js';
import { LiveTokopediaGateway, type TokopediaGateway } from './service/gateway.js';
import { huntProducts } from './service/hunter.js';

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

const error = (caught: unknown) => ({
  content: [{ type: 'text' as const, text: caught instanceof Error ? caught.message : String(caught) }],
  isError: true as const,
});

const MoneySchema = z.object({
  currency: z.literal('IDR'),
  value: z.number(),
  formatted: z.string(),
});

const ProvenanceSchema = z.object({
  source: z.string(),
  operation: z.string().optional(),
  retrievedAt: z.string(),
  freshness: z.literal('live'),
});

const SearchOutput = z.object({
  query: z.string(),
  items: z.array(z.record(z.string(), z.unknown())),
  page: z.record(z.string(), z.unknown()),
  provenance: ProvenanceSchema,
});

const InspectionOutput = z.object({
  snapshot: z.record(z.string(), z.unknown()),
  analysis: z.record(z.string(), z.unknown()),
});

const AnalysisOutput = z.object({
  issues: z.array(z.record(z.string(), z.unknown())),
  confidence: z.enum(['high', 'medium', 'low']),
  priceRange: z.record(z.string(), z.unknown()),
  verificationQuestions: z.array(z.string()),
});

const ShortlistOutput = z.object({
  ranked: z.array(z.record(z.string(), z.unknown())),
  rejected: z.array(z.record(z.string(), z.unknown())),
  methodology: z.record(z.string(), z.unknown()),
});

const HuntOutput = z.object({
  queries: z.array(z.string()),
  discoveredListings: z.number(),
  inspectedListings: z.number(),
  failedInspections: z.number(),
  candidateSkus: z.number(),
  shortlist: z.record(z.string(), z.unknown()),
  failures: z.array(z.record(z.string(), z.unknown())),
  verificationQuestions: z.array(z.string()),
  provenance: z.array(z.record(z.string(), z.unknown())),
});

const SnapshotSchema = z.object({
  listing: z.record(z.string(), z.unknown()),
  description: z.string(),
  specs: z.array(z.record(z.string(), z.unknown())),
  skus: z.array(z.record(z.string(), z.unknown())),
  provenance: ProvenanceSchema,
});

const CandidateSchema = z.object({
  productId: z.string(),
  skuId: z.string(),
  title: z.string(),
  url: z.string().url(),
  price: z.number(),
  rating: z.number(),
  reviewCount: z.number().int().min(0),
  shopTransactions: z.number().int().min(0).nullable(),
  productSoldCount: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0).nullable(),
  ramGb: z.number().int().positive().nullable().optional(),
  specText: z.string(),
  issueSeverities: z.array(z.enum(['low', 'medium', 'high'])),
});

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function createServer(gateway: TokopediaGateway = new LiveTokopediaGateway()): McpServer {
  const server = new McpServer({ name: 'tokopedia-evidence', version: '0.1.0' });

  server.registerTool(
    'search_products',
    {
      title: 'Search Tokopedia products',
      description:
        'Discover Tokopedia parent listings. Returns numeric IDR prices, canonical URLs, pagination, shop identity, and live provenance. Inspect a listing before treating its displayed price as the requested SKU price.',
      inputSchema: {
        query: z.string().min(1),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(60).default(24),
        sort: z.enum(['relevance', 'price_low', 'price_high', 'newest', 'most_sold']).default('relevance'),
        priceMin: z.number().int().min(0).optional(),
        priceMax: z.number().int().min(0).optional(),
        filters: z.record(z.string(), z.string()).optional(),
      },
      outputSchema: SearchOutput,
      annotations,
    },
    async (input) => {
      try {
        if (input.priceMin !== undefined && input.priceMax !== undefined && input.priceMin > input.priceMax) {
          throw new Error('priceMin cannot be greater than priceMax.');
        }
        return text(await gateway.search(input));
      } catch (caught) {
        return error(caught);
      }
    },
  );

  server.registerTool(
    'inspect_product',
    {
      title: 'Inspect a Tokopedia product and all SKUs',
      description:
        'Fetch one Tokopedia product page, preserve parent-listing and concrete SKU evidence separately, and report variant prices, stock, contradiction flags, confidence, timestamps, and seller-verification questions.',
      inputSchema: { url: z.string().url() },
      outputSchema: InspectionOutput,
      annotations,
    },
    async ({ url }) => {
      try {
        return text(await gateway.inspectProduct(url));
      } catch (caught) {
        return error(caught);
      }
    },
  );

  server.registerTool(
    'analyze_listing',
    {
      title: 'Analyze a normalized listing snapshot',
      description:
        'Re-run deterministic contradiction and price-range analysis on a snapshot returned by inspect_product. This does not fetch the network.',
      inputSchema: { snapshot: SnapshotSchema },
      outputSchema: AnalysisOutput,
      annotations,
    },
    async ({ snapshot }) => {
      try {
        return text(analyzeListing(snapshot as unknown as ProductSnapshot));
      } catch (caught) {
        return error(caught);
      }
    },
  );

  server.registerTool(
    'build_shortlist',
    {
      title: 'Build an evidence-aware product shortlist',
      description:
        'Apply hard constraints, deduplicate at concrete SKU level, rank candidates using transparent evidence fields, and keep rejected candidates with reasons. Use inspected SKU candidates, not raw parent listing cards.',
      inputSchema: {
        candidates: z.array(CandidateSchema).min(1).max(500),
        criteria: z.object({
          priceMin: z.number().int().min(0).optional(),
          priceMax: z.number().int().min(0).optional(),
          mustInclude: z.array(z.string()).default([]),
          mustExclude: z.array(z.string()).default([]),
          minRamGb: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(50).default(10),
        }),
      },
      outputSchema: ShortlistOutput,
      annotations,
    },
    async ({ candidates, criteria }) => {
      try {
        if (criteria.priceMin !== undefined && criteria.priceMax !== undefined && criteria.priceMin > criteria.priceMax) {
          throw new Error('priceMin cannot be greater than priceMax.');
        }
        return text(buildShortlist(candidates as HuntCandidate[], criteria));
      } catch (caught) {
        return error(caught);
      }
    },
  );

  server.registerTool(
    'hunt_products',
    {
      title: 'Run an end-to-end Tokopedia product hunt',
      description:
        'Search one or more queries, deduplicate parent listings, inspect each page, expand concrete buyable SKUs, apply hard constraints, and return a ranked shortlist plus failures and seller-verification questions. Keep maxListingsToInspect bounded because this performs one page request per listing.',
      inputSchema: {
        queries: z.array(z.string().min(1)).min(1).max(10),
        listingsPerQuery: z.number().int().min(1).max(30).default(10),
        maxListingsToInspect: z.number().int().min(1).max(50).default(20),
        inspectionConcurrency: z.number().int().min(1).max(8).default(4),
        criteria: z.object({
          priceMin: z.number().int().min(0).optional(),
          priceMax: z.number().int().min(0).optional(),
          mustInclude: z.array(z.string()).default([]),
          mustExclude: z.array(z.string()).default([]),
          minRamGb: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(50).default(10),
        }),
      },
      outputSchema: HuntOutput,
      annotations,
    },
    async (input) => {
      try {
        if (input.criteria.priceMin !== undefined && input.criteria.priceMax !== undefined && input.criteria.priceMin > input.criteria.priceMax) {
          throw new Error('priceMin cannot be greater than priceMax.');
        }
        return text(await huntProducts(gateway, input));
      } catch (caught) {
        return error(caught);
      }
    },
  );

  return server;
}
