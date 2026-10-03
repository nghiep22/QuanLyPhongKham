export type ketquatimkiem = {
  matalieu: string;
  chude: string;
  diem: number;
  trichdoan: string;
  tudonggop: Array<{ tu: string; donggop: number }>;
};

export type cauhinhmohinh = {
  tansuattoithieu: number;
  tansuattoida: number;
  bacngramtoida: number;
};

export type thongtinmohinh = {
  cacchude: string[];
  sotailieu: number;
  sotuvung: number;
  cauhinh: cauhinhmohinh;
  thoigiantaoutc: string;
  phamvi: string;
};

export type thongkedanhgia = {
  sotruyvan: number;
  dochinhxactopnam: number;
  thuhangdaonghichtrungbinh: number;
  thoigiantrungvims: number;
  thoigianp95ms: number;
  theochude: Record<string, { sotruyvan: number; dochinhxactopnam: number; thuhangdaonghichtrungbinh: number }>;
  cacloi: Array<{ truyvan: string; chudelienquan: string; chudedungdau: string | null; thuhangdaonghich: number }>;
  nhamlan: Record<string, Record<string, number>>;
};

export type baocaodanhgia = {
  mohinhduocchon: string;
  xacthuc: Array<{ ten: string; sotuvung: number; xacthuc: thongkedanhgia; truyvantuxay: thongkedanhgia }>;
  kiemthu: thongkedanhgia;
  kiemthucoso: thongkedanhgia;
  truyvantuxay: thongkedanhgia;
  chimuc: { sotailieu: number; sotuvung: number; cacchude: string[]; cauhinh: cauhinhmohinh };
  quyuoc: string;
};

// Giữ nguyên tên trường của giao thức HTTP; chuyển sang tên tiếng Việt tại biên API.
type ketquagoc = { id: string; category: string; score: number; snippet: string; contributingTerms: Array<{ term: string; contribution: number }> };
type cauhinhgoc = { minDf: number; maxDf: number; ngramMax: number };
type thongtingoc = { categories: string[]; documents: number; vocabularySize: number; config: cauhinhgoc; createdAtUtc: string; scope: string };
type thongkegoc = {
  queries: number; precisionAt5: number; mrr: number; medianLatencyMs: number; p95LatencyMs: number;
  byCategory: Record<string, { queries: number; precisionAt5: number; mrr: number }>;
  errors: Array<{ query: string; relevantCategory: string; topCategory: string | null; reciprocalRank: number }>;
  confusion: Record<string, Record<string, number>>;
};
type baocaogoc = {
  selectedModel: string;
  validation: Array<{ name: string; vocabularySize: number; validation: thongkegoc; manual: thongkegoc }>;
  test: thongkegoc; baselineTest: thongkegoc; manual: thongkegoc;
  index: { documents: number; vocabularySize: number; categories: string[]; config: cauhinhgoc };
  protocol: string;
};
type phanhoigoc<dulieu> = { data?: dulieu; error?: { code?: string; message?: string }; meta?: { responseMs: number; warning: string | null } };
const diachibe = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const lenhchaybe = '.venv/Scripts/python.exe maychu.py';
const lenhtaomohinh = '.venv/Scripts/python.exe chaylenh.py toanbo';

async function guiyeucau<dulieu>(duongdan: string): Promise<{ dulieu: dulieu; thoigianphanhoims: number; canhbao: string | null }> {
  let phanhoi: Response;
  try { phanhoi = await fetch(`${diachibe}${duongdan}`); }
  catch { throw new Error(`Không kết nối được BE ở cổng 4003. Hãy chạy ${lenhchaybe} trong be/HocMayBE.`); }
  const noidung = await phanhoi.text();
  let phanhoidoc: phanhoigoc<dulieu> | null = null;
  try { phanhoidoc = noidung ? JSON.parse(noidung) as phanhoigoc<dulieu> : null; } catch { /* Máy chủ trung gian có thể trả văn bản thuần. */ }
  if (!phanhoi.ok) {
    if (phanhoidoc?.error?.code === 'MODEL_MISSING') throw new Error(`BE chưa nạp mô hình. Hãy chạy ${lenhtaomohinh} trong be/HocMayBE rồi khởi động lại BE.`);
    if (phanhoi.status === 502 || phanhoi.status === 504) throw new Error(`Không kết nối được BE ở cổng 4003. Hãy chạy ${lenhchaybe} trong be/HocMayBE.`);
    throw new Error(phanhoidoc?.error?.message ?? `API trả lỗi HTTP ${phanhoi.status}.`);
  }
  if (!phanhoidoc || phanhoidoc.data === undefined) throw new Error('API trả phản hồi không hợp lệ. Hãy kiểm tra terminal BE.');
  return { dulieu: phanhoidoc.data, thoigianphanhoims: phanhoidoc.meta?.responseMs ?? 0, canhbao: phanhoidoc.meta?.warning ?? null };
}

