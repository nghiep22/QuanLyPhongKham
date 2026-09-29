import { tokenize } from './text.js';
import type { DocumentRecord, ManualQuery } from './types.js';

export type RankedItem = { category: string };
export type QueryMetric = {
  query: string;
  relevantCategory: string;
  precisionAt5: number;
  reciprocalRank: number;
  latencyMs: number;
  topCategory: string | null;
};

export type AggregateMetric = {
  queries: number;
  precisionAt5: number;
  mrr: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  byCategory: Record<string, { queries: number; precisionAt5: number; mrr: number }>;
  errors: QueryMetric[];
  confusion: Record<string, Record<string, number>>;
};

export function shortQuery(document: DocumentRecord): string {
  return tokenize(document.text).slice(0, 18).join(' ');
}

export function queryMetric(query: string, relevantCategory: string, results: RankedItem[], latencyMs: number): QueryMetric {
  const topFive = results.slice(0, 5);
  const firstRelevant = results.findIndex((item) => item.category === relevantCategory);
  return {
    query,
    relevantCategory,
    precisionAt5: topFive.filter((item) => item.category === relevantCategory).length / 5,
    reciprocalRank: firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0,
    latencyMs,
    topCategory: results[0]?.category ?? null,
  };
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1] ?? sorted[0]!;
}

export function aggregate(metrics: QueryMetric[]): AggregateMetric {
  const categories = [...new Set(metrics.map((item) => item.relevantCategory))].sort();
  const byCategory = Object.fromEntries(categories.map((category) => {
    const group = metrics.filter((item) => item.relevantCategory === category);
    return [category, { queries: group.length, precisionAt5: mean(group.map((item) => item.precisionAt5)), mrr: mean(group.map((item) => item.reciprocalRank)) }];
  }));
  const confusion: Record<string, Record<string, number>> = {};
  for (const item of metrics) {
    confusion[item.relevantCategory] ??= {};
    const predicted = item.topCategory ?? 'no match';
    confusion[item.relevantCategory]![predicted] = (confusion[item.relevantCategory]![predicted] ?? 0) + 1;
  }
  return {
    queries: metrics.length,
    precisionAt5: mean(metrics.map((item) => item.precisionAt5)),
    mrr: mean(metrics.map((item) => item.reciprocalRank)),
    medianLatencyMs: percentile(metrics.map((item) => item.latencyMs), 0.5),
    p95LatencyMs: percentile(metrics.map((item) => item.latencyMs), 0.95),
    byCategory,
    errors: metrics.filter((item) => item.topCategory !== item.relevantCategory).sort((a, b) => a.reciprocalRank - b.reciprocalRank).slice(0, 12),
    confusion,
  };
}

export function manualQueriesAreValid(queries: ManualQuery[]): boolean {
  return queries.length >= 30 && new Set(queries.map((item) => item.id)).size === queries.length && queries.every((item) => item.query.trim() && item.relevantCategory.trim());
}
