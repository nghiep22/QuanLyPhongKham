import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { TfidfSearcher } from '../src/search.js';
import { fitTfidf } from '../src/tfidf.js';

const index = fitTfidf([
  { id: 'space/1', category: 'space', text: 'rocket launch satellite mission', split: 'train' },
  { id: 'cars/1', category: 'cars', text: 'car engine road repair', split: 'train' },
], { minDf: 1, maxDf: 1, ngramMax: 1 });

test('search API validates input and returns ranked JSON', async () => {
  const server = createApp(new TfidfSearcher(index)).listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const bad = await fetch(`${base}/api/search?q=x&k=100`);
    assert.equal(bad.status, 400);
    const unknown = await fetch(`${base}/api/search?q=rocket&category=unknown`);
    assert.equal(unknown.status, 400);
    const good = await fetch(`${base}/api/search?q=rocket%20launch&k=2`);
    assert.equal(good.status, 200);
    const result = await good.json() as { data: Array<{ id: string; contributingTerms: unknown[] }>; meta: { responseMs: number } };
    assert.equal(result.data[0]?.id, 'space/1');
    assert.ok(result.data[0]!.contributingTerms.length > 0);
    assert.ok(result.meta.responseMs >= 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('API reports missing trained artifact', async () => {
  const server = createApp(null).listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/search?q=rocket`);
    assert.equal(response.status, 503);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
