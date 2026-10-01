import { ApiClientError } from '@clinic/generated-api-client'
import type { Appointment, AppointmentStatus, AvailabilitySlot, PatientSummary, PublicService } from '@clinic/generated-api-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { clearPendingOperation, executeIdempotent, hasPendingOperation, verifyPendingOperation } from '../../shared/api/idempotent-operation'
import { appointmentPrintDocument, openPrintDocument } from '../../shared/printing'
import { useAuth } from '../auth/auth-context'
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
  if (!(error instanceof ApiClientError)) return error instanceof Error ? error.message : 'Không thể kết nối hệ thống.'
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
  const [dateRevision, setDateRevision] = useState(0)
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
  return <><header><div><span className="eyebrow">ĐIỀU PHỐI LỊCH HẸN</span><h1>Lịch hẹn</h1>
    <p>Đặt lịch tại quầy, xác nhận lịch online và theo dõi trạng thái trong đúng phạm vi chi nhánh.</p></div></header>
    <section className="panel appointment-toolbar">
      <label>Chi nhánh<select value={selectedBranchId} onChange={(event) => setBranchId(event.target.value)}>
        {references.data?.data.branches.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}</select></label>
      <label>Ngày khám<input type="date" value={date} onChange={(event) => {
        setDate(event.target.value); setDateRevision((value) => value + 1)
      }} /></label>
      <label>Trạng thái<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
        {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Tìm kiếm<input value={query} maxLength={100} placeholder="Mã lịch, mã BN, họ tên" onChange={(event) => setQuery(event.target.value)} /></label>
    </section>
    {selectedBranchId && <CounterBooking key={selectedBranchId} branchId={selectedBranchId}
      date={date} dateRevision={dateRevision} onDone={refresh} />}
    <section className="appointment-list"><h2>Lịch trong ngày</h2>
      {list.isLoading ? <div className="page-state panel">Đang tải lịch hẹn…</div>
        : list.error ? <div className="page-state error-state">{message(list.error)}</div>
          : list.data?.data.length ? list.data.data.map((item) => <AppointmentCard key={item.publicId} item={item} now={now}
              onDone={refresh} onRescheduled={(newDate) => {
                setDate(newDate); setDateRevision((value) => value + 1); refresh()
              }} />)
            : <div className="page-state panel">Không có lịch phù hợp bộ lọc.</div>}
    </section>
  </>
}

