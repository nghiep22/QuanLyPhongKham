import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadSplits } from './data.js';
import { aggregate, manualQueriesAreValid, queryMetric, shortQuery, type AggregateMetric, type QueryMetric } from './metrics.js';
import { MODEL_PATH, RESULTS_PATH, ROOT } from './paths.js';
import { keywordOverlap, TfidfSearcher } from './search.js';
import { fitTfidf } from './tfidf.js';
import { uniqueTerms } from './text.js';
import type { DocumentRecord, ManualQuery, SearchIndex, TfidfConfig } from './types.js';

type ExperimentResult = { name: string; config: TfidfConfig | null; vocabularySize: number; validation: AggregateMetric; manual: AggregateMetric };
const CONFIGS: Array<{ name: string; config: TfidfConfig }> = [
  { name: 'unigram', config: { minDf: 3, maxDf: 0.95, ngramMax: 1 } },
  { name: 'unigram_bigram', config: { minDf: 3, maxDf: 0.95, ngramMax: 2 } },
  { name: 'low_min_df', config: { minDf: 2, maxDf: 0.95, ngramMax: 2 } },
  { name: 'high_min_df_low_max_df', config: { minDf: 5, maxDf: 0.85, ngramMax: 2 } },
];

async function manualQueries(): Promise<ManualQuery[]> {
  const queries = JSON.parse(await readFile(join(ROOT, 'data/manual-queries.json'), 'utf8')) as ManualQuery[];
  if (!manualQueriesAreValid(queries)) throw new Error('Expected at least 30 unique, labeled manual queries.');
  return queries;
}

function validationSample(documents: DocumentRecord[]): DocumentRecord[] {
  const categories = [...new Set(documents.map((item) => item.category))].sort();
  return categories.flatMap((category) => documents.filter((item) => item.category === category).slice(0, 25));
}

function scoreTfidf(index: SearchIndex, queries: Array<{ query: string; relevantCategory: string }>): AggregateMetric {
  const searcher = new TfidfSearcher(index);
  return aggregate(queries.map(({ query, relevantCategory }) => {
    const start = performance.now();
    const ranked = searcher.search(query, 10);
    return queryMetric(query, relevantCategory, ranked, performance.now() - start);
  }));
}

function scoreBaseline(index: SearchIndex, queries: Array<{ query: string; relevantCategory: string }>): AggregateMetric {
  const documentWords = index.documents.map((document) => uniqueTerms(document.text));
  return aggregate(queries.map(({ query, relevantCategory }) => {
    const start = performance.now();
    const ranked = keywordOverlap(query, index.documents, 10, documentWords);
    return queryMetric(query, relevantCategory, ranked, performance.now() - start);
  }));
}

