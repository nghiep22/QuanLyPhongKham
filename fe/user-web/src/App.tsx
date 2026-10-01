import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, dateTime, money } from './api'
import { useAuth } from './auth'
import { AuthPage, RegisterPage, ForgotPage, ResetPage, SecurityPage } from './pages/auth-pages'
import { ExplorePage } from './pages/explore-page'
import { BranchDetailPage, DoctorDetailPage, ServiceDetailPage, SpecialtyDetailPage } from './pages/explore-details'
import { BookingPage } from './pages/booking-page'
import { ProfilesPage } from './pages/profiles-page'
import { RecordsPage } from './pages/records-page'
import { AccountPage } from './pages/account-page'
import { NewsArticlePage, NewsPage } from './pages/news-page'
import { newsArticles } from './pages/news-data'
import { bookingUrl, serviceTypeLabel, useBranches, useDoctors, useServices, useSpecialties } from './pages/catalog'
import { Icon } from './ui-icon'

function Header() {
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => { setMenuOpen(false) }, [pathname])
  return <header id="top" className={`site-header ${user ? 'patient-header' : 'guest-header'}`}><div className="header-inner">
    <Link to="/" className="brand"><span className="brand-mark"><Icon name="cross" size={23} /></span><span><strong>AN TÂM</strong><small>PHÒNG KHÁM TƯ NHÂN</small></span></Link>
    <button type="button" className="menu-toggle" aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'}
      aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((open) => !open)}>
      <Icon name={menuOpen ? 'close' : 'menu'} /><span>Menu</span>
    </button>
    <nav id="primary-navigation" aria-label="Điều hướng chính" className={`${user ? 'patient-nav' : 'guest-nav'}${menuOpen ? ' is-open' : ''}`}>
      <NavLink to="/" end><span className="nav-icon"><Icon name="home" /></span><span>Trang chủ</span></NavLink>
      <NavLink to="/explore"><span className="nav-icon"><Icon name="compass" /></span><span>Khám phá</span></NavLink>
      <NavLink to="/news"><span className="nav-icon"><Icon name="news" /></span><span>Tin tức</span></NavLink>
      {user && <><NavLink to="/booking"><span className="nav-icon"><Icon name="calendar" /></span><span>Lịch khám</span></NavLink>
        <NavLink to="/records"><span className="nav-icon"><Icon name="records" /></span><span>Kết quả</span></NavLink>
        <NavLink to="/profiles"><span className="nav-icon"><Icon name="users" /></span><span>Hồ sơ</span></NavLink>
        <NavLink to="/account"><span className="nav-icon"><Icon name="user" /></span><span>Tài khoản</span></NavLink></>}
    </nav>
    <div className="header-actions">{user ? <><Link to="/account" className="header-user"><span className="header-avatar">{user.displayName.charAt(0)}</span><span>{user.displayName}</span></Link><button className="text-button header-logout" onClick={() => void logout()}><Icon name="logout" size={17} /><span>Đăng xuất</span></button></>
      : <><Link className="text-button" to="/login">Đăng nhập</Link><Link className="button button-small" to="/register">Đăng ký</Link></>}</div>
  </div></header>
}

