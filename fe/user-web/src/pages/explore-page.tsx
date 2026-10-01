import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { errorMessage, money } from '../api'
import { bookingUrl, fullAddress, normalize, serviceTypeLabel, useBranches, useDoctors, useServices, useSpecialties } from './catalog'

type View = 'services' | 'doctors' | 'branches' | 'specialties'
const tabs: { id: View; label: string }[] = [
  { id: 'services', label: 'Dịch vụ & bảng giá' },
  { id: 'doctors', label: 'Bác sĩ' },
  { id: 'branches', label: 'Chi nhánh' },
  { id: 'specialties', label: 'Chuyên khoa' },
]

export function ExplorePage() {
  const [params, setParams] = useSearchParams()
  const view = tabs.find((tab) => tab.id === params.get('view'))?.id ?? 'services'
  const branchId = params.get('branch') ?? ''
  const specialtyId = params.get('specialty') ?? ''
  const serviceId = params.get('service') ?? ''
  const search = params.get('q') ?? ''
  const branches = useBranches()
  const specialties = useSpecialties()
  const selectedBranchId = branchId || branches.data?.[0]?.publicId || ''
  const services = useServices(selectedBranchId, specialtyId)
  const doctors = useDoctors({ branchId, specialtyId, serviceId })
  const refreshing = branches.isRefetching || specialties.isRefetching || services.isRefetching || doctors.isRefetching
  const refresh = () => void Promise.all([branches.refetch(), specialties.refetch(), doctors.refetch(),
    selectedBranchId ? services.refetch() : Promise.resolve()])
  const needle = normalize(search)
  const visibleServices = useMemo(() => (services.data ?? []).filter((item) =>
    normalize(`${item.name} ${item.code} ${item.category.name}`).includes(needle)), [services.data, needle])
  const visibleDoctors = useMemo(() => (doctors.data ?? []).filter((item) =>
    normalize(`${item.fullName} ${item.academicTitle ?? ''} ${item.specialties.map((part) => part.name).join(' ')}`).includes(needle)), [doctors.data, needle])
  const visibleBranches = useMemo(() => (branches.data ?? []).filter((item) =>
    normalize(`${item.name} ${item.district ?? ''} ${item.province ?? ''}`).includes(needle)), [branches.data, needle])
  const visibleSpecialties = useMemo(() => (specialties.data ?? []).filter((item) =>
    normalize(`${item.name} ${item.description ?? ''}`).includes(needle)), [specialties.data, needle])

  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace: true })
  }
  const selectView = (next: View) => {
    setParams(search ? { view: next, q: search } : { view: next })
  }

  return <main className="container page">
    <div className="page-intro explore-intro"><div><span className="eyebrow">KHÁM PHÁ PHÒNG KHÁM</span>
      <h1>Chọn dịch vụ chăm sóc phù hợp</h1>
      <p>Thông tin về bác sĩ, chuyên khoa và giá dịch vụ được cập nhật theo từng cơ sở.</p>
      <button className="inline-link" disabled={refreshing} onClick={refresh}>{refreshing ? 'Đang cập nhật…' : 'Cập nhật danh mục ↻'}</button></div>
      <figure className="explore-intro-media"><img src="/images/clinic-explore.webp"
        alt="Nhân viên y tế hướng dẫn khách tại khu vực tiếp đón" /></figure></div>
    <div className="tabs" role="group" aria-label="Danh mục khám phá">
      {tabs.map((tab) => <button key={tab.id} type="button" aria-pressed={view === tab.id}
        className={view === tab.id ? 'active' : ''} onClick={() => selectView(tab.id)}>{tab.label}</button>)}
    </div>
    <div className="filters catalog-filters">
      {(view === 'services' || view === 'doctors') && <>
        <label>Chi nhánh<select value={view === 'services' ? selectedBranchId : branchId}
          onChange={(event) => update({ branch: event.target.value })}>
          <option value="">{view === 'doctors' ? 'Tất cả chi nhánh' : 'Chọn chi nhánh'}</option>
          {branches.data?.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}
        </select></label>
        <label>Chuyên khoa<select value={specialtyId} onChange={(event) => update({ specialty: event.target.value })}>
          <option value="">Tất cả chuyên khoa</option>
          {specialties.data?.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}
        </select></label>
      </>}
      <label className="search-field">Tìm kiếm<input value={search} onChange={(event) => update({ q: event.target.value })}
        placeholder={view === 'services' ? 'Tên, mã hoặc nhóm dịch vụ' : view === 'doctors' ? 'Tên bác sĩ hoặc chuyên khoa'
          : view === 'branches' ? 'Tên cơ sở hoặc khu vực' : 'Tên chuyên khoa'} /></label>
    </div>
    {view === 'services' && <section>
      <div className="section-heading compact"><div><span className="eyebrow">BẢNG GIÁ CÔNG KHAI</span><h2>Dịch vụ đang mở</h2></div>
        <span>{visibleServices.length} dịch vụ</span></div>
      {branches.isLoading ? <div className="state">Đang tải chi nhánh…</div>
        : branches.isError ? <Retry error={branches.error} retry={() => void branches.refetch()} />
        : !selectedBranchId ? <Empty title="Chưa có chi nhánh" />
        : services.isLoading ? <div className="state">Đang tải dịch vụ…</div>
        : services.isError ? <Retry error={services.error} retry={() => void services.refetch()} />
        : visibleServices.length ? <div className="catalog-grid">{visibleServices.map((item) =>
          <article className="catalog-card" key={item.publicId}>
            <span className="card-symbol">✳</span><div className="card-tag">{serviceTypeLabel(item.type)}</div>
            <h3>{item.name}</h3><p>{item.category.name} · {item.durationMinutes} phút</p>
            <p>{item.specialty?.name ?? 'Đa khoa'}</p>
            <div className="card-bottom"><strong>{money(item.price.amount)}</strong>
              <Link to={`/explore/services/${selectedBranchId}/${item.publicId}`}>Chi tiết ↗</Link></div>
            <Link className="catalog-book" to={bookingUrl({ branchId: selectedBranchId, serviceId: item.publicId })}>Đặt lịch dịch vụ này</Link>
          </article>)}</div>
          : <Empty title="Chưa có dịch vụ phù hợp" body="Thử đổi chi nhánh, chuyên khoa hoặc từ khóa." />}
      <p className="catalog-disclaimer">Giá đang có hiệu lực tại chi nhánh được chọn. Tổng chi phí có thể thay đổi theo dịch vụ phát sinh và quyền lợi bảo hiểm.</p>
    </section>}
    {view === 'doctors' && <section>
      <div className="section-heading compact"><div><span className="eyebrow">ĐỘI NGŨ CHUYÊN MÔN</span><h2>Bác sĩ đồng hành</h2></div>
        <span>{visibleDoctors.length} bác sĩ</span></div>
      {serviceId && <div className="info-strip">Đang lọc bác sĩ theo dịch vụ đã chọn.
        <button className="inline-link" onClick={() => update({ service: '' })}> Bỏ lọc</button></div>}
      {doctors.isLoading ? <div className="state">Đang tải bác sĩ…</div>
        : doctors.isError ? <Retry error={doctors.error} retry={() => void doctors.refetch()} />
        : visibleDoctors.length ? <div className="catalog-grid">{visibleDoctors.map((item) =>
          <article className="catalog-card doctor-card" key={item.publicId}>
            <div className="doctor-avatar">{item.fullName.charAt(0)}</div>
            <div className="card-tag">{item.academicTitle ?? 'BÁC SĨ'}</div><h3>{item.fullName}</h3>
            <p>{item.specialties.map((part) => part.name).join(' · ') || 'Đa khoa'}</p>
            {item.biography && <p className="catalog-excerpt">{item.biography}</p>}
            <div className="card-bottom"><small>{item.branches.map((part) => part.name).join(', ')}</small>
              <Link to={`/explore/doctors/${item.publicId}${branchId ? `?branch=${branchId}` : ''}`}>Hồ sơ bác sĩ ↗</Link></div>
          </article>)}</div>
          : <Empty title="Không tìm thấy bác sĩ" body="Thử bỏ bớt bộ lọc hoặc đổi từ khóa." />}
    </section>}
    {view === 'branches' && <section>
      <div className="section-heading compact"><div><span className="eyebrow">HỆ THỐNG PHÒNG KHÁM</span><h2>Chi nhánh thuận tiện</h2></div>
        <span>{visibleBranches.length} cơ sở</span></div>
      {branches.isLoading ? <div className="state">Đang tải chi nhánh…</div>
        : branches.isError ? <Retry error={branches.error} retry={() => void branches.refetch()} />
        : visibleBranches.length ? <div className="catalog-grid">{visibleBranches.map((item) =>
          <article className="catalog-card" key={item.publicId}>
            <span className="card-symbol">⌂</span><div className="card-tag">{item.code}</div>
            <h3>{item.name}</h3><p>{fullAddress(item)}</p>
            <div className="card-bottom"><span>{item.phone || 'Thông tin đang cập nhật'}</span>
              <Link to={`/explore/branches/${item.publicId}`}>Chi tiết cơ sở ↗</Link></div>
          </article>)}</div>
          : <Empty title="Không tìm thấy chi nhánh" body="Thử tên hoặc khu vực khác." />}
    </section>}
    {view === 'specialties' && <section>
      <div className="section-heading compact"><div><span className="eyebrow">CHUYÊN MÔN PHÙ HỢP</span><h2>Chuyên khoa</h2></div>
        <span>{visibleSpecialties.length} chuyên khoa</span></div>
      {specialties.isLoading ? <div className="state">Đang tải chuyên khoa…</div>
        : specialties.isError ? <Retry error={specialties.error} retry={() => void specialties.refetch()} />
        : visibleSpecialties.length ? <div className="catalog-grid">{visibleSpecialties.map((item) =>
          <article className="catalog-card" key={item.publicId}>
            <span className="card-symbol">♡</span><div className="card-tag">CHUYÊN KHOA</div>
            <h3>{item.name}</h3><p>{item.description || 'Thông tin chuyên khoa đang được cập nhật.'}</p>
            <div className="card-bottom"><span>Xem dịch vụ và bác sĩ</span>
              <Link to={`/explore/specialties/${item.publicId}`}>Chi tiết ↗</Link></div>
          </article>)}</div>
          : <Empty title="Không tìm thấy chuyên khoa" body="Thử từ khóa ngắn hơn." />}
    </section>}
  </main>
}

export function Retry({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="retry-state" role="alert"><span className="retry-symbol" aria-hidden="true">↻</span>
    <strong>Chưa tải được thông tin</strong><p>{errorMessage(error)}</p>
    <button type="button" className="button button-ghost" onClick={retry}>Thử tải lại</button></div>
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return <div className="empty-state catalog-empty"><span aria-hidden="true">⌕</span>
    <strong>{title}</strong>{body && <p>{body}</p>}</div>
}
