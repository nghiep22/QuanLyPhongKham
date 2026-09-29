import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanNewsgroup } from '../src/text.js';
import { cosine, fitTfidf, vectorizeQuery } from '../src/tfidf.js';
import { TfidfSearcher } from '../src/search.js';
import { queryMetric } from '../src/metrics.js';

const documents = [
  { id: 'a', category: 'space', text: 'space rocket satellite', split: 'train' as const },
  { id: 'b', category: 'car', text: 'car engine road', split: 'train' as const },
  { id: 'c', category: 'space', text: 'rocket launch space', split: 'train' as const },
];

test('header, quotes and email are removed', () => {
  const result = cleanNewsgroup('From: somebody@example.com\nSubject: Space\n\nRocket launch\n> quoted@example.com\nContact me@example.com\n-- \nsignature');
  assert.equal(result, 'Rocket launch Contact [email removed]');
});

test('TF-IDF vectors are normalized and rank related documents first', () => {
  const index = fitTfidf(documents, { minDf: 1, maxDf: 1, ngramMax: 2 });
  const query = vectorizeQuery('rocket launch', index);
  assert.ok(Math.abs(cosine(query, query) - 1) < 1e-9);
  const results = new TfidfSearcher(index).search('rocket launch', 3);
  assert.equal(results[0]?.id, 'c');
  assert.equal(results.some((item) => item.category === 'car'), false);
  assert.ok(results[0]!.contributingTerms.length > 0);
});

test('held-out terms never enter fitted vocabulary', () => {
  const index = fitTfidf(documents.slice(0, 2), { minDf: 1, maxDf: 1, ngramMax: 1 });
  assert.equal(index.vocabulary.includes('unseenword'), false);
  assert.deepEqual(vectorizeQuery('unseenword', index), []);
});

test('precision and reciprocal rank use the same relevance category', () => {
  const metric = queryMetric('test', 'space', [{ category: 'car' }, { category: 'space' }, { category: 'space' }], 1);
  assert.equal(metric.precisionAt5, 0.4);
  assert.equal(metric.reciprocalRank, 0.5);
});
