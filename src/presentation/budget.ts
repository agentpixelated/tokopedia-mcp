export interface OutputBudget {
  maxChars: number;
  maxItems: number;
}

interface BudgetedEnvelope {
  items: Array<Record<string, unknown>>;
  provenance?: unknown;
  truncation: {
    truncated: boolean;
    maxChars: number;
    maxItems: number;
    omittedItems: number;
    omittedFields: string[];
  };
}

function serializedLength(value: unknown): number {
  return JSON.stringify(value).length;
}

function requiredItem(value: unknown): Record<string, unknown> {
  const item = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
  const result: Record<string, unknown> = {};
  for (const field of ['productId', 'skuId', 'title', 'url', 'price', 'classification', 'score', 'rank']) {
    if (field in item) result[field] = item[field];
  }
  return Object.keys(result).length > 0 ? result : item;
}

export function applyOutputBudget(
  value: { items: unknown[]; provenance?: unknown },
  budget: OutputBudget,
): BudgetedEnvelope {
  if (!Number.isInteger(budget.maxChars) || budget.maxChars < 512) {
    throw new Error('maxChars must be an integer of at least 512.');
  }
  if (!Number.isInteger(budget.maxItems) || budget.maxItems < 1) {
    throw new Error('maxItems must be a positive integer.');
  }

  const selected = value.items.slice(0, budget.maxItems).map(requiredItem);
  const envelope: BudgetedEnvelope = {
    items: selected,
    provenance: value.provenance,
    truncation: {
      truncated: selected.length < value.items.length,
      maxChars: budget.maxChars,
      maxItems: budget.maxItems,
      omittedItems: value.items.length - selected.length,
      omittedFields: [],
    },
  };

  while (serializedLength(envelope) > budget.maxChars && envelope.items.length > 0) {
    envelope.items.pop();
    envelope.truncation.truncated = true;
    envelope.truncation.omittedItems += 1;
  }
  if (serializedLength(envelope) > budget.maxChars) {
    delete envelope.provenance;
    envelope.truncation.truncated = true;
    envelope.truncation.omittedFields.push('provenance');
  }
  if (serializedLength(envelope) > budget.maxChars) {
    throw new Error('maxChars is too small for truncation metadata.');
  }
  return envelope;
}
