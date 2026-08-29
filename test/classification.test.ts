import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCandidate } from '../src/domain/classification.js';

test('classifyCandidate excludes accessory-first listings with auditable reasons', () => {
  for (const title of [
    'Phone case for iPhone 15',
    'Laptop charger USB-C 65W',
    'Replacement keyboard for ThinkPad X390 Yoga',
    'Screen protector ThinkPad Yoga',
    'USB-C charging cable',
  ]) {
    const result = classifyCandidate({ title, query: 'thinkpad x390 yoga' });
    assert.equal(result.classification, 'accessory', title);
    assert.equal(result.reasons.length > 0, true);
  }
});

test('classifyCandidate keeps a genuine target that only mentions included accessories in its description', () => {
  const result = classifyCandidate({
    title: 'Lenovo ThinkPad X390 Yoga i5 16GB 256GB',
    description: 'Laptop lengkap dengan charger dan stylus.',
    query: 'thinkpad x390 yoga',
  });

  assert.equal(result.classification, 'target');
  assert.equal(result.reasons.includes('query_terms_match_title'), true);
});

test('classifyCandidate leaves ambiguous listings visible as uncertain', () => {
  const result = classifyCandidate({
    title: 'ThinkPad X390 Yoga parts unit',
    query: 'thinkpad x390 yoga',
  });

  assert.equal(result.classification, 'uncertain');
  assert.equal(result.reasons.includes('parts_or_replacement_language'), true);
});
