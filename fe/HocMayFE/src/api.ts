export type Hit = {
  id: string;
  category: string;
  score: number;
  snippet: string;
  contributingTerms: Array<{ term: string; contribution: number }>;
};

export type Metadata = {
  categories: string[];
  documents: number;
  vocabularySize: number;
  config: { minDf: number; maxDf: number; ngramMax: number };
  createdAtUtc: string;
  scope: string;
};

export type Metric = {
  queries: number;
  precisionAt5: number;
  mrr: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  byCategory: Record<string, { queries: number; precisionAt5: number; mrr: number }>;
  errors: Array<{ query: string; relevantCategory: string; topCategory: string | null; reciprocalRank: number }>;
  confusion: Record<string, Record<string, number>>;
};

export type Evaluation = {
  selectedModel: string;
  validation: Array<{ name: string; vocabularySize: number; validation: Metric; manual: Metric }>;
  test: Metric;
  baselineTest: Metric;
  manual: Metric;
  index: { documents: number; vocabularySize: number; categories: string[]; config: Metadata['config'] };
  protocol: string;
};

type ApiBody<T> = { data?: T; error?: { code?: string; message?: string }; meta?: { responseMs: number; warning: string | null } };

async function request<T>(path: string): Promise<{ data: T; meta?: ApiBody<T>['meta'] }> {
  let response: Response;
  try { response = await fetch(path); }
  catch { throw new Error('Không kết nối được BE ở cổng 4003. Hãy chạy npm run dev trong be/HocMayBE.'); }
  const raw = await response.text();
  let body: ApiBody<T> | null = null;
  try { body = raw ? JSON.parse(raw) as ApiBody<T> : null; } catch { /* Proxy may return plain text. */ }
  if (!response.ok) {
    if (body?.error?.code === 'MODEL_MISSING') throw new Error('BE chưa nạp mô hình. Hãy chạy npm run pipeline trong be/HocMayBE rồi khởi động lại BE.');
    if (response.status === 502 || response.status === 504) throw new Error('Không kết nối được BE ở cổng 4003. Hãy chạy npm run dev trong be/HocMayBE.');
    throw new Error(body?.error?.message ?? `API trả lỗi HTTP ${response.status}.`);
  }
  if (!body || body.data === undefined) throw new Error('API trả phản hồi không hợp lệ. Hãy kiểm tra terminal BE.');
  return body as { data: T; meta?: ApiBody<T>['meta'] };
}

async function read<T>(path: string): Promise<T> {
  return (await request<T>(path)).data;
}

export const api = {
  meta: () => read<Metadata>('/api/meta'),
  evaluation: () => read<Evaluation>('/api/evaluation'),
  search: async (q: string, k: number, category: string) => {
    const params = new URLSearchParams({ q, k: String(k) });
    if (category) params.set('category', category);
    const body = await request<Hit[]>(`/api/search?${params}`);
    return { hits: body.data, responseMs: body.meta?.responseMs ?? 0, warning: body.meta?.warning ?? null };
  },
};
