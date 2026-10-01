import { Link, useParams, useSearchParams } from 'react-router-dom'
import { normalize } from './catalog'
import { healthVideos, newsArticles, type HealthVideo, type NewsArticle, type NewsCategory } from './news-data'
import './news.css'

const categories: Array<'Tất cả' | NewsCategory> = ['Tất cả', 'Hướng dẫn', 'Dịch vụ', 'Hồ sơ']

function NewsCard({ article }: { article: NewsArticle }) {
  return <article className="news-card">
    <Link to={`/news/${article.slug}`} className={`news-art has-image news-art-${article.tone}`} aria-label={`Đọc bài: ${article.title}`}>
      <img src={article.image} alt="" loading="lazy" />
    </Link>
    <div className="news-card-body"><div className="news-meta"><span>{article.category}</span><span>·</span><span>{article.readMinutes} phút đọc</span></div>
      <h2><Link to={`/news/${article.slug}`}>{article.title}</Link></h2><p>{article.excerpt}</p>
      <Link to={`/news/${article.slug}`} className="news-read-link">Đọc bài viết <span aria-hidden="true">↗</span></Link></div>
  </article>
}

function HealthVideoCard({ video }: { video: HealthVideo }) {
  const watchUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`
  return <article className="news-video-card">
    <div className="news-video-frame"><iframe
      src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}`}
      title={`${video.title} — ${video.publisher}`}
      loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen /></div>
    <div className="news-video-body"><span className="news-video-publisher">{video.publisher}</span>
      <h3>{video.title}</h3><p>{video.description}</p>
      <a href={watchUrl} target="_blank" rel="noopener noreferrer">Xem trên YouTube <span aria-hidden="true">↗</span></a></div>
  </article>
}