function CounterBooking({ branchId, date, dateRevision, onDone }: {
  branchId: string; date: string; dateRevision: number; onDone: () => void
}) {
  const [open, setOpen] = useState(false); const [patientQuery, setPatientQuery] = useState('')
  const [patients, setPatients] = useState<PatientSummary[]>([]); const [patient, setPatient] = useState<PatientSummary | null>(null)
  const [services, setServices] = useState<PublicService[]>([]); const [serviceId, setServiceId] = useState('')
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]); const [complaint, setComplaint] = useState('')
  const [slotsFor, setSlotsFor] = useState('')
  const slotRequest = useRef(0)
  const patientRequest = useRef(0)
  const patientSearchRequest = useRef(0)
  const selection = JSON.stringify([branchId, date, dateRevision, patient?.publicId, serviceId])
  const selectionRef = useRef(selection)
  useLayoutEffect(() => { selectionRef.current = selection }, [selection])
  const [error, setError] = useState<unknown>(null); const retry = useRef<{ payload: string; key: string } | null>(null)
  const search = async () => { const requestNumber = ++patientSearchRequest.current
    setError(null); setPatients([]); try {
      const response = await apiClient.patients.search({ branchPublicId: branchId, query: patientQuery.trim() || undefined })
      if (requestNumber === patientSearchRequest.current) setPatients(response.data)
    } catch (cause) { if (requestNumber === patientSearchRequest.current) setError(cause) } }
  const choosePatient = async (item: PatientSummary) => { slotRequest.current++; const requestNumber = ++patientRequest.current
    setSlots([]); setSlotsFor('');
    setPatient(item); setServiceId(''); setError(null); try {
    const response = await apiClient.publicCatalog.services({ branchPublicId: branchId });
    if (requestNumber !== patientRequest.current) return
    setServices(response.data)
    setServiceId(response.data[0]?.publicId ?? '')
  } catch (cause) { setError(cause) } }
  const findSlots = async () => { if (!serviceId || !patient) return; setError(null)
    const requestNumber = ++slotRequest.current
    const requestedSelection = selection
    setSlots([]); setSlotsFor('')
    try {
    const response = await apiClient.publicCatalog.availability({ branchPublicId: branchId, servicePublicId: serviceId, fromDate: date, toDate: date })
    if (requestNumber === slotRequest.current && requestedSelection === selectionRef.current) {
      setSlots(response.data); setSlotsFor(requestedSelection)
    }
  } catch (cause) { if (requestNumber === slotRequest.current) setError(cause) } }
  const book = async (slot: AvailabilitySlot) => { if (!patient || slotsFor !== selection) return
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
      onChange={(event) => {
        patientSearchRequest.current++; setPatientQuery(event.target.value); setPatients([])
      }} placeholder="Mã BN, tên, số điện thoại" /></label>
      <button type="button" onClick={() => void search()}>Tìm</button></div>
      {patients.length > 0 && <div className="choice-list">{patients.map((item) => <button type="button" className={patient?.publicId === item.publicId ? 'selected-choice' : 'secondary'}
        key={item.publicId} onClick={() => void choosePatient(item)}>{item.fullName} · {item.code}</button>)}</div>}
      {patient && <div className="booking-fields"><label>Dịch vụ<select value={serviceId} onChange={(event) => {
        slotRequest.current++; setServiceId(event.target.value); setSlots([]); setSlotsFor('') }}>
        {services.map((item) => <option key={item.publicId} value={item.publicId}>{item.name} · {Number(item.price.amount).toLocaleString('vi-VN')} ₫</option>)}</select></label>
        <label>Lý do khám<input maxLength={1000} value={complaint} onChange={(event) => setComplaint(event.target.value)} /></label>
        <button type="button" onClick={() => void findSlots()}>Tìm slot {date}</button></div>}
      {slotsFor === selection && slots.length > 0 && <div className="choice-list">{slots.map((slot) => <button type="button" key={slot.publicId}
        onClick={() => void book(slot)}>{slot.startTimeLocal} · {slot.doctor.name} · {slot.room.name}</button>)}</div>}
      {Boolean(error) && <div className="form-error" role="alert">{message(error)}</div>}
    </div>}
  </section>
}

