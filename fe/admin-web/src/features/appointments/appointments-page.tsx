import { ApiClientError } from '@clinic/generated-api-client'
import type { Appointment, AppointmentStatus, AvailabilitySlot, PatientSummary, PublicService } from '@clinic/generated-api-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { appointmentPrintDocument, openPrintDocument } from '../../shared/printing'
import { canMarkAppointmentNoShow } from './appointment-actions'

const statuses: Array<['' | AppointmentStatus, string]> = [['', 'Tất cả'], ['PENDING', 'Chờ xác nhận'],
  ['CONFIRMED', 'Đã xác nhận'], ['CHECKED_IN', 'Đã check-in'], ['IN_PROGRESS', 'Đang khám'],
  ['COMPLETED', 'Hoàn tất'], ['CANCELLED', 'Đã hủy'], ['NO_SHOW', 'Không đến'], ['EXPIRED', 'Hết giữ chỗ']]
const today = () => { const value = new Date(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
function idempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    return (character === 'x' ? random : (random % 4) + 8).toString(16)
  })
}
function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống.'
  if (error.code === 'SLOT_CONFLICT') return 'Khung giờ vừa được đặt hoặc xung đột lịch bệnh nhân.'
  if (error.code === 'APPOINTMENT_STATE_CONFLICT') return 'Lịch hẹn đã chuyển trạng thái. Hãy tải lại.'
  if (error.code === 'BOOKING_POLICY_CONFLICT') return 'Đã ngoài thời hạn xử lý lịch hẹn.'
  if (error.status === 403) return 'Bạn không có quyền quản lý lịch tại chi nhánh này.'
  return error.message
}

export function AppointmentsPage() {
  const client = useQueryClient()
  const [now, setNow] = useState(0)
  const references = useQuery({ queryKey: ['patient-reference'], queryFn: () => apiClient.patients.references() })
  const [branchId, setBranchId] = useState(''); const [date, setDate] = useState(today())
  const [status, setStatus] = useState<'' | AppointmentStatus>(''); const [query, setQuery] = useState('')
  const selectedBranchId = branchId || references.data?.data.branches[0]?.publicId || ''
  const list = useQuery({ queryKey: ['appointments-admin', selectedBranchId, date, status, query],
    queryFn: () => apiClient.appointmentAdmin.list({ branchPublicId: selectedBranchId, serviceDate: date,
      ...(status ? { status } : {}), ...(query.trim() ? { query: query.trim() } : {}) }), enabled: Boolean(selectedBranchId && date) })
  const refresh = () => void client.invalidateQueries({ queryKey: ['appointments-admin', selectedBranchId] })
  useEffect(() => {
    const updateNow = () => setNow(Date.now())
    const initial = window.setTimeout(updateNow, 0)
    const timer = window.setInterval(updateNow, 30_000)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [])
  if (references.isLoading) return <div className="page-state">Đang tải phạm vi lịch hẹn…</div>
  if (references.error) return <div className="page-state error-state">{message(references.error)}</div>
  return <><header><div><span className="eyebrow">APPOINTMENTS</span><h1>Lịch hẹn</h1>
    <p>Đặt lịch tại quầy, xác nhận lịch online và theo dõi trạng thái trong đúng phạm vi chi nhánh.</p></div></header>
    <section className="panel appointment-toolbar">
      <label>Chi nhánh<select value={selectedBranchId} onChange={(event) => setBranchId(event.target.value)}>
        {references.data?.data.branches.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}</select></label>
      <label>Ngày khám<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <label>Trạng thái<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
        {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Tìm kiếm<input value={query} maxLength={100} placeholder="Mã lịch, mã BN, họ tên" onChange={(event) => setQuery(event.target.value)} /></label>
    </section>
    {selectedBranchId && <CounterBooking key={selectedBranchId} branchId={selectedBranchId} date={date} onDone={refresh} />}
    <section className="appointment-list"><h2>Lịch trong ngày</h2>
      {list.isLoading ? <div className="page-state panel">Đang tải lịch hẹn…</div>
        : list.error ? <div className="page-state error-state">{message(list.error)}</div>
          : list.data?.data.length ? list.data.data.map((item) => <AppointmentCard key={item.publicId} item={item} now={now} onDone={refresh} />)
            : <div className="page-state panel">Không có lịch phù hợp bộ lọc.</div>}
    </section>
  </>
}

function CounterBooking({ branchId, date, onDone }: { branchId: string; date: string; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [patientQuery, setPatientQuery] = useState('')
  const [patients, setPatients] = useState<PatientSummary[]>([]); const [patient, setPatient] = useState<PatientSummary | null>(null)
  const [services, setServices] = useState<PublicService[]>([]); const [serviceId, setServiceId] = useState('')
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]); const [complaint, setComplaint] = useState('')
  const [error, setError] = useState<unknown>(null); const retry = useRef<{ payload: string; key: string } | null>(null)
  const search = async () => { setError(null); try {
    const response = await apiClient.patients.search({ branchPublicId: branchId, query: patientQuery.trim() || undefined }); setPatients(response.data)
  } catch (cause) { setError(cause) } }
  const choosePatient = async (item: PatientSummary) => { setPatient(item); setError(null); try {
    const response = await apiClient.publicCatalog.services({ branchPublicId: branchId }); setServices(response.data)
    setServiceId(response.data[0]?.publicId ?? '')
  } catch (cause) { setError(cause) } }
  const findSlots = async () => { if (!serviceId) return; setError(null); try {
    const response = await apiClient.publicCatalog.availability({ branchPublicId: branchId, servicePublicId: serviceId, fromDate: date, toDate: date })
    setSlots(response.data)
  } catch (cause) { setError(cause) } }
  const book = async (slot: AvailabilitySlot) => { if (!patient) return
    const body = { patientPublicId: patient.publicId, slotPublicId: slot.publicId, servicePublicId: serviceId,
      bookingChannel: 'COUNTER' as const, ...(complaint.trim() ? { chiefComplaint: complaint.trim() } : {}) }
    const payload = JSON.stringify(body); if (!retry.current || retry.current.payload !== payload) retry.current = { payload, key: idempotencyKey() }
    setError(null); try { await apiClient.appointmentAdmin.book(body, retry.current.key); retry.current = null; setSlots([]); setPatient(null); setOpen(false); onDone() }
    catch (cause) { setError(cause) }
  }
  return <section className="panel counter-booking"><div className="detail-heading"><div><h2>Đặt lịch tại quầy</h2>
    <p>Lịch PHONE/COUNTER được xác nhận ngay sau khi khóa slot thành công.</p></div>
    <button type="button" className="secondary" onClick={() => setOpen(!open)}>{open ? 'Đóng' : 'Tạo lịch'}</button></div>
    {open && <div className="counter-flow"><div className="inline-search"><label>Tìm bệnh nhân<input value={patientQuery}
      onChange={(event) => setPatientQuery(event.target.value)} placeholder="Mã BN, tên, số điện thoại" /></label>
      <button type="button" onClick={() => void search()}>Tìm</button></div>
      {patients.length > 0 && <div className="choice-list">{patients.map((item) => <button type="button" className={patient?.publicId === item.publicId ? 'selected-choice' : 'secondary'}
        key={item.publicId} onClick={() => void choosePatient(item)}>{item.fullName} · {item.code}</button>)}</div>}
      {patient && <div className="booking-fields"><label>Dịch vụ<select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setSlots([]) }}>
        {services.map((item) => <option key={item.publicId} value={item.publicId}>{item.name} · {Number(item.price.amount).toLocaleString('vi-VN')} ₫</option>)}</select></label>
        <label>Lý do khám<input maxLength={1000} value={complaint} onChange={(event) => setComplaint(event.target.value)} /></label>
        <button type="button" onClick={() => void findSlots()}>Tìm slot {date}</button></div>}
      {slots.length > 0 && <div className="choice-list">{slots.map((slot) => <button type="button" key={slot.publicId}
        onClick={() => void book(slot)}>{slot.startTimeLocal} · {slot.doctor.name} · {slot.room.name}</button>)}</div>}
      {Boolean(error) && <div className="form-error" role="alert">{message(error)}</div>}
    </div>}
  </section>
}