export function NewsPage() {
  const [params, setParams] = useSearchParams()
  const selectedCategory = categories.find((item) => item === params.get('category')) ?? 'Tất cả'
  const query = params.get('q') ?? ''
  const needle = normalize(query.trim())
  const visible = newsArticles.filter((article) =>
    (selectedCategory === 'Tất cả' || article.category === selectedCategory)
    && normalize(`${article.title} ${article.excerpt} ${article.category}`).includes(needle))

  const update = (key: 'category' | 'q', value: string) => {
    const next = new URLSearchParams(params)
    if (value && value !== 'Tất cả') next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return <main className="news-page">
    <section className="news-hero"><div className="container news-hero-inner"><div>
      <span className="eyebrow light">GÓC THÔNG TIN AN TÂM</span>
      <h1>Tin tức & <em>cẩm nang</em></h1>
      <p>Hướng dẫn sử dụng cổng bệnh nhân cùng những video sức khỏe từ các nguồn y tế đáng tin cậy.</p>
      <Link to={`/news/${newsArticles[0].slug}`} className="button button-white">Bắt đầu với hướng dẫn đặt lịch <span aria-hidden="true">↗</span></Link>
    </div><div className="news-hero-visual"><img src="/images/clinic-consultation.webp" alt="Bác sĩ trao đổi với bệnh nhân trong phòng khám" /></div></div></section>

    <section className="container news-content" aria-labelledby="news-list-title">
      <div className="news-section-head"><div><span className="eyebrow">DÀNH CHO BẠN</span><h2 id="news-list-title">Khám phá bài viết</h2><p>Chọn chủ đề bạn quan tâm hoặc tìm nhanh theo từ khóa.</p></div>
        <label className="news-search"><span className="sr-only">Tìm bài viết</span><span aria-hidden="true">⌕</span><input type="search" placeholder="Tìm bài viết…" value={query} onChange={(event) => update('q', event.target.value)} /></label></div>
      <div className="news-categories" role="group" aria-label="Lọc theo chủ đề">{categories.map((category) => <button type="button" key={category}
        className={selectedCategory === category ? 'active' : ''} aria-pressed={selectedCategory === category}
        onClick={() => update('category', category)}>{category}</button>)}</div>
      <p className="news-result-count">{visible.length} bài viết{selectedCategory !== 'Tất cả' ? ` trong ${selectedCategory.toLowerCase()}` : ''}</p>
      {visible.length ? <div className="news-grid">{visible.map((article) => <NewsCard key={article.slug} article={article} />)}</div>
        : <div className="news-empty"><span aria-hidden="true">⌕</span><h2>Chưa tìm thấy bài viết</h2><p>Thử từ khóa khác hoặc xem lại tất cả chủ đề.</p><button type="button" className="button" onClick={() => setParams({})}>Xem tất cả bài viết</button></div>}
    </section>
    <section className="container news-video-section" aria-labelledby="news-video-title">
      <div className="news-video-heading"><span className="eyebrow">XEM & TÌM HIỂU</span><h2 id="news-video-title">Video sức khỏe</h2>
        <p>Hướng dẫn và kiến thức sức khỏe từ Bộ Y tế và Báo Sức khỏe & Đời sống.</p></div>
      <div className="news-video-grid">{healthVideos.map((video) => <HealthVideoCard key={video.youtubeId} video={video} />)}</div>
    </section>
    <section className="container news-bottom-banner"><div><span className="eyebrow light">CẦN XEM DỊCH VỤ?</span><h2>Chọn bước tiếp theo cho bạn</h2><p>Khám phá bác sĩ, dịch vụ và chi nhánh trước khi đặt lịch.</p></div><Link to="/explore" className="button button-white">Khám phá phòng khám ↗</Link></section>
  </main>
}

export function NewsArticlePage() {
  const { slug } = useParams()
  const article = newsArticles.find((item) => item.slug === slug)
  if (!article) return <main className="container news-not-found"><span className="eyebrow">TIN TỨC & CẨM NANG</span><h1>Không tìm thấy bài viết</h1><p>Đường dẫn này có thể đã thay đổi. Hãy quay lại danh sách để chọn bài khác.</p><Link className="button" to="/news">Xem tất cả bài viết</Link></main>

  const related = newsArticles.filter((item) => item.slug !== article.slug)
    .sort((a, b) => Number(b.category === article.category) - Number(a.category === article.category)).slice(0, 3)

  return <main className="news-article-page"><div className="container">
    <nav className="news-breadcrumb" aria-label="Đường dẫn"><Link to="/">Trang chủ</Link><span aria-hidden="true">/</span><Link to="/news">Tin tức</Link><span aria-hidden="true">/</span><span>{article.category}</span></nav>
    <header className="news-article-header"><div className="news-meta"><span>{article.category}</span><span>·</span><span>{article.readMinutes} phút đọc</span></div><h1>{article.title}</h1><p>{article.lead}</p></header>
    <div className={`news-article-art news-article-art-${article.tone}`} aria-hidden="true"><img src={article.image} alt="" /></div>
    <div className="news-article-layout"><article className="news-article-body"><p className="article-opening">{article.excerpt}</p>
      {article.sections.map((section, index) => <section key={section.title}><span className="article-section-number">{String(index + 1).padStart(2, '0')}</span><h2>{section.title}</h2><p>{section.text}</p>
        {section.items && <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}</section>)}
      <div className="news-article-action"><div><strong>Sẵn sàng tiếp tục?</strong><p>Đi đến chức năng liên quan ngay trên cổng bệnh nhân.</p></div><Link className="button" to={article.action.to}>{article.action.label} ↗</Link></div>
      <Link to="/news" className="news-back-link">← Quay lại tất cả bài viết</Link>
    </article><aside className="news-related" aria-labelledby="related-title"><span className="eyebrow">ĐỌC TIẾP</span><h2 id="related-title">Bài viết khác</h2>
      {related.map((item) => <Link key={item.slug} to={`/news/${item.slug}`} className="news-related-item"><span className={`news-related-symbol news-art-${item.tone}`} aria-hidden="true">{item.symbol}</span><span><small>{item.category} · {item.readMinutes} phút</small><strong>{item.title}</strong></span><span aria-hidden="true">↗</span></Link>)}
    </aside></div>
  </div></main>
}