function chuyencauhinh(dulieu: cauhinhgoc): cauhinhmohinh {
  return { tansuattoithieu: dulieu.minDf, tansuattoida: dulieu.maxDf, bacngramtoida: dulieu.ngramMax };
}

function chuyenthongke(dulieu: thongkegoc): thongkedanhgia {
  return {
    sotruyvan: dulieu.queries,
    dochinhxactopnam: dulieu.precisionAt5,
    thuhangdaonghichtrungbinh: dulieu.mrr,
    thoigiantrungvims: dulieu.medianLatencyMs,
    thoigianp95ms: dulieu.p95LatencyMs,
    theochude: Object.fromEntries(Object.entries(dulieu.byCategory).map(([chude, thongke]) => [chude, {
      sotruyvan: thongke.queries, dochinhxactopnam: thongke.precisionAt5, thuhangdaonghichtrungbinh: thongke.mrr,
    }])),
    cacloi: dulieu.errors.map((loi) => ({ truyvan: loi.query, chudelienquan: loi.relevantCategory, chudedungdau: loi.topCategory, thuhangdaonghich: loi.reciprocalRank })),
    nhamlan: dulieu.confusion,
  };
}

export const giaotiep = {
  thongtin: async (): Promise<thongtinmohinh> => {
    const { dulieu } = await guiyeucau<thongtingoc>('/api/meta');
    return { cacchude: dulieu.categories, sotailieu: dulieu.documents, sotuvung: dulieu.vocabularySize, cauhinh: chuyencauhinh(dulieu.config), thoigiantaoutc: dulieu.createdAtUtc, phamvi: dulieu.scope };
  },
  danhgia: async (): Promise<baocaodanhgia> => {
    const { dulieu } = await guiyeucau<baocaogoc>('/api/evaluation');
    return {
      mohinhduocchon: dulieu.selectedModel,
      xacthuc: dulieu.validation.map((mohinh) => ({ ten: mohinh.name, sotuvung: mohinh.vocabularySize, xacthuc: chuyenthongke(mohinh.validation), truyvantuxay: chuyenthongke(mohinh.manual) })),
      kiemthu: chuyenthongke(dulieu.test), kiemthucoso: chuyenthongke(dulieu.baselineTest), truyvantuxay: chuyenthongke(dulieu.manual),
      chimuc: { sotailieu: dulieu.index.documents, sotuvung: dulieu.index.vocabularySize, cacchude: dulieu.index.categories, cauhinh: chuyencauhinh(dulieu.index.config) },
      quyuoc: dulieu.protocol,
    };
  },
  timkiem: async (truyvan: string, soketqua: number, chude: string) => {
    const thamso = new URLSearchParams({ q: truyvan, k: String(soketqua) });
    if (chude) thamso.set('category', chude);
    const phanhoi = await guiyeucau<ketquagoc[]>(`/api/search?${thamso}`);
    return {
      cacketqua: phanhoi.dulieu.map((tailieu): ketquatimkiem => ({
        matalieu: tailieu.id, chude: tailieu.category, diem: tailieu.score, trichdoan: tailieu.snippet,
        tudonggop: tailieu.contributingTerms.map((tudonggop) => ({ tu: tudonggop.term, donggop: tudonggop.contribution })),
      })),
      thoigianphanhoims: phanhoi.thoigianphanhoims,
      canhbao: phanhoi.canhbao,
    };
  },
};
