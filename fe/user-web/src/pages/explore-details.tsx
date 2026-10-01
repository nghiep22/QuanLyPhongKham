import type { PublicBranch, PublicDoctor, PublicService } from '@clinic/generated-api-types'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { money } from '../api'
import { bookingUrl, fullAddress, serviceTypeLabel, useBranches, useDoctors, useServices, useSpecialties } from './catalog'
import { Empty, Retry } from './explore-page'

const formatDate = (value: string) => {
  const [year, month, day] = value.split('-')
  return day && month && year ? `${day}/${month}/${year}` : value
}
const formatMinutes = (value: number) => value < 60 ? `${value} phút`
  : `${Math.floor(value / 60)} giờ${value % 60 ? ` ${value % 60} phút` : ''}`

function DetailLayout({ back, children }: { back: string; children: React.ReactNode }) {
  return <main className="container page detail-page">
    <Link className="back-link" to={back}>← Quay lại danh sách</Link>{children}
  </main>
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="detail-info-row"><span>{label}</span><strong>{value}</strong></div>
}

function ServiceRow({ branch, service }: { branch: PublicBranch; service: PublicService }) {
  return <Link className="detail-list-row" to={`/explore/services/${branch.publicId}/${service.publicId}`}>
    <span className="detail-row-icon">✳</span><span><strong>{service.name}</strong>
      <small>{serviceTypeLabel(service.type)} · {service.durationMinutes} phút</small></span>
    <b>{money(service.price.amount)}</b><span aria-hidden="true">↗</span>
  </Link>
}

function DoctorRow({ doctor, branchId }: { doctor: PublicDoctor; branchId?: string }) {
  return <Link className="detail-list-row" to={`/explore/doctors/${doctor.publicId}${branchId ? `?branch=${branchId}` : ''}`}>
    <span className="doctor-avatar small">{doctor.fullName.charAt(0)}</span><span>
      <strong>{doctor.academicTitle ? `${doctor.academicTitle} ` : ''}{doctor.fullName}</strong>
      <small>{doctor.specialties.map((item) => item.name).join(' · ') || 'Đa khoa'}</small>
    </span><span aria-hidden="true">↗</span>
  </Link>
}

export function BranchDetailPage() {
  const { branchId } = useParams()
  const branches = useBranches()
  const branch = branches.data?.find((item) => item.publicId === branchId)
  return <DetailLayout back="/explore?view=branches">
    {branches.isLoading ? <div className="state">Đang tải chi nhánh…</div>
      : branches.isError ? <Retry error={branches.error} retry={() => void branches.refetch()} />
      : !branch ? <Empty title="Không tìm thấy chi nhánh" />
      : <><div className="detail-hero"><span className="eyebrow">CƠ SỞ KHÁM CHỮA BỆNH · {branch.code}</span>
        <h1>{branch.name}</h1><p>{fullAddress(branch)}</p></div>
        <div className="detail-columns"><section className="panel"><h2>Thông tin chi nhánh</h2>
          <Info label="Điện thoại" value={branch.phone || 'Đang cập nhật'} />
          <Info label="Email" value={branch.email || 'Đang cập nhật'} />
          <Info label="Đặt trước tối đa" value={`${branch.bookingHorizonDays} ngày`} />
          <Info label="Giữ chỗ trực tuyến" value={`${branch.onlineHoldMinutes} phút`} />
          <Info label="Hạn hủy lịch" value={`Trước giờ khám ${formatMinutes(branch.cancellationDeadlineMinutes)}`} />
        </section><section className="panel detail-actions"><h2>Khám tại chi nhánh</h2>
          <p>Chọn dịch vụ, bác sĩ và thời gian phù hợp tại cơ sở này.</p>
          <Link className="button full" to={bookingUrl({ branchId: branch.publicId })}>Đặt lịch tại chi nhánh →</Link>
          <Link className="button button-ghost full" to={`/explore?view=services&branch=${branch.publicId}`}>Xem dịch vụ & bảng giá</Link>
          <Link className="button button-ghost full" to={`/explore?view=doctors&branch=${branch.publicId}`}>Xem bác sĩ tại đây</Link>
          {branch.phone && <a className="inline-link" href={`tel:${branch.phone}`}>Gọi cho phòng khám: {branch.phone}</a>}
        </section></div></>}
  </DetailLayout>
}