function Shell() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
    const titles: Record<string, string> = {
      '/': 'Trang chủ', '/explore': 'Khám phá', '/news': 'Tin tức & cẩm nang',
      '/booking': 'Đặt lịch khám', '/profiles': 'Hồ sơ người thân', '/records': 'Kết quả khám',
      '/account': 'Tài khoản', '/security': 'Bảo mật tài khoản', '/login': 'Đăng nhập',
      '/register': 'Đăng ký', '/forgot-password': 'Quên mật khẩu', '/reset-password': 'Đặt lại mật khẩu',
    }
    const article = pathname.startsWith('/news/') ? newsArticles.find((item) => `/news/${item.slug}` === pathname) : undefined
    const title = article?.title ?? titles[pathname] ?? (pathname.startsWith('/news/') ? 'Không tìm thấy bài viết'
      : pathname.startsWith('/explore/') ? 'Chi tiết khám phá' : 'Không tìm thấy trang')
    document.title = `${title} · Phòng khám An Tâm`
  }, [pathname])
  return <><Header /><Outlet /><footer className="footer"><div className="container footer-main">
    <div className="footer-about"><Link to="/" className="brand footer-logo"><span className="brand-mark"><Icon name="cross" size={23} /></span><span><strong>AN TÂM</strong><small>PHÒNG KHÁM TƯ NHÂN</small></span></Link>
      <p>Một nơi để tìm hiểu dịch vụ, đặt lịch và theo dõi hành trình chăm sóc của bạn.</p>
      <Link className="footer-cta" to="/booking">Đặt lịch khám <span aria-hidden="true">↗</span></Link></div>
    <div className="footer-column"><h2>Khám phá</h2><Link to="/explore?view=services">Dịch vụ & bảng giá</Link><Link to="/explore?view=doctors">Đội ngũ bác sĩ</Link><Link to="/explore?view=specialties">Chuyên khoa</Link><Link to="/explore?view=branches">Chi nhánh</Link></div>
    <div className="footer-column"><h2>Dành cho bạn</h2><Link to="/booking">Đặt lịch khám</Link><Link to="/profiles">Hồ sơ người thân</Link><Link to="/records">Kết quả khám</Link><Link to="/account">Tài khoản</Link></div>
    <div className="footer-column"><h2>Thông tin</h2><Link to="/news">Tin tức & cẩm nang</Link><Link to="/news/dat-lich-kham-truc-tuyen">Hướng dẫn đặt lịch</Link><Link to="/news/xem-ket-qua-kham">Xem kết quả khám</Link><Link to="/login">Đăng nhập</Link></div>
  </div><div className="container footer-bottom"><span>© {new Date().getFullYear()} Phòng khám An Tâm</span><span>Chủ động chăm sóc, an tâm mỗi ngày.</span><a href="#top">Lên đầu trang ↑</a></div></footer></>
}
function Protected() {
  const { user, restoring } = useAuth()
  const location = useLocation()
  if (restoring) return <div className="container state">Đang khôi phục phiên đăng nhập…</div>
  return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
}

function NotFoundPage() {
  return <main className="container page not-found-page"><span className="eyebrow">ĐƯỜNG DẪN KHÔNG KHẢ DỤNG</span>
    <h1>Không tìm thấy trang này</h1><p>Trang có thể đã chuyển địa chỉ. Hãy về trang chủ hoặc khám phá các dịch vụ hiện có.</p>
    <div className="not-found-actions"><Link className="button" to="/">Về trang chủ ↗</Link>
      <Link className="button button-ghost" to="/explore">Khám phá dịch vụ</Link></div></main>
}

function HomePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const branches = useBranches()
  const specialties = useSpecialties()
  const doctors = useDoctors({})
  const firstBranch = branches.data?.[0]
  const services = useServices(firstBranch?.publicId ?? '')
  const appointments = useQuery({ queryKey: ['user', 'appointments'], queryFn: async () => (await api.appointments.list()).data, enabled: !!user })
  const profiles = useQuery({ queryKey: ['user', 'profiles'], queryFn: async () => (await api.patientAccess.get()).data.links, enabled: !!user })
  const refreshing = branches.isRefetching || specialties.isRefetching || doctors.isRefetching || services.isRefetching
    || appointments.isRefetching || profiles.isRefetching
  const refreshHome = () => void Promise.all([branches.refetch(), specialties.refetch(), doctors.refetch(),
    firstBranch ? services.refetch() : Promise.resolve(),
    ...(user ? [appointments.refetch(), profiles.refetch()] : [])])
  const upcoming = appointments.data?.filter((item) => ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(item.status)
    && Date.parse(item.scheduledEndUtc) >= Date.now()).sort((a, b) => Date.parse(a.scheduledStartUtc) - Date.parse(b.scheduledStartUtc))[0]
  return <main className="home-page"><section className="hero"><div className="container hero-grid"><div className="hero-copy">
    <span className="eyebrow light">CỔNG CHĂM SÓC SỨC KHỎE</span>
    <h1>{user ? <>Chào {user.displayName},<br /><em>hôm nay bạn khỏe chứ?</em></> : <>Sức khỏe của bạn,<br /><em>được chăm sóc đúng lúc.</em></>}</h1>
    <p>Tìm bác sĩ, xem giá dịch vụ và chọn khung giờ phù hợp. Mọi thông tin cho hành trình chăm sóc của bạn ở cùng một nơi.</p>
    <form className="hero-search" onSubmit={(event) => { event.preventDefault(); const query = search.trim()
      navigate(`/explore?view=services${query ? `&q=${encodeURIComponent(query)}` : ''}`) }}>
      <Icon name="search" size={21} /><input type="search" aria-label="Tìm dịch vụ" placeholder="Tìm tên hoặc mã dịch vụ…"
        value={search} onChange={(event) => setSearch(event.target.value)} />
      <button type="submit">Tìm kiếm <Icon name="arrow" size={18} /></button>
    </form>
    <div className="hero-actions"><Link className="button button-white" to={user ? '/booking' : '/explore'}>{user ? 'Đặt lịch khám' : 'Khám phá dịch vụ'} <span>↗</span></Link>
      <Link className="button button-outline-light" to={user ? '/records' : '/login'}>{user ? 'Xem kết quả khám' : 'Đăng nhập'}</Link></div>
    <div className="hero-proof"><span><Icon name="check" size={16} /> Dễ dàng đặt lịch</span><span><Icon name="check" size={16} /> Chi phí rõ ràng</span><span><Icon name="shield" size={16} /> Bảo mật hồ sơ</span></div>
  </div><div className="hero-art"><img className="hero-photo" src="/images/clinic-reception.webp"
    alt="Nhân viên lễ tân đang hỗ trợ khách tại quầy tiếp đón" fetchPriority="high" />
  </div></div></section>
  <section className="container home-content">
    <div className="section-heading"><div><span className="eyebrow">DỊCH VỤ DÀNH CHO BẠN</span><h2>Mọi thứ bạn cần, ở một nơi</h2></div><div className="home-heading-actions"><button className="inline-link" disabled={refreshing}
      onClick={refreshHome}>{refreshing ? 'Đang tải…' : 'Tải lại ↻'}</button>
      <Link to="/explore" className="inline-link">Khám phá tất cả ↗</Link></div></div>
    <div className="feature-grid">
      <Link to="/explore?view=doctors" className="feature-card"><span className="feature-icon peach"><Icon name="doctor" size={25} /></span><h3>Tìm bác sĩ</h3><p>Gặp đội ngũ chuyên môn phù hợp với nhu cầu của bạn.</p><span className="feature-arrow"><Icon name="upRight" size={20} /></span></Link>
      <Link to="/explore?view=services" className="feature-card"><span className="feature-icon mint"><Icon name="service" size={25} /></span><h3>Dịch vụ & bảng giá</h3><p>Tra cứu dịch vụ và chi phí theo từng chi nhánh.</p><span className="feature-arrow"><Icon name="upRight" size={20} /></span></Link>
      <Link to="/booking" className="feature-card"><span className="feature-icon lavender"><Icon name="calendar" size={25} /></span><h3>Đặt lịch khám</h3><p>Chọn ngày, bác sĩ và giờ khám thuận tiện cho bạn.</p><span className="feature-arrow"><Icon name="upRight" size={20} /></span></Link>
      <Link to="/records" className="feature-card"><span className="feature-icon sky"><Icon name="records" size={25} /></span><h3>Kết quả khám</h3><p>Xem lại hồ sơ đã được bác sĩ ký và công bố.</p><span className="feature-arrow"><Icon name="upRight" size={20} /></span></Link>
    </div>
    <div className="discovery-shortcuts">
      <Link to="/explore?view=branches"><span><Icon name="branch" /></span><strong>Chi nhánh</strong><small>{branches.isError ? 'Chưa tải được' : branches.isLoading ? 'Đang tải…' : `${branches.data?.length ?? 0} cơ sở`}</small><Icon name="arrow" size={18} /></Link>
      <Link to="/explore?view=specialties"><span><Icon name="heart" /></span><strong>Chuyên khoa</strong><small>{specialties.isError ? 'Chưa tải được' : specialties.isLoading ? 'Đang tải…' : `${specialties.data?.length ?? 0} chuyên khoa`}</small><Icon name="arrow" size={18} /></Link>
    </div>
    {(branches.isError || specialties.isError) && <div className="error" role="alert">Chưa tải được chi nhánh hoặc chuyên khoa. <button className="inline-link" onClick={() => void Promise.all([branches.refetch(), specialties.refetch()])}>Thử lại</button></div>}
    <section className="home-discovery" aria-labelledby="featured-services-title">
      <div className="section-heading"><div><span className="eyebrow">DỊCH VỤ NỔI BẬT</span><h2 id="featured-services-title">Chi phí rõ ràng</h2></div><Link to="/explore?view=services" className="inline-link">Xem bảng giá ↗</Link></div>
      {branches.isLoading || (firstBranch && services.isLoading) ? <div className="state">Đang tải dịch vụ…</div>
        : branches.isError ? <div className="error" role="alert">Chưa tải được chi nhánh. <button className="inline-link" onClick={() => void branches.refetch()}>Thử lại</button></div>
        : !firstBranch ? <div className="empty-state"><strong>Chưa có chi nhánh đang mở</strong></div>
        : services.isError ? <div className="error" role="alert">Chưa tải được dịch vụ. <button className="inline-link" onClick={() => void services.refetch()}>Thử lại</button></div>
        : services.data?.length ? <div className="home-catalog-grid">{services.data.slice(0, 5).map((service) => <article className="catalog-card" key={service.publicId}>
          <span className="card-symbol"><Icon name="service" size={23} /></span><div className="card-tag">{serviceTypeLabel(service.type)}</div>
          <h3>{service.name}</h3><p>{service.category.name} · {service.durationMinutes} phút</p><p>{firstBranch.name}</p>
          <div className="card-bottom"><strong>{money(service.price.amount)}</strong><Link to={`/explore/services/${firstBranch.publicId}/${service.publicId}`}>Chi tiết ↗</Link></div>
          <Link className="catalog-book" to={bookingUrl({ branchId: firstBranch.publicId, serviceId: service.publicId })}>Đặt lịch</Link>
        </article>)}</div> : <div className="empty-state"><strong>Chưa có dịch vụ tại chi nhánh này</strong><Link className="inline-link" to="/explore?view=branches">Xem các chi nhánh</Link></div>}
    </section>
    <section className="home-discovery" aria-labelledby="featured-doctors-title">
      <div className="section-heading"><div><span className="eyebrow">ĐỘI NGŨ CHUYÊN MÔN</span><h2 id="featured-doctors-title">Bác sĩ đồng hành</h2></div><Link to="/explore?view=doctors" className="inline-link">Xem tất cả ↗</Link></div>
      {doctors.isLoading ? <div className="state">Đang tải bác sĩ…</div>
        : doctors.isError ? <div className="error" role="alert">Chưa tải được bác sĩ. <button className="inline-link" onClick={() => void doctors.refetch()}>Thử lại</button></div>
        : doctors.data?.length ? <div className="home-catalog-grid">{doctors.data.slice(0, 3).map((doctor) => <article className="catalog-card doctor-card" key={doctor.publicId}>
          <div className="doctor-avatar">{doctor.fullName.charAt(0)}</div><div className="card-tag">{doctor.academicTitle ?? 'BÁC SĨ'}</div>
          <h3>{doctor.fullName}</h3><p>{doctor.specialties.map((item) => item.name).join(' · ') || 'Đa khoa'}</p>
          <div className="card-bottom"><small>{doctor.branches.map((item) => item.name).join(', ')}</small><Link to={`/explore/doctors/${doctor.publicId}`}>Hồ sơ bác sĩ ↗</Link></div>
        </article>)}</div> : <div className="empty-state"><strong>Chưa có bác sĩ trong danh mục công khai</strong><Link className="inline-link" to="/explore?view=doctors">Xem danh mục bác sĩ</Link></div>}
    </section>
    <section className="home-discovery" aria-labelledby="home-news-title"><div className="section-heading"><div><span className="eyebrow">GÓC THÔNG TIN</span><h2 id="home-news-title">Tin tức & cẩm nang</h2></div><Link to="/news" className="inline-link">Xem tất cả bài viết ↗</Link></div>
      <div className="home-news-grid">{newsArticles.slice(0, 3).map((article) => <Link to={`/news/${article.slug}`} className="home-news-card" key={article.slug}>
        <span className="home-news-photo"><img src={article.image} alt="" loading="lazy" /></span>
        <span className="news-card-content"><small>{article.category} · {article.readMinutes} phút đọc</small><strong>{article.title}</strong><span>Đọc bài viết ↗</span></span>
      </Link>)}</div>
    </section>
    <div className="home-booking-banner"><div><span className="eyebrow light">ĐÃ CHỌN ĐƯỢC DỊCH VỤ?</span><h2>Đặt lịch chỉ trong vài bước</h2><p>Chọn hồ sơ, thời gian và xác nhận lịch khám an toàn.</p></div><Link className="button button-white" to="/booking">Đặt lịch ngay ↗</Link></div>
    {user && <div className="home-panels"><section className="panel"><div className="panel-head"><div><span className="eyebrow">SẮP DIỄN RA</span><h2>Lịch khám của bạn</h2></div><Link to="/booking" className="inline-link">Xem tất cả ↗</Link></div>
      {appointments.isLoading ? <p>Đang tải lịch khám…</p> : appointments.isError ? <p className="error">Không tải được lịch khám.</p>
        : upcoming ? <div className="upcoming"><span className="date-tile"><strong>{upcoming.serviceDateLocal.slice(-2)}</strong><small>THÁNG {Number(upcoming.serviceDateLocal.slice(5, 7))}</small></span><div><strong>{upcoming.service.name}</strong><p>{upcoming.startTimeLocal} · {upcoming.doctor.fullName}</p><small>{upcoming.branch.name} · {dateTime(upcoming.scheduledStartUtc)}</small></div></div>
          : <div className="empty-state"><span>✳</span><strong>Chưa có lịch sắp tới</strong><p>Hãy chọn một khung giờ phù hợp để bắt đầu.</p><Link className="button button-small" to="/booking">Đặt lịch ngay</Link></div>}</section>
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">HỒ SƠ CỦA BẠN</span><h2>Người thân được liên kết</h2></div><Link to="/profiles" className="inline-link">Quản lý ↗</Link></div>
        {profiles.isLoading ? <p>Đang tải hồ sơ…</p> : profiles.isError ? <p className="error">Không tải được hồ sơ.</p> : profiles.data?.length ? <div className="mini-list">{profiles.data.slice(0, 3).map((link) => <div key={link.publicId}><span className="avatar">{link.patient.fullName.charAt(0)}</span><span><strong>{link.patient.fullName}</strong><small>{link.patient.code} · {link.relationshipType === 'SELF' ? 'Bản thân' : 'Người thân'}</small></span></div>)}</div>
          : <div className="empty-state"><span>♡</span><strong>Chưa có hồ sơ liên kết</strong><p>Liên kết hồ sơ để đặt lịch cho bạn và người thân.</p><Link className="button button-small" to="/profiles">Liên kết hồ sơ</Link></div>}</section></div>}
  </section></main>
}

export function App() { return <Routes><Route element={<Shell />}>
  <Route path="/" element={<HomePage />} /><Route path="/explore" element={<ExplorePage />} />
  <Route path="/news" element={<NewsPage />} /><Route path="/news/:slug" element={<NewsArticlePage />} />
  <Route path="/explore/branches/:branchId" element={<BranchDetailPage />} />
  <Route path="/explore/specialties/:specialtyId" element={<SpecialtyDetailPage />} />
  <Route path="/explore/services/:branchId/:serviceId" element={<ServiceDetailPage />} />
  <Route path="/explore/doctors/:doctorId" element={<DoctorDetailPage />} />
  <Route path="/login" element={<AuthPage />} /><Route path="/register" element={<RegisterPage />} />
  <Route path="/forgot-password" element={<ForgotPage />} /><Route path="/reset-password" element={<ResetPage />} />
  <Route element={<Protected />}><Route path="/booking" element={<BookingPage />} /><Route path="/profiles" element={<ProfilesPage />} />
    <Route path="/records" element={<RecordsPage />} /><Route path="/account" element={<AccountPage />} />
    <Route path="/security" element={<SecurityPage />} /></Route>
  <Route path="*" element={<NotFoundPage />} />
</Route></Routes> }
