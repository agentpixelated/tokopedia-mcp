export type CandidateClassification = 'target' | 'accessory' | 'uncertain';

export interface CandidateClassificationInput {
  title: string;
  description?: string;
  query?: string;
}

export interface CandidateClassificationResult {
  classification: CandidateClassification;
  reasons: string[];
  evidence: Array<{ field: 'title' | 'description' | 'query'; excerpt: string }>;
}

const ACCESSORY_NOUN = /\b(case|cover|charger|cable|screen\s*protector|tempered\s*glass|adapter|adaptor|battery|keyboard|keycap|hinge|skin|sleeve|bag|stylus|pen|dock|docking)\b/i;
const DEVICE_NOUN = /\b(laptop|notebook|ultrabook|chromebook|tablet|smartphone|phone|handphone|hp|thinkpad|ideapad|macbook|iphone|galaxy)\b/i;
const PARTS_LANGUAGE = /\b(parts?\s*unit|spare\s*part|replacement|pengganti|kanibal|copotan|rusak|mati\s*total)\b/i;
const ACCESSORY_PREFIX = /^\s*(case|cover|charger|cable|screen\s*protector|tempered\s*glass|adapter|adaptor|battery|keyboard|keycap|hinge|skin|sleeve|bag|stylus|pen|dock|docking)\b/i;

function normalizedTerms(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1);
}

function allQueryTermsInTitle(query: string, title: string): boolean {
  const queryTerms = normalizedTerms(query);
  if (queryTerms.length === 0) return false;
  const titleTerms = new Set(normalizedTerms(title));
  return queryTerms.every((term) => titleTerms.has(term));
}

export function classifyCandidate(input: CandidateClassificationInput): CandidateClassificationResult {
  const title = input.title.trim();
  const description = input.description?.trim() ?? '';
  const query = input.query?.trim() ?? '';
  const reasons: string[] = [];
  const evidence: CandidateClassificationResult['evidence'] = [];

  if (PARTS_LANGUAGE.test(title)) {
    reasons.push('parts_or_replacement_language');
    evidence.push({ field: 'title', excerpt: title });
    if (ACCESSORY_NOUN.test(title) && /\b(for|untuk|compatible|kompatibel)\b/i.test(title)) {
      reasons.push('accessory_first_title');
      return { classification: 'accessory', reasons, evidence };
    }
    return { classification: 'uncertain', reasons, evidence };
  }

  const titleTerms = normalizedTerms(title);
  const accessoryPosition = titleTerms.findIndex((term) =>
    /^(case|cover|charger|cable|adapter|adaptor|battery|keyboard|keycap|hinge|skin|sleeve|bag|stylus|pen|dock|docking)$/.test(term),
  );
  const devicePosition = titleTerms.findIndex((term) =>
    /^(laptop|notebook|ultrabook|chromebook|tablet|smartphone|phone|handphone|hp|thinkpad|ideapad|macbook|iphone|galaxy)$/.test(term),
  );
  if (ACCESSORY_PREFIX.test(title)
    || (accessoryPosition >= 0 && (devicePosition < 0 || accessoryPosition <= devicePosition + 1))
    || (ACCESSORY_NOUN.test(title) && /\b(for|untuk|compatible|kompatibel)\b/i.test(title))) {
    reasons.push('accessory_first_title');
    evidence.push({ field: 'title', excerpt: title });
    return { classification: 'accessory', reasons, evidence };
  }

  const queryMatchesTitle = query ? allQueryTermsInTitle(query, title) : false;
  if (queryMatchesTitle) {
    reasons.push('query_terms_match_title');
    evidence.push({ field: 'query', excerpt: query });
    evidence.push({ field: 'title', excerpt: title });
    return { classification: 'target', reasons, evidence };
  }

  if (DEVICE_NOUN.test(title) && !ACCESSORY_PREFIX.test(title)) {
    reasons.push('device_noun_in_title');
    evidence.push({ field: 'title', excerpt: title });
    return { classification: 'target', reasons, evidence };
  }

  if (ACCESSORY_NOUN.test(description)) {
    reasons.push('accessory_mentioned_only_outside_title');
    evidence.push({ field: 'description', excerpt: description.slice(0, 240) });
  } else {
    reasons.push('insufficient_target_evidence');
  }
  return { classification: 'uncertain', reasons, evidence };
}
