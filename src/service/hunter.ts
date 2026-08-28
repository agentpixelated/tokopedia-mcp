import { buildShortlist, type HuntCandidate, type HuntCriteria } from '../domain/hunt.js';
import type { TokopediaGateway } from './gateway.js';

export interface HuntProductsInput {
  queries: string[];
  listingsPerQuery?: number;
  maxListingsToInspect?: number;
  inspectionConcurrency?: number;
  criteria: HuntCriteria;
}

function numericSold(text: string): number {
  const normalized = text.toLowerCase().replace(/\./g, '').replace(/,/g, '.');
  const value = Number(normalized.match(/[\d.]+/)?.[0] ?? 0);
  if (normalized.includes('rb')) return Math.round(value * 1_000);
  if (normalized.includes('jt')) return Math.round(value * 1_000_000);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function skuRamGb(title: string, options: Array<{ axis: string; value: string }>): number | null {
  const optionText = options.map((option) => `${option.axis} ${option.value}`).join(' ');
  const explicit = optionText.match(/(?:ram|memory)[^\d]{0,12}(4|8|12|16|24|32|64)\s*gb/i);
  const generic = optionText.match(/\b(4|8|12|16|24|32|64)\s*gb\b/i);
  const titleMatch = title.match(/(?:ram|memory)[^\d]{0,12}(4|8|12|16|24|32|64)\s*gb/i);
  return Number(explicit?.[1] ?? generic?.[1] ?? titleMatch?.[1]) || null;
}

async function inspectBounded(
  gateway: TokopediaGateway,
  leads: Array<{ url: string }>,
  concurrency: number,
) {
  const results: PromiseSettledResult<Awaited<ReturnType<TokopediaGateway['inspectProduct']>>>[] = new Array(leads.length);
  let cursor = 0;
  async function worker() {
    while (cursor < leads.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: 'fulfilled', value: await gateway.inspectProduct(leads[index].url) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, leads.length) }, () => worker()));
  return results;
}

export async function huntProducts(gateway: TokopediaGateway, input: HuntProductsInput) {
  const discoveries = await Promise.all(
    input.queries.map((query) =>
      gateway.search({
        query,
        page: 1,
        limit: input.listingsPerQuery ?? 10,
        priceMin: input.criteria.priceMin,
        priceMax: input.criteria.priceMax,
        sort: 'relevance',
      }),
    ),
  );

  const unique = new Map<string, (typeof discoveries)[number]['items'][number]>();
  for (const discovery of discoveries) {
    for (const listing of discovery.items) unique.set(listing.productId || listing.url, listing);
  }
  const leads = [...unique.values()].slice(0, input.maxListingsToInspect ?? 20);
  const concurrency = Math.max(1, Math.min(input.inspectionConcurrency ?? 4, 8));
  const inspected = await inspectBounded(gateway, leads, concurrency);
  const candidates: HuntCandidate[] = [];
  const failures: Array<{ url: string; error: string }> = [];
  const verificationQuestions = new Set<string>();

  inspected.forEach((result, index) => {
    const lead = leads[index];
    if (result.status === 'rejected') {
      failures.push({ url: lead.url, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      return;
    }
    const { snapshot, analysis } = result.value;
    for (const question of analysis.verificationQuestions) verificationQuestions.add(question);
    const specBase = `${snapshot.listing.title} ${snapshot.description} ${snapshot.specs.map((spec) => `${spec.label} ${spec.value}`).join(' ')}`;
    const sourceSkus = snapshot.skus.length > 0
      ? snapshot.skus
      : [{
          productId: snapshot.listing.productId,
          title: snapshot.listing.title,
          url: snapshot.listing.url,
          price: snapshot.listing.displayPrice,
          options: [],
          stock: { value: null, status: 'unknown' as const },
          buyable: snapshot.listing.status === 'ACTIVE',
          cod: false,
        }];
    for (const sku of sourceSkus) {
      if (!sku.buyable) continue;
      candidates.push({
        productId: snapshot.listing.productId,
        skuId: sku.productId,
        title: `${sku.title || snapshot.listing.title} ${sku.options.map((option) => `${option.axis} ${option.value}`).join(' ')}`.trim(),
        url: sku.url || snapshot.listing.url,
        price: sku.price.value,
        rating: snapshot.listing.rating ?? lead.rating ?? 0,
        reviewCount: snapshot.listing.reviewCount,
        shopTransactions: null,
        productSoldCount: numericSold(snapshot.listing.soldText),
        stock: sku.stock.value,
        ramGb: skuRamGb(sku.title, sku.options),
        specText: `${specBase} ${sku.options.map((option) => `${option.axis} ${option.value}`).join(' ')}`,
        issueSeverities: analysis.issues.map((issue) => issue.severity),
      });
    }
  });

  return {
    queries: input.queries,
    discoveredListings: unique.size,
    inspectedListings: inspected.length - failures.length,
    failedInspections: failures.length,
    candidateSkus: candidates.length,
    shortlist: buildShortlist(candidates, input.criteria),
    failures,
    verificationQuestions: [...verificationQuestions],
    provenance: discoveries.map((result) => result.provenance),
  };
}
