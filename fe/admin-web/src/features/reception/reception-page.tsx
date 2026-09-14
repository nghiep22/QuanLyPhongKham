import { ApiClientError } from '@clinic/generated-api-client'
import type { CheckInCandidate, CreateWalkInRequest, ReceptionPatient, ReceptionWorkspace } from '@clinic/generated-api-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { apiClient } from '../../shared/api/client'

function idempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    return (character === 'x' ? random : (random % 4) + 8).toString(16)
  })
}
function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống.'
  if (error.code === 'CHECK_IN_WINDOW_CLOSED') return 'Bệnh nhân đang ngoài cửa sổ check-in của chi nhánh.'
  if (error.code === 'RECEPTION_STATE_CONFLICT') return 'Lịch hoặc tài nguyên tiếp nhận vừa thay đổi. Hãy tải lại.'
  if (error.status === 403) return 'Bạn không có quyền tiếp nhận tại chi nhánh này.'
  return error.message
}

export function ReceptionPage() {
  const queryClient = useQueryClient()
  const [branchId, setBranchId] = useState('')
  const branches = useQuery({ queryKey: ['reception-branches'], queryFn: () => apiClient.reception.branches() })
  const selectedBranchId = branchId || branches.data?.data[0]?.publicId || ''
  const workspace = useQuery({ queryKey: ['reception', selectedBranchId], queryFn: () => apiClient.reception.get(selectedBranchId),
    enabled: Boolean(selectedBranchId), refetchInterval: 15_000 })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['reception', selectedBranchId] })
  const [callError, setCallError] = useState<unknown>(null); const [calling, setCalling] = useState(false)
  const callNext = async () => { if (!selectedBranchId) return; setCalling(true); setCallError(null); try {
    const response = await apiClient.reception.callNext({ branchPublicId: selectedBranchId }); refresh()
    if (!response.data) window.alert('Hàng đợi hiện không còn bệnh nhân chờ.')
  } catch (error) { setCallError(error) } finally { setCalling(false) } }

  if (branches.isLoading) return <div className="page-state">Đang tải phạm vi tiếp nhận…</div>
  if (branches.error) return <div className="page-state error-state">{message(branches.error)}</div>
  if (!branches.data?.data.length) return <div className="page-state error-state">Tài khoản chưa được cấp phạm vi tiếp nhận.</div>
  const data = workspace.data?.data
  return <><header><div><span className="eyebrow">RECEPTION & QUEUE</span><h1>Tiếp nhận & hàng đợi</h1>
    <p>Check-in lịch đã xác nhận, tiếp nhận khách đến trực tiếp và gọi số theo ưu tiên rồi FIFO.</p></div>
    <button type="button" disabled={calling || !data} onClick={() => void callNext()}>{calling ? 'Đang gọi…' : 'Gọi bệnh nhân kế tiếp'}</button></header>
    <section className="panel reception-toolbar"><label>Chi nhánh<select value={selectedBranchId} onChange={(event) => setBranchId(event.target.value)}>
      {branches.data.data.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}</select></label>
      {data && <div className="policy-note"><strong>Ngày nghiệp vụ {data.branch.businessDate}</strong>
        <span>Check-in từ trước giờ hẹn {data.branch.checkInEarlyMinutes} phút đến sau giờ kết thúc {data.branch.checkInLateMinutes} phút.</span></div>}
      <button type="button" className="secondary" onClick={refresh}>Tải lại</button></section>
    {Boolean(callError) && <div className="form-error" role="alert">{message(callError)}</div>}
    {workspace.isLoading ? <div className="page-state panel">Đang tải quầy tiếp nhận…</div>
      : workspace.error ? <div className="page-state error-state">{message(workspace.error)}</div>
        : data && <><section className="reception-grid"><QueueBoard tickets={data.queue} />
          <AppointmentArrivals items={data.appointments} refresh={refresh} /></section>
          <WalkInPanel branchId={selectedBranchId} data={data} refresh={refresh} /></>}
  </>
}

function QueueBoard({ tickets }: { tickets: ReceptionWorkspace['queue'] }) {
  const groups = [['SERVING', 'Đang phục vụ'], ['CALLED', 'Đã gọi'], ['WAITING', 'Đang chờ']] as const
  return <section className="panel queue-board"><div className="detail-heading"><div><h2>Hàng đợi hiện tại</h2>
    <p>{tickets.length} bệnh nhân đang trong luồng chờ–gọi–phục vụ.</p></div></div>
    <div className="queue-columns">{groups.map(([status, label]) => <div key={status}><h3>{label}</h3>
      {tickets.filter((ticket) => ticket.status === status).map((ticket) => <article className={`queue-ticket queue-${status.toLowerCase()}`} key={ticket.publicId}>
        <strong>{ticket.displayNumber}</strong><div><b>{ticket.patient.fullName}</b><span>{ticket.patient.code} · {ticket.doctor.fullName}</span>
          <small>{ticket.room?.name ?? 'Chưa xếp phòng'}{ticket.priorityLevel ? ` · Ưu tiên ${ticket.priorityLevel}` : ''}</small></div></article>)}
      {!tickets.some((ticket) => ticket.status === status) && <div className="empty-column">Trống</div>}</div>)}</div>
  </section>
}