export function SpecialtyDetailPage() {
  const { specialtyId } = useParams()
  const branches = useBranches()
  const specialties = useSpecialties()
  const specialty = specialties.data?.find((item) => item.publicId === specialtyId)
  const [branchId, setBranchId] = useState('')
  const branch = branches.data?.find((item) => item.publicId === branchId) ?? branches.data?.[0]
  const services = useServices(branch?.publicId ?? '', specialtyId)
  const doctors = useDoctors({ branchId: branch?.publicId, specialtyId })
  return <DetailLayout back="/explore?view=specialties">
    {specialties.isLoading || branches.isLoading ? <div className="state">Đang tải chuyên khoa…</div>
      : specialties.isError ? <Retry error={specialties.error} retry={() => void specialties.refetch()} />
      : branches.isError ? <Retry error={branches.error} retry={() => void branches.refetch()} />
      : !specialty ? <Empty title="Không tìm thấy chuyên khoa" />
      : <><div className="detail-hero soft"><span className="eyebrow">CHUYÊN KHOA</span><h1>{specialty.name}</h1>
        <p>{specialty.description || 'Nội dung giới thiệu đang được cập nhật.'}</p></div>
        <div className="detail-section-head"><h2>Chọn chi nhánh</h2></div>
        <div className="choice-row">{branches.data?.map((item) => <button key={item.publicId}
          className={branch?.publicId === item.publicId ? 'active' : ''}
          onClick={() => setBranchId(item.publicId)}>{item.name}</button>)}</div>
        <div className="detail-columns"><section className="panel"><div className="panel-head"><h2>Dịch vụ</h2>
          {branch && <Link className="inline-link" to={`/explore?view=services&branch=${branch.publicId}&specialty=${specialty.publicId}`}>Xem bảng giá ↗</Link>}</div>
          {services.isLoading ? <p>Đang tải dịch vụ…</p>
            : services.isError ? <Retry error={services.error} retry={() => void services.refetch()} />
            : services.data?.length && branch ? services.data.slice(0, 4).map((item) =>
              <ServiceRow key={item.publicId} branch={branch} service={item} />)
              : <Empty title="Chưa có dịch vụ tại chi nhánh này" />}
        </section><section className="panel"><div className="panel-head"><h2>Bác sĩ phù hợp</h2>
          <Link className="inline-link" to={`/explore?view=doctors&specialty=${specialty.publicId}${branch ? `&branch=${branch.publicId}` : ''}`}>Xem tất cả ↗</Link></div>
          {doctors.isLoading ? <p>Đang tải bác sĩ…</p>
            : doctors.isError ? <Retry error={doctors.error} retry={() => void doctors.refetch()} />
            : doctors.data?.length ? doctors.data.slice(0, 3).map((item) =>
              <DoctorRow key={item.publicId} doctor={item} branchId={branch?.publicId} />)
              : <Empty title="Chưa có bác sĩ phù hợp" />}
        </section></div>
        {branch && <Link className="button" to={bookingUrl({ branchId: branch.publicId })}>Tìm lịch khám phù hợp →</Link>}
      </>}
  </DetailLayout>
}

export function ServiceDetailPage() {
  const { branchId, serviceId } = useParams()
  const branches = useBranches()
  const branch = branches.data?.find((item) => item.publicId === branchId)
  const services = useServices(branchId ?? '')
  const service = services.data?.find((item) => item.publicId === serviceId)
  const doctors = useDoctors({ branchId, serviceId })
  return <DetailLayout back={`/explore?view=services${branchId ? `&branch=${branchId}` : ''}`}>
    {branches.isLoading || services.isLoading ? <div className="state">Đang tải dịch vụ…</div>
      : branches.isError ? <Retry error={branches.error} retry={() => void branches.refetch()} />
      : services.isError ? <Retry error={services.error} retry={() => void services.refetch()} />
      : !branch || !service ? <Empty title="Không tìm thấy dịch vụ tại chi nhánh này" />
      : <><div className="detail-hero green"><span className="eyebrow light">{serviceTypeLabel(service.type)} · {service.code}</span>
        <h1>{service.name}</h1><strong className="detail-price">{money(service.price.amount)}</strong>
        <p>{branch.name} · Giá hiệu lực từ {formatDate(service.price.effectiveFrom)}</p></div>
        <div className="detail-columns"><section className="panel"><h2>Thông tin dịch vụ</h2>
          <Info label="Thời lượng" value={`Khoảng ${service.durationMinutes} phút`} />
          <Info label="Chuyên khoa" value={service.specialty?.name ?? 'Đa khoa'} />
          <Info label="Nhóm dịch vụ" value={service.category.name} />
          <Info label="Cần bác sĩ" value={service.requiresDoctor ? 'Có' : 'Không'} />
          <Link className="button full detail-book" to={bookingUrl({ branchId: branch.publicId, serviceId: service.publicId })}>
            Chọn lịch cho dịch vụ này →</Link>
        </section><section className="panel"><div className="panel-head"><h2>Bác sĩ thực hiện</h2>
          <Link className="inline-link" to={`/explore?view=doctors&branch=${branch.publicId}&service=${service.publicId}`}>Xem tất cả ↗</Link></div>
          {doctors.isLoading ? <p>Đang tải bác sĩ…</p>
            : doctors.isError ? <Retry error={doctors.error} retry={() => void doctors.refetch()} />
            : doctors.data?.length ? doctors.data.slice(0, 3).map((item) =>
              <DoctorRow key={item.publicId} doctor={item} branchId={branch.publicId} />)
              : <Empty title="Chưa có bác sĩ trực tuyến" body="Bạn vẫn có thể tìm khung giờ chung của dịch vụ." />}
        </section></div>
        <p className="catalog-disclaimer">Giá hiển thị là giá đang có hiệu lực tại chi nhánh đã chọn và chưa gồm dịch vụ phát sinh.</p>
      </>}
  </DetailLayout>
}

