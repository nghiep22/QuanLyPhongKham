import { readFile } from 'node:fs/promises';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { RESULTS_PATH } from './paths.js';
import { TfidfSearcher } from './search.js';

const searchInput = z.object({
  q: z.string().trim().min(2).max(200),
  k: z.coerce.number().int().min(1).max(50).default(10),
  category: z.string().optional(),
});

export function createApp(searcher: TfidfSearcher | null) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: ['http://localhost:5175', 'http://127.0.0.1:5175'] }));

  app.get('/api/health', (_request, response) => {
    response.status(searcher ? 200 : 503).json({ status: searcher ? 'ready' : 'model_missing' });
  });

  app.get('/api/meta', (_request, response) => {
    if (!searcher) { response.status(503).json({ error: { code: 'MODEL_MISSING', message: 'Run npm run pipeline in be/HocMayBE first.' } }); return; }
    const { index } = searcher;
    response.json({ data: { categories: index.categories, documents: index.documents.length, vocabularySize: index.vocabulary.length, config: index.config, createdAtUtc: index.createdAtUtc,
      scope: 'Historical English 20 Newsgroups posts; lexical similarity only, not medical advice.' } });
  });

  app.get('/api/search', (request, response) => {
    if (!searcher) { response.status(503).json({ error: { code: 'MODEL_MISSING', message: 'Run npm run pipeline in be/HocMayBE first.' } }); return; }
    const parsed = searchInput.safeParse(request.query);
    if (!parsed.success) { response.status(400).json({ error: { code: 'INVALID_QUERY', message: 'q must contain 2–200 characters; k must be 1–50.', details: z.flattenError(parsed.error).fieldErrors } }); return; }
    if (parsed.data.category && !searcher.index.categories.includes(parsed.data.category)) {
      response.status(400).json({ error: { code: 'INVALID_CATEGORY', message: 'Unknown category.' } }); return;
    }
    const start = performance.now();
    const hits = searcher.search(parsed.data.q, parsed.data.k, parsed.data.category);
    response.json({ data: hits, meta: { query: parsed.data.q, k: parsed.data.k, category: parsed.data.category ?? null,
      count: hits.length, responseMs: Number((performance.now() - start).toFixed(2)),
      warning: hits.length === 0 ? 'No indexed vocabulary matched the query.' : null } });
  });

  app.get('/api/evaluation', async (_request, response) => {
    try { response.json({ data: JSON.parse(await readFile(RESULTS_PATH, 'utf8')) }); }
    catch { response.status(503).json({ error: { code: 'EVALUATION_MISSING', message: 'Run npm run evaluate first.' } }); }
  });

  app.use((_request, response) => { response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } }); });
  return app;
}
