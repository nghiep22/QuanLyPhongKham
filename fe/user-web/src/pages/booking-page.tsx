import { ApiClientError } from '@clinic/generated-api-client'
import type { Appointment, AvailabilitySlot, PatientAccessLink, PublicBranch, PublicService } from '@clinic/generated-api-types'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, dateTime, errorMessage, localDate, money } from '../api'
import { useDoctors } from './catalog'

const status: Record<Appointment['status'], string> = {
  PENDING: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', CHECKED_IN: 'Đã tiếp nhận', IN_PROGRESS: 'Đang khám',
  COMPLETED: 'Hoàn tất', CANCELLED: 'Đã hủy', NO_SHOW: 'Không đến', EXPIRED: 'Hết giữ chỗ',
}
type Retry = { payload: string; key: string }
type SearchWindow = { from: string; to: string }
function validDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const value = new Date(`${date}T00:00:00.000Z`)
  return !Number.isNaN(value.valueOf()) && value.toISOString().slice(0, 10) === date
}
function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
const formatServiceDate = (date: string) => {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}
export function BookingPage() {
  const [params] = useSearchParams(); const queries = useQueryClient()
  const [profiles, setProfiles] = useState<PatientAccessLink[]>([]); const [branches, setBranches] = useState<PublicBranch[]>([])
  const [services, setServices] = useState<PublicService[]>([]); const [appointments, setAppointments] = useState<Appointment[]>([])
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]); const [searchWindow, setSearchWindow] = useState<SearchWindow | null>(null)
  const [profileId, setProfileId] = useState('')
  const [branchId, setBranchId] = useState(params.get('branch') ?? ''); const [serviceId, setServiceId] = useState(params.get('service') ?? '')
  const [doctorId, setDoctorId] = useState(params.get('doctor') ?? ''); const [date, setDate] = useState(localDate(1))
  const [complaint, setComplaint] = useState(''); const [rescheduling, setRescheduling] = useState<Appointment | null>(null)
  const [loading, setLoading] = useState(true); const [serviceLoading, setServiceLoading] = useState(false)
  const [serviceError, setServiceError] = useState(''); const [serviceReload, setServiceReload] = useState(0)
  const [searching, setSearching] = useState(false); const [busy, setBusy] = useState(false)
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [loadError, setLoadError] = useState('')
  const [appointmentView, setAppointmentView] = useState<'upcoming' | 'history'>('upcoming')
  const request = useRef(0); const serviceRequest = useRef(0); const loadRequest = useRef(0)
  const retry = useRef<Retry | null>(null)
  const doctors = useDoctors({ branchId, serviceId })
  const invalidateSlots = () => { request.current++; setSlots([]); setSearchWindow(null); setSearching(false) }
  const load = async () => { const current = ++loadRequest.current; setLoading(true); setLoadError('')
    try { const [access, locations, visits] = await Promise.all([api.patientAccess.get(), api.publicCatalog.branches(), api.appointments.list()])
      if (current !== loadRequest.current) return
      const allowed = access.data.links.filter((link) => link.bookingAllowed)
      setProfiles(allowed); setBranches(locations.data); setAppointments(visits.data)
      setProfileId((current) => allowed.some((link) => link.patient.publicId === current) ? current : allowed[0]?.patient.publicId ?? '')
      setBranchId((current) => locations.data.some((item) => item.publicId === current) ? current : locations.data[0]?.publicId ?? '')
      await queries.invalidateQueries({ queryKey: ['user', 'appointments'] })
    } catch (cause) { if (current === loadRequest.current) setLoadError(errorMessage(cause)) }
    finally { if (current === loadRequest.current) setLoading(false) } }
  useEffect(() => { void load(); return () => { loadRequest.current++ } }, []) // initial list and user-scoped access
  useEffect(() => { if (!branchId) return
    let active = true; const current = ++serviceRequest.current
    invalidateSlots(); setServices([]); setServiceError(''); setServiceLoading(true)
    void api.publicCatalog.services({ branchPublicId: branchId }).then((response) => {
      if (!active || current !== serviceRequest.current) return
      setServices(response.data)
      setServiceId((value) => response.data.some((item) => item.publicId === value) ? value : response.data[0]?.publicId ?? '')
    }).catch((cause) => { if (active) setServiceError(errorMessage(cause)) }).finally(() => { if (active) setServiceLoading(false) })
    return () => { active = false }
  }, [branchId, serviceReload])
  useEffect(() => {
    if (doctorId && doctors.data && !doctors.data.some((item) => item.publicId === doctorId)) {
      setDoctorId(''); invalidateSlots()
    }
  }, [doctorId, doctors.data])
  const findSlots = async (days: 1 | 7) => { if (!branchId || !serviceId || !validDate(date)
    || date < localDate() || serviceError) { setError('Chọn chi nhánh, dịch vụ và ngày khám hợp lệ.'); return }
    const current = ++request.current; const window = { from: date, to: addDays(date, days - 1) }
    setSlots([]); setSearchWindow(null); setSearching(true); setError(''); setNotice('')
    try { const response = await api.publicCatalog.availability({ branchPublicId: branchId, servicePublicId: serviceId,
      ...(doctorId ? { doctorPublicId: doctorId } : {}), fromDate: window.from, toDate: window.to })
      if (current === request.current) { setSlots(response.data); setSearchWindow(window) } }
    catch (cause) { if (current === request.current) setError(errorMessage(cause)) }
    finally { if (current === request.current) setSearching(false) } }
  const chooseSlot = async (slot: AvailabilitySlot) => {
    if (!searchWindow || !slots.some((item) => item.publicId === slot.publicId) || slot.branch.publicId !== branchId
      || slot.service.publicId !== serviceId || slot.serviceDateLocal < searchWindow.from
      || slot.serviceDateLocal > searchWindow.to || (doctorId && slot.doctor.publicId !== doctorId)) {
      setError('Khung giờ không còn khớp lựa chọn hiện tại. Hãy tìm lại.'); return
    }
    if (!rescheduling && !profiles.some((link) => link.patient.publicId === profileId && link.bookingAllowed)) {
      setError('Hãy chọn hồ sơ được phép đặt lịch.'); return
    }
    const body = rescheduling ? { newSlotPublicId: slot.publicId, newServicePublicId: serviceId, reason: 'Bệnh nhân chủ động đổi lịch trên web' }
      : { patientPublicId: profileId, slotPublicId: slot.publicId, servicePublicId: serviceId, ...(complaint.trim() ? { chiefComplaint: complaint.trim() } : {}) }
    const payload = JSON.stringify(body)
    if (!retry.current || retry.current.payload !== payload) retry.current = { payload, key: crypto.randomUUID() }
    setBusy(true); setError(''); setNotice('')
    try { if (rescheduling) await api.appointments.reschedule(rescheduling.publicId, body as { newSlotPublicId: string; newServicePublicId: string; reason: string }, retry.current.key)
      else await api.appointments.book(body as { patientPublicId: string; slotPublicId: string; servicePublicId: string; chiefComplaint?: string }, retry.current.key)
      retry.current = null; invalidateSlots(); setRescheduling(null); setComplaint('')
      setNotice(rescheduling ? 'Đã đổi sang khung giờ mới.' : 'Đã giữ chỗ. Phòng khám sẽ xác nhận lịch hẹn.')
      await load()
    } catch (cause) { if (cause instanceof ApiClientError && cause.code === 'IDEMPOTENCY_KEY_REUSED') retry.current = null; setError(errorMessage(cause)) }
    finally { setBusy(false) } }
  const cancel = async (item: Appointment) => { if (!window.confirm(`Hủy lịch ${item.code} · ${item.service.name}?`)) return
    setBusy(true); setError(''); try { await api.appointments.cancel(item.publicId, { reason: 'Bệnh nhân chủ động hủy trên web' }); setNotice(`Đã hủy lịch ${item.code}.`); await load() }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) } }
  const today = localDate()
  const isUpcoming = (item: Appointment) => ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS'].includes(item.status)
    && item.serviceDateLocal >= today
  const upcomingCount = appointments.filter(isUpcoming).length
  const shownAppointments = appointments.filter((item) => appointmentView === 'upcoming' ? isUpcoming(item) : !isUpcoming(item))
    .sort((a, b) => appointmentView === 'upcoming'
      ? a.scheduledStartUtc.localeCompare(b.scheduledStartUtc) : b.scheduledStartUtc.localeCompare(a.scheduledStartUtc))
  return <main className="container page patient-page booking-page"><div className="page-intro patient-intro"><div className="patient-intro-copy"><span className="eyebrow">ĐẶT LỊCH TRỰC TUYẾN</span><h1>Lịch khám thuận tiện cho bạn</h1><p>Chọn hồ sơ, dịch vụ và khung giờ phù hợp. Giờ khám hiển thị theo chi nhánh.</p></div><div className="patient-intro-note"><span className="patient-note-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 10h16m-11 5 2 2 4-4" /></svg></span><div><strong>Chủ động lịch chăm sóc</strong><small>Theo dõi và điều chỉnh lịch hẹn của bạn tại đây.</small></div></div></div>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="success" role="status">{notice}</div>}
    {loadError && <div className="error" role="alert">{loadError} <button className="inline-link" onClick={() => void load()}>Thử tải lại</button></div>}
    {(!loadError || branches.length > 0 || appointments.length > 0) && <div className="booking-layout"><section className="panel booking-form"><div className="panel-head"><div><span className="eyebrow">BƯỚC 01</span><h2>{rescheduling ? `Đổi lịch ${rescheduling.code}` : 'Thông tin đặt lịch'}</h2></div>{rescheduling && <button className="text-button" onClick={() => { setRescheduling(null); invalidateSlots() }}>Thoát đổi lịch</button>}</div>
      {loading ? <div className="state patient-form-loading">Đang tải dữ liệu…</div> : <>
      {!rescheduling && <label>Hồ sơ đi khám<select value={profileId} onChange={(event) => { setProfileId(event.target.value); invalidateSlots() }}><option value="">Chọn hồ sơ</option>{profiles.map((link) => <option key={link.publicId} value={link.patient.publicId}>{link.patient.fullName} · {link.patient.code}</option>)}</select></label>}
      {!profiles.length && !rescheduling && <div className="info-strip">Bạn cần hồ sơ đã xác minh để giữ chỗ. <Link to="/profiles">Liên kết hồ sơ →</Link></div>}
      <div className="form-row"><label>Chi nhánh<select value={branchId} onChange={(event) => { setBranchId(event.target.value); setServiceId(''); setDoctorId(''); invalidateSlots() }}><option value="">Chọn chi nhánh</option>{branches.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}</select></label>
        <label>Dịch vụ<select value={serviceId} disabled={serviceLoading || !!serviceError} onChange={(event) => { setServiceId(event.target.value); setDoctorId(''); invalidateSlots() }}><option value="">{serviceLoading ? 'Đang tải dịch vụ…' : 'Chọn dịch vụ'}</option>{services.map((item) => <option key={item.publicId} value={item.publicId}>{item.name} · {money(item.price.amount)}</option>)}</select></label></div>
      {serviceError && <div className="error" role="alert">Không tải được dịch vụ: {serviceError} <button className="inline-link" onClick={() => setServiceReload((value) => value + 1)}>Thử lại</button></div>}
      <label>Bác sĩ (không bắt buộc)<select value={doctorId} disabled={!serviceId || doctors.isLoading} onChange={(event) => { setDoctorId(event.target.value); invalidateSlots() }}>
        <option value="">Bất kỳ bác sĩ phù hợp</option>{doctors.data?.map((item) => <option key={item.publicId} value={item.publicId}>{item.fullName}</option>)}</select></label>
      {doctors.isError && <div className="error" role="alert">Không tải được danh sách bác sĩ. Bạn vẫn có thể tìm lịch chung. <button className="inline-link" onClick={() => void doctors.refetch()}>Thử lại</button></div>}
      {serviceId && !doctors.isLoading && !doctors.isError && !doctors.data?.length && <p className="hint">Chưa có danh sách bác sĩ để chọn. Bạn vẫn có thể tìm lịch chung.</p>}
      {doctorId && <p className="hint">Chỉ hiển thị khung giờ của bác sĩ đã chọn.</p>}
      <div className="form-row"><label>Ngày bắt đầu tìm<input type="date" min={today} value={date} onChange={(event) => { setDate(event.target.value); invalidateSlots() }} /></label>
        {!rescheduling && <label>Lý do khám (không bắt buộc)<input value={complaint} maxLength={1000} onChange={(event) => setComplaint(event.target.value)} placeholder="Mô tả ngắn gọn" /></label>}</div>
      <div className="booking-search-actions"><button className="button" disabled={!serviceId || searching || serviceLoading || !!serviceError} onClick={() => void findSlots(1)}>{searching ? 'Đang tìm…' : 'Tìm trong ngày'} →</button>
        <button className="button button-ghost" disabled={!serviceId || searching || serviceLoading || !!serviceError} onClick={() => void findSlots(7)}>Tìm trong 7 ngày →</button></div>
      </>}</section>
      <section className="panel slot-panel"><div className="panel-head"><div><span className="eyebrow">BƯỚC 02</span><h2>Chọn khung giờ</h2></div><span className="slot-count">{slots.length} khung giờ</span></div>
        {searching ? <div className="state">Đang tìm lịch trống…</div> : slots.length ? <div className="slot-list">{[...slots].sort((a, b) => `${a.serviceDateLocal} ${a.startTimeLocal}`.localeCompare(`${b.serviceDateLocal} ${b.startTimeLocal}`)).map((slot) => <div className="slot-card" key={slot.publicId}><span className="time-tile">{slot.startTimeLocal}</span><div><strong>{slot.doctor.name}</strong><p>{slot.service.name} · {slot.room.name}</p><small>{formatServiceDate(slot.serviceDateLocal)} · {slot.branch.name}</small></div><button className="button button-small" disabled={busy} onClick={() => void chooseSlot(slot)}>{rescheduling ? 'Chuyển lịch' : 'Giữ chỗ'}</button></div>)}</div>
          : <div className="empty-state"><span>▦</span><strong>{searchWindow ? 'Không có khung giờ trống' : 'Chưa chọn khung giờ'}</strong><p>{searchWindow ? 'Thử đổi ngày, dịch vụ hoặc bác sĩ để tìm lịch khác.' : 'Tìm lịch để xem các khung giờ đang trống.'}</p></div>}</section></div>}
    {(!loadError || appointments.length > 0) && <section className="appointments-section"><div className="section-heading compact"><div><span className="eyebrow">QUẢN LÝ LỊCH HẸN</span><h2>Lịch của bạn</h2></div><button className="inline-link" disabled={loading} onClick={() => void load()}>{loading ? 'Đang tải…' : 'Tải lại ↻'}</button></div>
      <div className="appointment-filter" role="group" aria-label="Lọc lịch khám"><button type="button" className={appointmentView === 'upcoming' ? 'active' : ''} aria-pressed={appointmentView === 'upcoming'} onClick={() => setAppointmentView('upcoming')}>Sắp tới <span>{upcomingCount}</span></button>
        <button type="button" className={appointmentView === 'history' ? 'active' : ''} aria-pressed={appointmentView === 'history'} onClick={() => setAppointmentView('history')}>Lịch sử <span>{appointments.length - upcomingCount}</span></button></div>
      {loading && !appointments.length ? <div className="state">Đang tải lịch khám…</div>
        : shownAppointments.length ? <div className="appointment-grid">{shownAppointments.map((item) => <article className="appointment-card" key={item.publicId}><div className="appointment-head"><span className={`pill appointment-status status-${item.status.toLowerCase()}`}>{status[item.status]}</span><small>{item.code}</small></div><h3>{item.service.name}</h3><strong className="appointment-date">{formatServiceDate(item.serviceDateLocal)} · {item.startTimeLocal}–{item.endTimeLocal}</strong><p>{item.doctor.fullName} · {item.branch.name} · {item.roomName}</p><p>Hồ sơ: {item.patient.fullName}</p>{item.holdExpiresAtUtc && <p className="hint">Giữ chỗ đến {dateTime(item.holdExpiresAtUtc)}</p>}
        {(['PENDING', 'CONFIRMED'] as Appointment['status'][]).includes(item.status) && isUpcoming(item) && <div className="appointment-actions"><button disabled={busy} className="button button-ghost" onClick={() => { setRescheduling(item); setBranchId(item.branch.publicId); setServiceId(item.service.publicId); setDoctorId(''); setDate(item.serviceDateLocal < localDate(1) ? localDate(1) : item.serviceDateLocal); invalidateSlots(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Đổi lịch</button><button disabled={busy} className="button button-danger" onClick={() => void cancel(item)}>Hủy lịch</button></div>}</article>)}</div>
        : <div className="empty-state"><span aria-hidden="true">▦</span><strong>{appointmentView === 'upcoming' ? 'Chưa có lịch khám sắp tới' : 'Chưa có lịch sử khám'}</strong><p>{appointmentView === 'upcoming' ? 'Chọn dịch vụ và khung giờ phù hợp để bắt đầu.' : 'Các lịch đã hoàn thành hoặc hủy sẽ hiển thị ở đây.'}</p></div>}</section>}</main>
}