export function DoctorDetailPage() {
  const { doctorId } = useParams()
  const [params] = useSearchParams()
  const doctors = useDoctors({})
  const doctor = doctors.data?.find((item) => item.publicId === doctorId)
  const branches = useBranches()
  const requestedBranchId = params.get('branch') ?? ''
  const [branchId, setBranchId] = useState(requestedBranchId)
  const selectedBranchId = doctor?.branches.some((item) => item.publicId === branchId) ? branchId
    : doctor?.branches[0]?.publicId ?? ''
  const branch = branches.data?.find((item) => item.publicId === selectedBranchId)
  const services = useServices(selectedBranchId)
  const branchDoctors = useDoctors({ branchId: selectedBranchId })
  const branchDoctor = branchDoctors.data?.find((item) => item.publicId === doctorId)
  const availableServices = services.data?.filter((item) => branchDoctor?.servicePublicIds.includes(item.publicId)) ?? []
  return <DetailLayout back="/explore?view=doctors">
    {doctors.isLoading ? <div className="state">Đang tải bác sĩ…</div>
      : doctors.isError ? <Retry error={doctors.error} retry={() => void doctors.refetch()} />
      : !doctor ? <Empty title="Không tìm thấy bác sĩ" />
      : <><div className="detail-hero doctor-detail-hero"><div className="doctor-avatar large">{doctor.fullName.charAt(0)}</div>
        <span className="eyebrow">{doctor.academicTitle || 'BÁC SĨ'}</span>
        <h1>{doctor.fullName}</h1><p>{doctor.specialties.map((item) => item.name).join(' · ') || 'Đa khoa'}</p></div>
        <section className="panel detail-intro"><h2>Giới thiệu</h2>
          <p>{doctor.biography || 'Thông tin giới thiệu bác sĩ đang được phòng khám cập nhật.'}</p></section>
        <section className="panel detail-intro"><h2>Chi nhánh làm việc</h2>
          <div className="choice-row">{doctor.branches.map((item) => <button key={item.publicId}
            className={selectedBranchId === item.publicId ? 'active' : ''}
            onClick={() => setBranchId(item.publicId)}>{item.name}</button>)}</div></section>
        <section className="panel detail-intro"><h2>Dịch vụ có thể đặt</h2>
          {services.isLoading || branchDoctors.isLoading || branches.isLoading ? <p>Đang tải dịch vụ…</p>
            : services.isError || branchDoctors.isError || branches.isError ? <Retry
              error={services.error ?? branchDoctors.error ?? branches.error}
              retry={() => void Promise.all([services.refetch(), branchDoctors.refetch(), branches.refetch()])} />
            : availableServices.length && branch ? availableServices.map((item) =>
              <ServiceRow key={item.publicId} branch={branch} service={item} />)
              : <Empty title="Chưa có dịch vụ tại cơ sở này" body="Chọn chi nhánh khác của bác sĩ." />}
          {branch && availableServices.length > 0 && <Link className="button detail-book"
            to={bookingUrl({ branchId: branch.publicId, doctorId: doctor.publicId,
              serviceId: availableServices[0].publicId })}>Đặt lịch với bác sĩ →</Link>}
        </section></>}
  </DetailLayout>
}
