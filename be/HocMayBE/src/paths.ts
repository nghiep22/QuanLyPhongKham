import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RAW_DIR = resolve(ROOT, 'data/raw');
export const PROCESSED_DIR = resolve(ROOT, 'data/processed');
export const MODEL_PATH = resolve(ROOT, 'models/search-index.json');
export const RESULTS_PATH = resolve(ROOT, 'reports/results.json');
