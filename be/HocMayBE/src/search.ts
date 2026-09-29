import { uniqueTerms } from './text.js';
import { vectorizeQuery } from './tfidf.js';
import type { SearchHit, SearchIndex, WeightedTerm } from './types.js';

type Posting = [documentIndex: number, weight: number];

function snippet(text: string, query: string): string {
  const safeText = text.replace(/\b(phone|tel|fax):\s*\+?[\d() .\/-]{6,}\d\b/gi, '$1: [removed]');
  const words = [...uniqueTerms(query)].filter((word) => word.length >= 3);
  const lower = safeText.toLowerCase();
  const matches = words.map((word) => lower.indexOf(word)).filter((position) => position >= 0);
  const first = matches.length ? Math.min(...matches) : 0;
  const start = Math.max(0, first - 70);
  const end = Math.min(safeText.length, start + 240);
  return `${start ? '…' : ''}${safeText.slice(start, end)}${end < safeText.length ? '…' : ''}`;
}

export class TfidfSearcher {
  private readonly postings = new Map<number, Posting[]>();
  private readonly termIds: Map<string, number>;

  constructor(readonly index: SearchIndex) {
    if (index.schemaVersion !== 1 || index.documents.length !== index.vectors.length) {
      throw new Error('Invalid search index artifact.');
    }
    this.termIds = new Map(index.vocabulary.map((value, termId) => [value, termId]));
    for (const [documentIndex, vector] of index.vectors.entries()) {
      for (const [termId, weight] of vector) {
        const list = this.postings.get(termId) ?? [];
        list.push([documentIndex, weight]);
        this.postings.set(termId, list);
      }
    }
  }

  search(query: string, k = 10, category?: string): SearchHit[] {
    const queryVector = vectorizeQuery(query, this.index, this.termIds);
    if (queryVector.length === 0) return [];
    const scores = new Map<number, number>();
    const contributions = new Map<number, Array<{ term: string; contribution: number }>>();
    for (const [termId, queryWeight] of queryVector) {
      for (const [documentIndex, documentWeight] of this.postings.get(termId) ?? []) {
        if (category && this.index.documents[documentIndex]!.category !== category) continue;
        const contribution = queryWeight * documentWeight;
        scores.set(documentIndex, (scores.get(documentIndex) ?? 0) + contribution);
        const words = contributions.get(documentIndex) ?? [];
        words.push({ term: this.index.vocabulary[termId]!, contribution });
        contributions.set(documentIndex, words);
      }
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1] || this.index.documents[a[0]]!.id.localeCompare(this.index.documents[b[0]]!.id))
      .slice(0, k).map(([documentIndex, score]) => {
        const document = this.index.documents[documentIndex]!;
        return {
          id: document.id,
          category: document.category,
          score: Number(score.toFixed(6)),
          snippet: snippet(document.text, query),
          contributingTerms: (contributions.get(documentIndex) ?? []).sort((a, b) => b.contribution - a.contribution).slice(0, 5)
            .map(({ term, contribution }) => ({ term, contribution: Number(contribution.toFixed(6)) })),
        };
      });
  }
}

export function keywordOverlap(query: string, documents: SearchIndex['documents'], k: number, documentWords?: Set<string>[]): Array<{ id: string; category: string; score: number }> {
  const queryWords = uniqueTerms(query);
  return documents.map((document, index) => {
    const words = documentWords?.[index] ?? uniqueTerms(document.text);
    let count = 0;
    for (const word of queryWords) if (words.has(word)) count += 1;
    return { id: document.id, category: document.category, score: count };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
}
