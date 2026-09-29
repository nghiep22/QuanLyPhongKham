export type Split = 'train' | 'validation' | 'test';

export type DocumentRecord = {
  id: string;
  category: string;
  text: string;
  split: Split;
};

export type ManualQuery = { id: string; query: string; relevantCategory: string };

export type TfidfConfig = {
  minDf: number;
  maxDf: number;
  ngramMax: 1 | 2;
};

export type WeightedTerm = [termId: number, weight: number];

export type SearchIndex = {
  schemaVersion: 1;
  createdAtUtc: string;
  source: string;
  config: TfidfConfig;
  categories: string[];
  vocabulary: string[];
  idf: number[];
  documents: Array<Pick<DocumentRecord, 'id' | 'category' | 'text'>>;
  vectors: WeightedTerm[][];
};

export type SearchHit = {
  id: string;
  category: string;
  score: number;
  snippet: string;
  contributingTerms: Array<{ term: string; contribution: number }>;
};
