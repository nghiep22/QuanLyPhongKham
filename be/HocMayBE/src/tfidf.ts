import { terms } from './text.js';
import type { DocumentRecord, SearchIndex, TfidfConfig, WeightedTerm } from './types.js';

function countTerms(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

export function fitTfidf(documents: DocumentRecord[], config: TfidfConfig): SearchIndex {
  if (documents.length === 0) throw new Error('Training corpus is empty.');
  const documentFrequency = new Map<string, number>();
  const countsByDocument = documents.map((document) => countTerms(terms(document.text, config.ngramMax)));
  for (const counts of countsByDocument) {
    for (const word of counts.keys()) documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
  }
  const vocabulary = [...documentFrequency.entries()]
    .filter(([, frequency]) => frequency >= config.minDf && frequency / documents.length <= config.maxDf)
    .map(([term]) => term).sort();
  if (vocabulary.length === 0) throw new Error('No vocabulary remains after minDf/maxDf filtering.');
  const termIds = new Map(vocabulary.map((value, index) => [value, index]));
  const idf = vocabulary.map((word) => Math.log((1 + documents.length) / (1 + documentFrequency.get(word)!)) + 1);
  const vectors = countsByDocument.map((counts) => vectorFromCounts(counts, termIds, idf));
  return {
    schemaVersion: 1,
    createdAtUtc: new Date().toISOString(),
    source: '20 Newsgroups by-date train split',
    config,
    categories: [...new Set(documents.map((document) => document.category))].sort(),
    vocabulary,
    idf,
    documents: documents.map(({ id, category, text }) => ({ id, category, text })),
    vectors,
  };
}

function vectorFromCounts(counts: Map<string, number>, termIds: Map<string, number>, idf: number[]): WeightedTerm[] {
  const raw: WeightedTerm[] = [];
  let normSquared = 0;
  for (const [term, frequency] of counts) {
    const termId = termIds.get(term);
    if (termId === undefined) continue;
    const weight = frequency * idf[termId]!;
    raw.push([termId, weight]);
    normSquared += weight * weight;
  }
  const norm = Math.sqrt(normSquared);
  return norm === 0 ? [] : raw.map(([id, weight]): WeightedTerm => [id, weight / norm]).sort((a, b) => a[0] - b[0]);
}

export function vectorizeQuery(query: string, index: SearchIndex, termIds?: Map<string, number>): WeightedTerm[] {
  const ids = termIds ?? new Map(index.vocabulary.map((value, termId) => [value, termId]));
  return vectorFromCounts(countTerms(terms(query, index.config.ngramMax)), ids, index.idf);
}

export function cosine(a: WeightedTerm[], b: WeightedTerm[]): number {
  let i = 0;
  let j = 0;
  let score = 0;
  while (i < a.length && j < b.length) {
    const left = a[i]!;
    const right = b[j]!;
    if (left[0] === right[0]) { score += left[1] * right[1]; i += 1; j += 1; }
    else if (left[0] < right[0]) i += 1;
    else j += 1;
  }
  return score;
}