function AppointmentCard({ item, now, onDone }: { item: Appointment; now: number; onDone: () => void }) {
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(null); try { await action(); onDone() } catch (cause) { setError(cause) } finally { setBusy(false) } }
  const cancel = () => { const reason = window.prompt('Lý do hủy lịch (tối thiểu 3 ký tự):'); if (reason?.trim() && reason.trim().length >= 3)
    void run(() => apiClient.appointmentAdmin.cancel(item.publicId, { reason: reason.trim() })) }
  return <article className="appointment-card"><div className="catalog-card-heading"><div><span className={`status status-${item.status.toLowerCase()}`}>{statuses.find(([value]) => value === item.status)?.[1]}</span>
    <h3>{item.startTimeLocal} · {item.patient.fullName}</h3><p>{item.code} · {item.patient.code} · {item.service.name}</p></div>
    <strong>{item.doctor.fullName}</strong></div>
    <p>{item.roomName}{item.chiefComplaint ? ` · ${item.chiefComplaint}` : ''}</p>
    {item.holdExpiresAtUtc && <p className="appointment-warning">Giữ chỗ đến {new Date(item.holdExpiresAtUtc).toLocaleString('vi-VN')}</p>}
    <div className="appointment-actions">
      {(['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED'] as AppointmentStatus[]).includes(item.status)
        && <button className="secondary" type="button"
          onClick={() => openPrintDocument(appointmentPrintDocument(item))}>In phiếu hẹn</button>}
      {item.status === 'PENDING' && <button disabled={busy} type="button" onClick={() => void run(() => apiClient.appointmentAdmin.confirm(item.publicId))}>Xác nhận</button>}
      {(['PENDING', 'CONFIRMED'] as AppointmentStatus[]).includes(item.status) && <button disabled={busy} className="danger-button" type="button" onClick={cancel}>Hủy lịch</button>}
      {canMarkAppointmentNoShow(item, now) && <button disabled={busy} className="secondary" type="button"
        onClick={() => void run(() => apiClient.appointmentAdmin.noShow(item.publicId, { reason: 'Bệnh nhân không đến' }))}>Không đến</button>}
    </div>{Boolean(error) && <div className="form-error">{message(error)}</div>}
  </article>
}