function svgBarChart(results: ExperimentResult[]): string {
  const rows = results.map((item, index) => {
    const y = 65 + index * 58;
    const width = Math.round(item.validation.precisionAt5 * 450);
    const label = item.name.replaceAll('_', ' ');
    return `<text x="25" y="${y}" font-size="15" fill="#17352f">${label}</text><rect x="245" y="${y - 19}" width="${width}" height="26" rx="5" fill="#19846e"/><text x="${252 + width}" y="${y}" font-size="14" fill="#17352f">${item.validation.precisionAt5.toFixed(3)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="790" height="${110 + results.length * 58}" viewBox="0 0 790 ${110 + results.length * 58}"><rect width="100%" height="100%" fill="white"/><text x="25" y="28" font-size="20" font-weight="700" fill="#17352f">Validation Precision@5</text>${rows}<text x="245" y="${90 + results.length * 58}" font-size="12" fill="#536a62">0</text><text x="690" y="${90 + results.length * 58}" font-size="12" fill="#536a62">1.0</text></svg>`;
}

function confusionSvg(metric: AggregateMetric, categories: string[]): string {
  const size = 35;
  const top = 120;
  const left = 180;
  const rows = categories.flatMap((actual, row) => categories.map((predicted, column) => {
    const count = metric.confusion[actual]?.[predicted] ?? 0;
    const opacity = Math.min(0.85, 0.1 + count / 25);
    return `<rect x="${left + column * size}" y="${top + row * size}" width="${size - 2}" height="${size - 2}" fill="#19846e" fill-opacity="${opacity}"/><text x="${left + column * size + 16}" y="${top + row * size + 22}" text-anchor="middle" font-size="11">${count}</text>`;
  })).join('');
  const labels = categories.map((category, index) => `<text x="10" y="${top + index * size + 22}" font-size="12">${category}</text><text x="${left + index * size + 17}" y="${top - 8}" text-anchor="middle" font-size="10" transform="rotate(-45 ${left + index * size + 17} ${top - 8})">${category}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="${top + categories.length * size + 20}" viewBox="0 0 500 ${top + categories.length * size + 20}"><rect width="100%" height="100%" fill="white"/><text x="10" y="26" font-size="18" font-weight="700">Top result by category</text><text x="10" y="48" font-size="12">Rows: actual; columns: top ranked result</text>${rows}${labels}</svg>`;
}

export async function train(): Promise<void> {
  const all = await loadSplits();
  const trainDocs = all.filter((item) => item.split === 'train');
  const validationDocs = validationSample(all.filter((item) => item.split === 'validation'));
  const heldOutQueries = validationDocs.map((item) => ({ query: shortQuery(item), relevantCategory: item.category }));
  const authoredQueries = await manualQueries();
  const baselineIndex = fitTfidf(trainDocs, CONFIGS[0]!.config);
  const experiments: ExperimentResult[] = [{
    name: 'keyword_overlap', config: null, vocabularySize: 0,
    validation: scoreBaseline(baselineIndex, heldOutQueries),
    manual: scoreBaseline(baselineIndex, authoredQueries.map(({ query, relevantCategory }) => ({ query, relevantCategory }))),
  }];
  for (const candidate of CONFIGS) {
    const index = fitTfidf(trainDocs, candidate.config);
    experiments.push({ name: candidate.name, config: candidate.config, vocabularySize: index.vocabulary.length,
      validation: scoreTfidf(index, heldOutQueries), manual: scoreTfidf(index, authoredQueries) });
  }
  const chosen = experiments.filter((item) => item.config).sort((a, b) =>
    b.validation.precisionAt5 - a.validation.precisionAt5 || b.validation.mrr - a.validation.mrr || a.vocabularySize - b.vocabularySize)[0]!;
  const finalTrain = all.filter((item) => item.split !== 'test');
  const finalIndex = fitTfidf(finalTrain, chosen.config!);
  await mkdir(join(ROOT, 'models'), { recursive: true });
  await mkdir(join(ROOT, 'reports/figures'), { recursive: true });
  await writeFile(MODEL_PATH, JSON.stringify(finalIndex), 'utf8');
  await writeFile(join(ROOT, 'reports/validation.json'), JSON.stringify({ chosen: chosen.name, experiments, heldOutQueryCount: heldOutQueries.length, manualQueryCount: authoredQueries.length }, null, 2), 'utf8');
  await writeFile(join(ROOT, 'reports/figures/validation-precision.svg'), svgBarChart(experiments), 'utf8');
  console.log(`Selected ${chosen.name}; vocabulary ${finalIndex.vocabulary.length}; indexed ${finalIndex.documents.length} documents.`);
}

export async function evaluate(): Promise<void> {
  const all = await loadSplits();
  const testDocs = validationSample(all.filter((item) => item.split === 'test'));
  const index = JSON.parse(await readFile(MODEL_PATH, 'utf8')) as SearchIndex;
  const validation = JSON.parse(await readFile(join(ROOT, 'reports/validation.json'), 'utf8')) as { chosen: string; experiments: ExperimentResult[] };
  const queries = testDocs.map((item) => ({ query: shortQuery(item), relevantCategory: item.category }));
  const manual = await manualQueries();
  const test = scoreTfidf(index, queries);
  const baseline = scoreBaseline(index, queries);
  const manualResult = scoreTfidf(index, manual);
  const results = {
    evaluatedAtUtc: new Date().toISOString(), selectedModel: validation.chosen,
    validation: validation.experiments, test, baselineTest: baseline, manual: manualResult,
    index: { documents: index.documents.length, vocabularySize: index.vocabulary.length, categories: index.categories, config: index.config },
    protocol: 'Validation selected model; final index refit on original train plus validation; official by-date test used only for this final report. Relevance proxy is same newsgroup category.',
  };
  await mkdir(join(ROOT, 'reports/figures'), { recursive: true });
  await writeFile(RESULTS_PATH, JSON.stringify(results, null, 2), 'utf8');
  await writeFile(join(ROOT, 'reports/figures/test-confusion.svg'), confusionSvg(test, index.categories), 'utf8');
  await writeFile(join(ROOT, 'reports/model-card.md'), `# Model card\n\n- Method: word TF–IDF with L2 normalization and cosine ranking.\n- Selected configuration: ${validation.chosen} ${JSON.stringify(index.config)}.\n- Training/index corpus: ${index.documents.length} original train and validation posts across ${index.categories.length} categories.\n- Vocabulary: ${index.vocabulary.length} terms.\n- Validation: model selected without inspecting final test metrics.\n- Final held-out test (${test.queries} document-derived short queries): Precision@5 ${test.precisionAt5.toFixed(3)}, MRR ${test.mrr.toFixed(3)}, median search ${test.medianLatencyMs.toFixed(1)} ms, p95 ${test.p95LatencyMs.toFixed(1)} ms.\n- Baseline test: Precision@5 ${baseline.precisionAt5.toFixed(3)}, MRR ${baseline.mrr.toFixed(3)}.\n- Manual 32-query category proxy: Precision@5 ${manualResult.precisionAt5.toFixed(3)}, MRR ${manualResult.mrr.toFixed(3)}.\n- Limitations: English news discussions, lexical overlap rather than true semantic understanding, category labels used as relevance proxy, historical data and potentially sensitive or objectionable source content. No clinical advice.\n- Safety: headers, quoted lines, email addresses and links removed before indexing; only snippets returned. Review source material before public deployment.\n`, 'utf8');
  console.log(`Final test: P@5=${test.precisionAt5.toFixed(3)} MRR=${test.mrr.toFixed(3)}; baseline P@5=${baseline.precisionAt5.toFixed(3)}.`);
}
