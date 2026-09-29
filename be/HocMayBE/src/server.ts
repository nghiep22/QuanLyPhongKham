import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { MODEL_PATH } from './paths.js';
import { TfidfSearcher } from './search.js';
import type { SearchIndex } from './types.js';

let searcher: TfidfSearcher | null = null;
try { searcher = new TfidfSearcher(JSON.parse(await readFile(MODEL_PATH, 'utf8')) as SearchIndex); }
catch (error) { console.warn('Search model unavailable. Run npm run pipeline.', error); }

const port = Number(process.env.PORT ?? 4003);
createApp(searcher).listen(port, () => console.log(`HocMayBE listening on http://localhost:${port}`));
