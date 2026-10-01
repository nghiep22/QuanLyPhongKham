import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Evaluation, type Hit, type Metadata } from './api';

type Page = 'about' | 'search' | 'evaluation';
type SearchSelection = { query: string; category: string; k: number };
function pageFromHash(): Page {
  const hash = location.hash.slice(1);
  return hash === 'search' || hash === 'evaluation' ? hash : 'about';
}
const examples = [
  'space shuttle launch mission',
  'medical treatment for disease symptoms',
  'baseball team standings',
  'computer graphics image rendering',
];

function pct(value: number) { return `${(value * 100).toFixed(1)}%`; }
function number(value: number) { return new Intl.NumberFormat('vi-VN').format(value); }

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function ScoreBar({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  const percent = Math.max(0, Math.min(100, value * 100));
  return <div className="score-row"><span>{label}</span><div className="score-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><i className={emphasis ? 'emphasis' : ''} style={{ width: `${percent}%` }} /></div><strong>{pct(value)}</strong></div>;
}

function SearchPage({ metadata, metadataError, metadataLoading, retryMetadata }: {
  metadata: Metadata | null; metadataError: string | null; metadataLoading: boolean; retryMetadata: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [k, setK] = useState(10);
  const [hits, setHits] = useState<Hit[]>([]);
  const [responseMs, setResponseMs] = useState<number | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState<SearchSelection | null>(null);
  const [pending, setPending] = useState<SearchSelection | null>(null);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);

  async function run(q: string, nextCategory = category, nextK = k) {
    const current = ++requestId.current;
    const nextQuery = q.trim();
    setHits([]); setResponseMs(null); setWarning(null); setApplied(null);
    if (nextQuery.length < 2) { setPending(null); setLoading(false); setError('Vui lòng nhập ít nhất 2 ký tự.'); return; }
    setPending({ query: nextQuery, category: nextCategory, k: nextK });
    setLoading(true); setError(null);
    try {
      const result = await api.search(nextQuery, nextK, nextCategory);
      if (current !== requestId.current) return;
      setHits(result.hits); setResponseMs(result.responseMs); setWarning(result.warning);
      setApplied({ query: nextQuery, category: nextCategory, k: nextK }); setPending(null);
    } catch (cause) {
      if (current === requestId.current) { setPending(null); setError(cause instanceof Error ? cause.message : 'Không thể tìm kiếm.'); }
    } finally { if (current === requestId.current) setLoading(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void run(query); }
  const queryChanged = applied !== null && query.trim() !== applied.query;
  const updateCategory = (value: string) => {
    setCategory(value);
    if (query.trim().length >= 2 && (applied || loading)) void run(query, value, k);
  };
  const updateK = (value: number) => {
    setK(value);
    if (query.trim().length >= 2 && (applied || loading)) void run(query, category, value);
  };

  return <main className="page-shell search-page">
    <div className="intro-row"><div><span className="eyebrow">02 / THỬ CÔNG CỤ</span><h1>Tìm bài đăng theo nội dung</h1><p>Nhập một cụm từ tiếng Anh. Hệ thống xếp hạng tài liệu bằng TF–IDF và độ tương đồng cosine.</p></div><div className={`dataset-badge${metadata ? '' : ' unavailable'}`}><span className="status-dot" />{metadata ? `${number(metadata.documents)} bài đã lập chỉ mục` : metadataLoading ? 'Đang kết nối mô hình' : 'Mô hình chưa sẵn sàng'}</div></div>
    <div className="search-layout"><section className="search-panel">
      <form onSubmit={submit}>
        <label htmlFor="query">Nội dung cần tìm</label>
        <div className="query-row"><input id="query" type="search" name="q" autoFocus value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder="Ví dụ: space shuttle launch mission" /><button disabled={loading || !metadata} type="submit">{loading ? 'Đang tìm…' : 'Tìm kiếm →'}</button></div>
        <div className="filter-row"><label>Chủ đề<select value={category} onChange={(event) => updateCategory(event.target.value)}><option value="">Tất cả chủ đề</option>{metadata?.categories.map((item) => <option key={item}>{item}</option>)}</select></label><label>Số kết quả<select value={k} onChange={(event) => updateK(Number(event.target.value))}><option value="5">5</option><option value="10">10</option><option value="20">20</option></select></label></div>
      </form>
      <div className="example-box"><strong>Thử truy vấn</strong><div>{examples.map((item) => <button key={item} disabled={!metadata} onClick={() => { setQuery(item); void run(item); }}>{item} ↗</button>)}</div></div>
      <div className="notice"><strong>Giới hạn của kết quả</strong><p>Điểm số thể hiện mức khớp từ ngữ trong tập thảo luận tiếng Anh cũ. Kết quả không phải lời khuyên y tế.</p></div>
    </section><section className="results-panel" aria-busy={loading} aria-labelledby="results-title">
      <div className="results-heading"><div><span className="eyebrow">KẾT QUẢ</span><h2 id="results-title">{loading ? 'Đang đối chiếu tài liệu…' : responseMs === null ? 'Bắt đầu bằng một truy vấn' : `${hits.length} tài liệu phù hợp`}</h2></div>{responseMs !== null && <span className="time-chip">{responseMs.toFixed(1)} ms</span>}</div>
      <div className="result-status" role="status" aria-live="polite">{pending ? `Đang tìm “${pending.query}” · ${pending.category || 'Tất cả chủ đề'} · tối đa ${pending.k} kết quả` : applied ? `“${applied.query}” · ${applied.category || 'Tất cả chủ đề'} · tối đa ${applied.k} kết quả` : ''}</div>
      {queryChanged && <div className="filter-changed">Bạn đã sửa truy vấn. Bấm <strong>Tìm kiếm</strong> để cập nhật kết quả.</div>}
      {(error || metadataError) && <div className="error" role="alert">{error ?? metadataError}{metadataError && <button type="button" className="retry-button" disabled={metadataLoading} onClick={retryMetadata}>{metadataLoading ? 'Đang thử lại…' : 'Thử kết nối lại'}</button>}</div>}
      {warning && <div className="notice" role="status">{warning}</div>}
      {loading ? <div className="loading-state"><span className="loading-spinner" aria-hidden="true" /><strong>Đang xếp hạng kết quả</strong><p>So sánh truy vấn với các tài liệu đã lập chỉ mục.</p></div>
        : hits.length ? <ol className="result-list">{hits.map((hit, index) => <li key={hit.id}><div className="result-top"><span className="result-index">{String(index + 1).padStart(2, '0')}</span><span className="category-pill">{hit.category}</span><strong>Cosine {hit.score.toFixed(3)}</strong></div><h3>Bài đăng {hit.id.split('/').at(-1)}</h3><p>{hit.snippet}</p><div className="terms">{hit.contributingTerms.map((term) => <span key={term.term}>{term.term}</span>)}</div></li>)}</ol>
        : !error && !metadataError && <div className="empty-state"><span aria-hidden="true">⌕</span><strong>{applied ? 'Không tìm thấy tài liệu phù hợp' : 'Chưa có kết quả'}</strong><p>{applied ? 'Thử một cụm từ khác hoặc chọn tất cả chủ đề.' : 'Hãy thử một trong các truy vấn mẫu hoặc nhập câu của bạn.'}</p></div>}
    </section></div>
  </main>;
}

function EvaluationPage({ evaluation, error, loading, retry }: {
  evaluation: Evaluation | null; error: string | null; loading: boolean; retry: () => void;
}) {
  if (!evaluation) return <main className="page-shell evaluation-page"><span className="eyebrow">03 / ĐÁNH GIÁ</span><h1>Dashboard & model card</h1><div className="card evaluation-unavailable" role={error ? 'alert' : 'status'}><span className="evaluation-unavailable-icon" aria-hidden="true">▤</span><h2>{loading ? 'Đang tải báo cáo' : 'Chưa xem được báo cáo'}</h2><p>{loading ? 'Đang lấy số liệu đánh giá từ mô hình.' : error ?? 'Chưa có kết quả. Chạy pipeline ở HocMayBE để tạo báo cáo.'}</p><button type="button" disabled={loading} onClick={retry}>{loading ? 'Đang tải…' : 'Tải lại báo cáo ↻'}</button></div></main>;
  const { test, baselineTest, validation, manual, index } = evaluation;
  return <main className="page-shell evaluation-page"><span className="eyebrow">03 / ĐÁNH GIÁ</span><h1>Dashboard & model card</h1><p className="lead">Kết quả kiểm thử độc lập sau khi chọn cấu hình trên tập validation. Nhãn chủ đề được dùng làm chỉ dấu liên quan.</p>
    <div className="metric-grid"><MetricCard label="Precision@5 · test" value={pct(test.precisionAt5)} detail={`${test.queries} truy vấn từ tài liệu test`} /><MetricCard label="MRR · test" value={test.mrr.toFixed(3)} detail="Vị trí kết quả đúng đầu tiên" /><MetricCard label="Trung vị phản hồi" value={`${test.medianLatencyMs.toFixed(1)} ms`} detail={`P95 ${test.p95LatencyMs.toFixed(1)} ms`} /><MetricCard label="Từ vựng" value={number(index.vocabularySize)} detail={`${number(index.documents)} tài liệu được lập chỉ mục`} /></div>
    <div className="dashboard-grid"><section className="card"><span className="eyebrow">SO SÁNH BASELINE</span><h2>TF–IDF so với trùng từ khóa</h2><ScoreBar label="TF–IDF · Precision@5" value={test.precisionAt5} emphasis /><ScoreBar label="Trùng từ · Precision@5" value={baselineTest.precisionAt5} /><ScoreBar label="TF–IDF · MRR" value={test.mrr} emphasis /><ScoreBar label="Trùng từ · MRR" value={baselineTest.mrr} /><p className="hint">Cùng tập test, cùng cách đánh giá. Không suy ra quan hệ nhân quả từ chênh lệch này.</p></section>
      <section className="card"><span className="eyebrow">THÍ NGHIỆM VALIDATION</span><h2>Chọn cấu hình</h2>{validation.map((item) => <ScoreBar key={item.name} label={`${item.name.replaceAll('_', ' ')}${item.name === evaluation.selectedModel ? ' ✓' : ''}`} value={item.validation.precisionAt5} emphasis={item.name === evaluation.selectedModel} />)}<p className="hint">Unigram, bigram và min_df/max_df được chọn trên validation; test chỉ dùng để kết luận.</p></section></div>
    <div className="dashboard-grid"><section className="card"><span className="eyebrow">BỘ TRUY VẤN TỰ XÂY</span><h2>{manual.queries} truy vấn có nhãn</h2><p>Precision@5: <strong>{pct(manual.precisionAt5)}</strong> · MRR: <strong>{manual.mrr.toFixed(3)}</strong></p><p className="hint">Mỗi truy vấn gắn với một chủ đề liên quan. Đây là nhãn ở mức chủ đề, chưa phải đánh giá thủ công mức từng bài.</p></section>
      <section className="card"><span className="eyebrow">MODEL CARD</span><h2>Phạm vi và giới hạn</h2><ul className="plain-list"><li>Mô hình: word TF–IDF, vector chuẩn hóa L2, xếp hạng cosine.</li><li>Cấu hình: n-gram 1–{index.config.ngramMax}, min_df {index.config.minDf}, max_df {index.config.maxDf}.</li><li>Dữ liệu: bài đăng tiếng Anh thuộc 8 nhóm của 20 Newsgroups.</li><li>Chỉ đo độ giống từ vựng; không hiểu ngữ nghĩa hay chẩn đoán y khoa.</li></ul></section></div>
    <section className="card error-analysis"><span className="eyebrow">PHÂN TÍCH LỖI</span><h2>Truy vấn có kết quả đầu khác chủ đề</h2>{test.errors.length ? <div className="error-grid">{test.errors.slice(0, 6).map((item, index) => <article key={`${item.query}-${index}`}><p>“{item.query.slice(0, 110)}…”</p><small>Mong đợi: {item.relevantCategory}<br />Đứng đầu: {item.topCategory ?? 'không có'}</small></article>)}</div> : <p>Không có lỗi trong mẫu truy vấn được báo cáo.</p>}</section>
  </main>;
}

function AboutPage({ metadata, metadataError, metadataLoading, retryMetadata, goSearch }: {
  metadata: Metadata | null; metadataError: string | null; metadataLoading: boolean; retryMetadata: () => void; goSearch: () => void;
}) {
  return <main><section className="hero"><div className="page-shell hero-inner"><div><span className="eyebrow light">HỌC MÁY CƠ BẢN · PROJECT 02</span><h1>Tìm đúng nội dung<br /><em>từ một câu truy vấn.</em></h1><p>Một công cụ tìm kiếm văn bản nhỏ, minh bạch và đo được: TF–IDF biến bài đăng thành vector; cosine xếp hạng mức tương đồng.</p><button className="hero-button" onClick={goSearch}>Thử tìm kiếm <span>↗</span></button><div className="hero-facts"><span>8 chủ đề chọn lọc</span><span>32 truy vấn tự xây</span><span>Đánh giá trên test độc lập</span></div></div><div className="hero-visual" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="visual-center">TF<br /><strong>IDF</strong></div><div className="float-card one"><b>01</b><span>Truy vấn<br /><strong>space shuttle</strong></span></div><div className="float-card two"><b>02</b><span>Vector hóa<br /><strong>từ khóa × trọng số</strong></span></div><div className="float-card three"><b>03</b><span>Xếp hạng<br /><strong>cosine score</strong></span></div></div></div></section>
    <div className="page-shell about-content"><div className="intro-row"><div><span className="eyebrow">01 / CÁCH HOẠT ĐỘNG</span><h2>Ba bước, một kết quả có thể giải thích</h2></div><p>Tập dữ liệu được chuẩn bị và lập chỉ mục trước. Mỗi yêu cầu tìm kiếm chỉ vector hóa truy vấn và tính điểm với các tài liệu đã lưu.</p></div><div className="steps"><article><span>01</span><h3>Chuẩn bị dữ liệu</h3><p>Loại header, email và phần trích dẫn; chia train, validation, test trước khi học từ vựng.</p></article><article><span>02</span><h3>Tính TF–IDF</h3><p>Từ phổ biến được giảm trọng số; unigram và bigram tạo nên biểu diễn văn bản.</p></article><article><span>03</span><h3>Xếp hạng cosine</h3><p>So sánh vector truy vấn với bài đăng, trả Top-N cùng điểm và từ khóa đóng góp.</p></article></div><div className="about-note"><div><span className="eyebrow">DỮ LIỆU DEMO</span><h3>20 Newsgroups</h3><p>{metadata ? `${number(metadata.documents)} tài liệu train được lập chỉ mục` : metadataLoading ? 'Đang kiểm tra mô hình' : 'Cần chạy pipeline để nạp mô hình'}. Đây là dữ liệu thảo luận tiếng Anh dùng cho bài tập, không phải dữ liệu bệnh nhân của phòng khám.</p></div><button onClick={goSearch}>Mở công cụ ↗</button></div>{metadataError && <div className="connection-notice" role="alert"><span>{metadataError}</span><button type="button" disabled={metadataLoading} onClick={retryMetadata}>{metadataLoading ? 'Đang thử lại…' : 'Thử kết nối lại ↻'}</button></div>}</div></main>;
}

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(true);
  const metadataRequestId = useRef(0);
  const evaluationRequestId = useRef(0);
  async function refreshMetadata() {
    const current = ++metadataRequestId.current;
    setMetadataLoading(true); setMetadataError(null);
    try { const next = await api.meta(); if (current === metadataRequestId.current) setMetadata(next); }
    catch (cause) { if (current === metadataRequestId.current) { setMetadata(null); setMetadataError(cause instanceof Error ? cause.message : 'Không kết nối được BE.'); } }
    finally { if (current === metadataRequestId.current) setMetadataLoading(false); }
  }
  async function refreshEvaluation() {
    const current = ++evaluationRequestId.current;
    setEvaluationLoading(true); setEvaluationError(null);
    try { const next = await api.evaluation(); if (current === evaluationRequestId.current) setEvaluation(next); }
    catch (cause) { if (current === evaluationRequestId.current) { setEvaluation(null); setEvaluationError(cause instanceof Error ? cause.message : 'Không tải được đánh giá.'); } }
    finally { if (current === evaluationRequestId.current) setEvaluationLoading(false); }
  }
  useEffect(() => { void refreshMetadata(); void refreshEvaluation();
    return () => { metadataRequestId.current++; evaluationRequestId.current++; };
  }, []);
  useEffect(() => { const listener = () => setPage(pageFromHash()); addEventListener('hashchange', listener); return () => removeEventListener('hashchange', listener); }, []);
  useEffect(() => { window.scrollTo(0, 0); document.title = `${page === 'about' ? 'Giới thiệu' : page === 'search' ? 'Tìm kiếm' : 'Đánh giá mô hình'} · Học máy cơ bản`; }, [page]);
  function navigate(next: Page) { location.hash = next; setPage(next); window.scrollTo(0, 0); }
  return <><header className="site-header"><div className="page-shell header-inner"><button className="brand" onClick={() => navigate('about')} aria-label="Về trang giới thiệu"><span className="brand-mark">✳</span><span><strong>NỘI DUNG</strong><small>TÌM KIẾM THÔNG MINH</small></span></button><nav aria-label="Điều hướng"><button className={page === 'about' ? 'active' : ''} aria-current={page === 'about' ? 'page' : undefined} onClick={() => navigate('about')}>Giới thiệu</button><button className={page === 'search' ? 'active' : ''} aria-current={page === 'search' ? 'page' : undefined} onClick={() => navigate('search')}>Tìm kiếm</button><button className={page === 'evaluation' ? 'active' : ''} aria-current={page === 'evaluation' ? 'page' : undefined} onClick={() => navigate('evaluation')}>Đánh giá & mô hình</button></nav><span className="header-project">PROJECT 02 <i /></span></div></header>
    {page === 'about' ? <AboutPage metadata={metadata} metadataError={metadataError} metadataLoading={metadataLoading} retryMetadata={() => void refreshMetadata()} goSearch={() => navigate('search')} /> : page === 'search' ? <SearchPage metadata={metadata} metadataError={metadataError} metadataLoading={metadataLoading} retryMetadata={() => void refreshMetadata()} /> : <EvaluationPage evaluation={evaluation} error={evaluationError} loading={evaluationLoading} retry={() => void refreshEvaluation()} />}
    <footer><div className="page-shell footer-inner"><span>✳ Tìm kiếm bài viết theo nội dung</span><span>TF–IDF · cosine · 20 Newsgroups</span></div></footer></>;
}