function RescheduleEditor({ item, onDone }: { item: Appointment; onDone: (newDate: string) => void }) {
  const { user } = useAuth()
  const [date, setDate] = useState(item.serviceDateLocal)
  const [serviceId, setServiceId] = useState(item.service.publicId)
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState<{ date: string; serviceId: string } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const [reconciled, setReconciled] = useState(false)
  const queryClient = useQueryClient()
  const services = useQuery({ queryKey: ['reschedule-services', item.branch.publicId],
    queryFn: () => apiClient.publicCatalog.services({ branchPublicId: item.branch.publicId }) })
  const availability = useQuery({ queryKey: ['admin-availability', item.branch.publicId, search?.serviceId, search?.date],
    queryFn: () => apiClient.appointmentAdmin.availability(item.branch.publicId, search!.serviceId, search!.date),
    enabled: Boolean(search) })
  const currentSearch = search?.date === date && search.serviceId === serviceId
  const scope = `${user?.publicId}:reschedule:${item.publicId}`
  const submit = async (slot: AvailabilitySlot) => {
    if (reason.trim().length < 3 || !currentSearch || availability.isFetching || availability.error
      || !availability.data?.data.some((candidate) => candidate.publicId === slot.publicId)
      || slot.serviceDateLocal !== date || slot.service.publicId !== serviceId
      || slot.branch.publicId !== item.branch.publicId) {
      setError(new Error('Chọn slot mới còn hiệu lực và nhập lý do ít nhất 3 ký tự.')); return
    }
    setBusy(true); setError(null); setReconciled(false)
    const body = { newSlotPublicId: slot.publicId, newServicePublicId: serviceId, reason: reason.trim() }
    try {
      await executeIdempotent(scope, body, (key) => apiClient.appointmentAdmin.reschedule(item.publicId, body, key))
      setPending(false)
      onDone(slot.serviceDateLocal)
    } catch (cause) {
      setError(cause); setPending(hasPendingOperation(scope))
      if (cause instanceof ApiClientError && cause.status === 409) void availability.refetch()
    } finally { setBusy(false) }
  }
  return <section className="panel"><h4>Đổi lịch {item.code}</h4>
    <div className="booking-fields"><label>Ngày mới<input type="date" value={date} onChange={(event) => {
      setDate(event.target.value); setSearch(null)
    }} /></label>
      <label>Dịch vụ<select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setSearch(null) }}>
        {services.data?.data.map((service) => <option key={service.publicId} value={service.publicId}>{service.name}</option>)}
      </select></label>
      <label>Lý do đổi lịch<input required minLength={3} maxLength={500} value={reason}
        onChange={(event) => setReason(event.target.value)} /></label>
      <button type="button" disabled={!serviceId || !date || services.isLoading || busy}
        onClick={() => {
          void queryClient.invalidateQueries({ queryKey: ['admin-availability', item.branch.publicId, serviceId, date] })
          setSearch({ date, serviceId }); setError(null)
        }}>Tìm slot mới</button></div>
    {services.error && <div className="form-error" role="alert">{message(services.error)}</div>}
    {currentSearch && availability.isFetching && <p>Đang tìm slot…</p>}
    {currentSearch && availability.error && <div className="form-error" role="alert">{message(availability.error)}</div>}
    {currentSearch && !availability.isFetching && !availability.error && availability.data && <div className="choice-list">
      {availability.data.data.filter((slot) => slot.publicId !== item.slotPublicId).map((slot) =>
        <button type="button" key={slot.publicId} disabled={busy || reason.trim().length < 3}
          onClick={() => void submit(slot)}>{slot.serviceDateLocal} · {slot.startTimeLocal} · {slot.doctor.name} · {slot.room.name}</button>)}
      {!availability.data.data.some((slot) => slot.publicId !== item.slotPublicId) && <p>Không có slot phù hợp.</p>}
    </div>}
    {Boolean(error) && <div className="form-error" role="alert">{message(error)}</div>}
    {pending && <div className="action-row"><button type="button" className="secondary" onClick={async () => {
      setReconciled(false); setError(null)
      try {
        if (await verifyPendingOperation(scope, () => true, () => queryClient.refetchQueries({
          queryKey: ['appointments-admin', item.branch.publicId], type: 'active',
        }, { throwOnError: true }))) setReconciled(true)
      } catch (cause) { setError(cause) }
    }}>Tải lại lịch để đối chiếu</button>
      {reconciled && <button type="button" className="secondary" onClick={() => {
        if (!window.confirm('Bạn đã đối chiếu lịch hẹn và muốn bắt đầu lượt đổi lịch mới?')) return
        clearPendingOperation(scope); setPending(false); setReconciled(false); setError(null)
      }}>Đã đối chiếu, đổi lịch mới</button>}</div>}
  </section>
}

function AppointmentCard({ item, now, onDone, onRescheduled }: {
  item: Appointment; now: number; onDone: () => void; onRescheduled: (newDate: string) => void
}) {
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
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
      {(['PENDING', 'CONFIRMED'] as AppointmentStatus[]).includes(item.status) && <button type="button" className="secondary"
        disabled={busy} onClick={() => setRescheduling((value) => !value)}>{rescheduling ? 'Đóng đổi lịch' : 'Đổi lịch'}</button>}
      {(['PENDING', 'CONFIRMED'] as AppointmentStatus[]).includes(item.status) && <button disabled={busy} className="danger-button" type="button" onClick={cancel}>Hủy lịch</button>}
      {canMarkAppointmentNoShow(item, now) && <button disabled={busy} className="secondary" type="button"
        onClick={() => void run(() => apiClient.appointmentAdmin.noShow(item.publicId, { reason: 'Bệnh nhân không đến' }))}>Không đến</button>}
    </div>{rescheduling && <RescheduleEditor item={item} onDone={onRescheduled} />}
    {Boolean(error) && <div className="form-error">{message(error)}</div>}
  </article>
}
