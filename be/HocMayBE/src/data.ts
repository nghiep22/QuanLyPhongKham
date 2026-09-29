import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { cleanNewsgroup } from './text.js';
import { PROCESSED_DIR, RAW_DIR } from './paths.js';
import type { DocumentRecord, Split } from './types.js';

const run = promisify(execFile);
export const CATEGORIES = [
  'comp.graphics', 'comp.sys.ibm.pc.hardware', 'misc.forsale', 'rec.autos',
  'rec.sport.baseball', 'sci.med', 'sci.space', 'talk.politics.guns',
] as const;
export const DATASET_URL = 'https://ndownloader.figshare.com/files/5975967';
export const ARCHIVE_SHA256 = '8f1b2514ca22a5ade8fbb9cfa5727df95fa587f4c87b786e15c759fa66d95610';
const ARCHIVE_NAME = '20news-bydate.tar.gz';
const SPLITS_PATH = join(PROCESSED_DIR, 'splits.json');

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const result = [...items];
  const random = seededRandom(seed);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

async function downloadDataset(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });
  const archive = join(RAW_DIR, ARCHIVE_NAME);
  let valid = false;
  try { valid = createHash('sha256').update(await readFile(archive)).digest('hex') === ARCHIVE_SHA256; }
  catch { /* download below */ }
  if (!valid) {
    const response = await fetch(DATASET_URL, { redirect: 'follow' });
    if (!response.ok || !response.body) throw new Error(`Dataset download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(archive));
  }
  const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (checksum !== ARCHIVE_SHA256) throw new Error(`Archive checksum mismatch: ${checksum}`);
  const trainFolder = join(RAW_DIR, '20news-bydate-train');
  const testFolder = join(RAW_DIR, '20news-bydate-test');
  if (!(await exists(trainFolder)) || !(await exists(testFolder))) {
    await run('tar', ['-xzf', archive, '-C', RAW_DIR]);
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function readCategory(category: string, sourceSplit: 'train' | 'test'): Promise<DocumentRecord[]> {
  const folder = join(RAW_DIR, `20news-bydate-${sourceSplit}`, category);
  const names = (await readdir(folder)).sort();
  const records: DocumentRecord[] = [];
  for (const name of names) {
    const raw = (await readFile(join(folder, name))).toString('latin1');
    records.push({ id: `${sourceSplit}/${category}/${name}`, category, text: cleanNewsgroup(raw), split: sourceSplit });
  }
  return records;
}

export async function prepareData(): Promise<{ train: number; validation: number; test: number }> {
  await downloadDataset();
  const candidates: DocumentRecord[] = [];
  for (const [categoryIndex, category] of CATEGORIES.entries()) {
    const originalTrain = await readCategory(category, 'train');
    const shuffled = shuffle(originalTrain, 42 + categoryIndex);
    const validationSize = Math.round(shuffled.length * 0.2);
    shuffled.forEach((document, index) => { document.split = index < validationSize ? 'validation' : 'train'; });
    candidates.push(...shuffled, ...await readCategory(category, 'test'));
  }
  const order: Split[] = ['train', 'validation', 'test'];
  const seen = new Set<string>();
  const kept: DocumentRecord[] = [];
  const excluded: { empty: number; duplicate: number } = { empty: 0, duplicate: 0 };
  for (const split of order) {
    for (const document of candidates.filter((item) => item.split === split)) {
      if (document.text.length < 40) { excluded.empty += 1; continue; }
      const digest = createHash('sha256').update(document.text.toLowerCase()).digest('hex');
      if (seen.has(digest)) { excluded.duplicate += 1; continue; }
      seen.add(digest);
      kept.push(document);
    }
  }
  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(SPLITS_PATH, JSON.stringify(kept), 'utf8');
  const counts = Object.fromEntries(order.map((split) => [split, kept.filter((item) => item.split === split).length])) as Record<Split, number>;
  const categoryCounts = Object.fromEntries(CATEGORIES.map((category) => [category,
    Object.fromEntries(order.map((split) => [split, kept.filter((item) => item.category === category && item.split === split).length]))]));
  await writeFile(join(PROCESSED_DIR, 'quality.json'), JSON.stringify({
    source: DATASET_URL, downloadedAtUtc: new Date().toISOString(), sha256: ARCHIVE_SHA256,
    selectedCategories: CATEGORIES, rawCount: candidates.length, counts, excluded,
    categoryCounts, seed: 42, note: 'Official by-date train/test; 20% stratified validation from train; deterministic cleanup and cross-split deduplication.',
  }, null, 2), 'utf8');
  return counts;
}

export async function loadSplits(): Promise<DocumentRecord[]> {
  try { return JSON.parse(await readFile(SPLITS_PATH, 'utf8')) as DocumentRecord[]; }
  catch { throw new Error('Processed data is missing. Run npm run data:prepare first.'); }
}
