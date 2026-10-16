export interface HuntCandidate {
  productId: string;
  skuId: string;
  title: string;
  url: string;
  price: number;
  rating: number;
  reviewCount: number;
  shopTransactions: number | null;
  productSoldCount?: number | null;
  stock: number | null;
  ramGb?: number | null;
  specText: string;
  issueSeverities: Array<'low' | 'medium' | 'high'>;
  classification?: 'target' | 'accessory' | 'uncertain';
  classificationReasons?: string[];
}

export interface HuntCriteria {
  priceMin?: number;
  priceMax?: number;
  mustInclude?: string[];
  mustExclude?: string[];
  minRamGb?: number;
  limit?: number;
}

function text(candidate: HuntCandidate): string {
  return `${candidate.title} ${candidate.specText}`.toLowerCase();
}

function containsTerm(haystack: string, term: string): boolean {
  const normalized = term.toLowerCase().trim();
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

function detectRamGb(candidate: HuntCandidate): number | null {
  if (candidate.ramGb !== undefined) return candidate.ramGb;
  const matches = [...text(candidate).matchAll(/(?:ram|memory|memori)[^\d]{0,12}(4|8|12|16|24|32|64)\s*gb\b/g)]
    .map((match) => Number(match[1]));
  return matches.length ? Math.max(...matches) : null;
}

function score(candidate: HuntCandidate, criteria: HuntCriteria): { value: number; reasons: string[]; risks: string[] } {
  const reasons: string[] = [];
  const risks: string[] = [];
  const ceiling = criteria.priceMax ?? Math.max(candidate.price, 1);
  const floor = criteria.priceMin ?? 0;
  const span = Math.max(ceiling - floor, 1);
  const priceScore = Math.max(0, Math.min(35, ((ceiling - candidate.price) / span) * 35));
  const ratingScore = candidate.rating > 0 ? Math.min(20, (candidate.rating / 5) * 20) : 0;
  const reviewScore = Math.min(12, Math.log10(candidate.reviewCount + 1) * 6);
  const shopScore = candidate.shopTransactions === null
    ? 0
    : Math.min(15, Math.log10(candidate.shopTransactions + 1) * 4);
  const stockScore = candidate.stock === null ? 2 : candidate.stock > 0 ? Math.min(8, 4 + Math.log10(candidate.stock + 1) * 3) : -30;
  const ram = detectRamGb(candidate);
  const specScore = ram !== null && ram >= 16 ? 10 : 0;
  let riskPenalty = 0;
  if (candidate.issueSeverities.includes('high')) {
    riskPenalty += 30;
    risks.push('high_severity_listing_issue');
  }
  if (candidate.reviewCount === 0) {
    riskPenalty += 8;
    risks.push('no_product_reviews');
  }
  if (candidate.shopTransactions !== null && candidate.shopTransactions < 100) {
    riskPenalty += 8;
    risks.push('low_shop_history');
  }
  if (candidate.shopTransactions === null) risks.push('shop_history_unknown');
  if (candidate.stock === 1) risks.push('last_reported_unit');
  if (priceScore >= 20) reasons.push('strong_price_position');
  if (ram !== null && ram >= 16) reasons.push('meets_16gb_preference');
  if (candidate.rating >= 4.8 && candidate.reviewCount >= 10) reasons.push('strong_product_feedback');
  if (candidate.shopTransactions !== null && candidate.shopTransactions >= 1_000) reasons.push('established_shop_history');
  return {
    value: Math.round((priceScore + ratingScore + reviewScore + shopScore + stockScore + specScore - riskPenalty) * 10) / 10,
    reasons,
    risks,
  };
}

export function buildShortlist(candidates: HuntCandidate[], criteria: HuntCriteria) {
  const seen = new Set<string>();
  const rejected: Array<HuntCandidate & { rejectionReasons: string[] }> = [];
  const accepted: HuntCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.productId}:${candidate.skuId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const haystack = text(candidate);
    const rejectionReasons: string[] = [];
    if (criteria.priceMin !== undefined && candidate.price < criteria.priceMin) rejectionReasons.push('below_price_floor');
    if (criteria.priceMax !== undefined && candidate.price > criteria.priceMax) rejectionReasons.push('above_price_ceiling');
    if (candidate.classification === 'accessory') rejectionReasons.push('classified:accessory');
    if (candidate.classification === 'uncertain') rejectionReasons.push('classified:uncertain');
    for (const word of criteria.mustInclude ?? []) {
      if (!containsTerm(haystack, word)) rejectionReasons.push(`missing:${word}`);
    }
    for (const word of criteria.mustExclude ?? []) {
      if (containsTerm(haystack, word)) rejectionReasons.push(`excluded:${word}`);
    }
    const ram = detectRamGb(candidate);
    if (criteria.minRamGb !== undefined && (ram === null || ram < criteria.minRamGb)) {
      rejectionReasons.push(`ram_below:${criteria.minRamGb}gb`);
    }
    if (candidate.stock === 0) rejectionReasons.push('out_of_stock');
    if (rejectionReasons.length) rejected.push({ ...candidate, rejectionReasons });
    else accepted.push(candidate);
  }

  const ranked = accepted
    .map((candidate) => {
      const scored = score(candidate, criteria);
      return { ...candidate, score: scored.value, scoreReasons: scored.reasons, riskFlags: scored.risks };
    })
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, criteria.limit ?? 10)
    .map((candidate, index) => ({ rank: index + 1, ...candidate }));

  return {
    ranked,
    rejected,
    methodology: {
      hardConstraintsApplied: true,
      dedupeKey: 'productId:skuId',
      scoreRange: 'open; higher is better',
      components: ['price', 'rating', 'review depth', 'shop history', 'stock', 'RAM', 'listing-risk penalties'],
      caveat: 'Scores compare marketplace evidence; they do not verify the physical unit.',
    },
  };
}