function AppointmentArrivals({ items, refresh }: { items: CheckInCandidate[]; refresh: () => void }) {
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null)
  const checkIn = async (item: CheckInCandidate) => { const entered = window.prompt('Mức ưu tiên 0–9:', '0')
    if (entered == null) return; const priority = Number(entered)
    if (!Number.isInteger(priority) || priority < 0 || priority > 9) { setError(new Error('priority')); return }
    setBusy(item.publicId); setError(null); try { await apiClient.reception.checkIn(item.publicId, { priorityLevel: priority }, idempotencyKey()); refresh() }
    catch (cause) { setError(cause) } finally { setBusy('') } }
  return <section className="panel arrival-list"><h2>Lịch chờ check-in</h2><p>{items.length} lịch CONFIRMED trong ngày nghiệp vụ.</p>
    {items.map((item) => <article key={item.publicId} className="arrival-card"><div><strong>{item.startTimeLocal} · {item.patient.fullName}</strong>
      <span>{item.code} · {item.service.name}</span><small>{item.doctor.fullName} · {item.room.name}</small></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => void checkIn(item)}>{busy === item.publicId ? 'Đang cấp số…' : 'Check-in'}</button></article>)}
    {!items.length && <div className="empty-column">Không có lịch chờ check-in.</div>}
    {Boolean(error) && <div className="form-error" role="alert">{error instanceof ApiClientError ? message(error) : 'Mức ưu tiên phải từ 0 đến 9.'}</div>}
  </section>
}

function WalkInPanel({ branchId, data, refresh }: { branchId: string; data: ReceptionWorkspace; refresh: () => void }) {
  const [patientQuery, setPatientQuery] = useState(''); const [patients, setPatients] = useState<ReceptionPatient[]>([])
  const [patient, setPatient] = useState<ReceptionPatient | null>(null); const [serviceId, setServiceId] = useState(data.services[0]?.publicId ?? '')
  const eligibleDoctors = useMemo(() => data.doctors.filter((doctor) => data.doctorServices.some((item) =>
    item.doctorPublicId === doctor.publicId && item.servicePublicId === serviceId)), [data, serviceId])
  const [doctorId, setDoctorId] = useState(''); const [roomId, setRoomId] = useState(data.rooms[0]?.publicId ?? '')
  const [complaint, setComplaint] = useState(''); const [priority, setPriority] = useState(0); const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false); const retry = useRef<{ payload: string; key: string } | null>(null)
  const selectedDoctorId = eligibleDoctors.some((item) => item.publicId === doctorId) ? doctorId : eligibleDoctors[0]?.publicId ?? ''
  const search = async () => { if (patientQuery.trim().length < 2) return; setError(null); try {
    setPatients((await apiClient.reception.searchPatients(branchId, patientQuery.trim())).data)
  } catch (cause) { setError(cause) } }
  const create = async () => { if (!patient || !serviceId || !selectedDoctorId || !roomId) return
    const body: CreateWalkInRequest = { branchPublicId: branchId, patientPublicId: patient.publicId,
      doctorPublicId: selectedDoctorId, roomPublicId: roomId, servicePublicId: serviceId, priorityLevel: priority,
      ...(complaint.trim() ? { chiefComplaint: complaint.trim() } : {}) }
    const payload = JSON.stringify(body); if (!retry.current || retry.current.payload !== payload) retry.current = { payload, key: idempotencyKey() }
    setBusy(true); setError(null); try { const response = await apiClient.reception.createWalkIn(body, retry.current.key)
      retry.current = null; setPatient(null); setPatients([]); setComplaint(''); refresh(); window.alert(`Đã cấp số ${response.data.displayNumber}.`)
    } catch (cause) { setError(cause) } finally { setBusy(false) } }
  return <section className="panel walk-in-panel"><div className="detail-heading"><div><h2>Tiếp nhận walk-in</h2>
    <p>Tạo thẳng lượt khám, dịch vụ ban đầu và số hàng đợi — không tạo lịch hẹn giả.</p></div></div>
    <div className="inline-search"><label>Tìm bệnh nhân<input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)}
      placeholder="Mã BN, họ tên hoặc số điện thoại" /></label><button type="button" className="secondary" onClick={() => void search()}>Tìm</button></div>
    {patients.length > 0 && <div className="choice-list">{patients.map((item) => <button type="button" key={item.publicId}
      className={patient?.publicId === item.publicId ? 'selected-choice' : 'secondary'} onClick={() => setPatient(item)}>{item.fullName} · {item.code}</button>)}</div>}
    {patient && <div className="walk-in-fields"><label>Dịch vụ<select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setDoctorId('') }}>
      {data.services.map((item) => <option value={item.publicId} key={item.publicId}>{item.name} · {Number(item.priceAmount).toLocaleString('vi-VN')} ₫</option>)}</select></label>
      <label>Bác sĩ<select value={selectedDoctorId} onChange={(event) => setDoctorId(event.target.value)}>{eligibleDoctors.map((item) =>
        <option value={item.publicId} key={item.publicId}>{item.fullName}</option>)}</select></label>
      <label>Phòng<select value={roomId} onChange={(event) => setRoomId(event.target.value)}>{data.rooms.map((item) =>
        <option value={item.publicId} key={item.publicId}>{item.name}</option>)}</select></label>
      <label>Ưu tiên<select value={priority} onChange={(event) => setPriority(Number(event.target.value))}>{Array.from({ length: 10 }, (_, value) =>
        <option value={value} key={value}>{value === 0 ? '0 · Thường' : value}</option>)}</select></label>
      <label className="wide">Lý do khám<input maxLength={1000} value={complaint} onChange={(event) => setComplaint(event.target.value)} /></label>
      <button type="button" disabled={busy || !selectedDoctorId || !roomId} onClick={() => void create()}>{busy ? 'Đang cấp số…' : 'Tiếp nhận & cấp số'}</button></div>}
    {Boolean(error) && <div className="form-error" role="alert">{message(error)}</div>}
  </section>
}
