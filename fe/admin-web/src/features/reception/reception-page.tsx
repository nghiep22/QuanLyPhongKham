import { ApiClientError } from '@clinic/generated-api-client'
import type { CheckInCandidate, CreateWalkInRequest, ReceptionPatient, ReceptionWorkspace } from '@clinic/generated-api-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { openPrintDocument, receptionSlipPrintDocument } from '../../shared/printing'
import { getAdminAccess } from '../auth/admin-access'
import { useAuth } from '../auth/auth-context'
import { scopedSelection } from './scoped-selection'

function idempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    return (character === 'x' ? random : (random % 4) + 8).toString(16)
  })
}
function message(error: unknown) {
  if (error instanceof Error && error.message === 'CANCELLATION_REASON_TOO_SHORT') {
    return 'Lý do thao tác phải có ít nhất 10 ký tự.'
  }
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống.'
  if (error.code === 'CHECK_IN_WINDOW_CLOSED') return 'Bệnh nhân đang ngoài cửa sổ check-in của chi nhánh.'
  if (error.code === 'WALK_IN_CAPACITY_FULL') return 'Đã hết ô giờ phù hợp trong thời gian chờ cho phép. Hãy chọn bác sĩ hoặc phòng khác, hoặc hẹn giờ khác.'
  if (error.code === 'PATIENT_TIME_CONFLICT') return 'Bệnh nhân đã có lịch hẹn trùng giờ này.'
  if (error.code === 'RECEPTION_STATE_CONFLICT') return 'Lịch hoặc tài nguyên tiếp nhận vừa thay đổi. Hãy tải lại.'
  if (error.code === 'QUEUE_STATE_CONFLICT') return 'Số hàng đợi đã đổi trạng thái. Hãy tải lại trước khi thao tác.'
  if (error.code === 'ENCOUNTER_CANCELLATION_NOT_ALLOWED') return 'Chỉ có thể hủy lượt đang chờ hoặc đang khám.'
  if (error.code === 'ENCOUNTER_MEDICATION_NOT_REVERSED') return 'Cần đảo toàn bộ thuốc đã cấp trước khi hủy lượt khám.'
  if (error.code === 'ENCOUNTER_HAS_PAYMENT') return 'Lượt khám đã có thanh toán nên không thể hủy.'
  if (error.status === 403) return 'Bạn không có quyền tiếp nhận tại chi nhánh này.'
  return error.message
}

export function ReceptionPage() {
  const { user } = useAuth()
  const { canCancelEncounters } = getAdminAccess(user)
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
    if (!response.data) window.alert('Chưa có bệnh nhân đến giờ được gọi.')
  } catch (error) { setCallError(error) } finally { setCalling(false) } }

  if (branches.isLoading) return <div className="page-state">Đang tải phạm vi tiếp nhận…</div>
  if (branches.error) return <div className="page-state error-state">{message(branches.error)}</div>
  if (!branches.data?.data.length) return <div className="page-state error-state">Tài khoản chưa được cấp phạm vi tiếp nhận.</div>
  const data = workspace.data?.data
  return <><header><div><span className="eyebrow">TIẾP NHẬN BỆNH NHÂN</span><h1>Tiếp nhận & hàng đợi</h1>
    <p>Tiếp nhận theo ô giờ của bác sĩ và gọi số khi gần đến giờ phục vụ.</p></div>
    <button type="button" disabled={calling || !data?.queue.some((ticket) => ticket.status === 'WAITING' && ticket.eligibleToCall)}
      onClick={() => void callNext()}>{calling ? 'Đang gọi…' : 'Gọi bệnh nhân kế tiếp'}</button></header>
    <section className="panel reception-toolbar"><label>Chi nhánh<select value={selectedBranchId} onChange={(event) => setBranchId(event.target.value)}>
      {branches.data.data.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}</select></label>
      {data && <div className="policy-note"><strong>Ngày nghiệp vụ {data.branch.businessDate}</strong>
        <span>Check-in từ trước giờ hẹn {data.branch.checkInEarlyMinutes} phút đến sau giờ kết thúc {data.branch.checkInLateMinutes} phút. Walk-in nhận khi có ô giờ trong {data.branch.walkInMaxWaitMinutes} phút tới; gọi số sớm tối đa 10 phút.</span></div>}
      <button type="button" className="secondary" onClick={refresh}>Tải lại</button></section>
    {Boolean(callError) && <div className="form-error" role="alert">{message(callError)}</div>}
    {workspace.isLoading ? <div className="page-state panel">Đang tải quầy tiếp nhận…</div>
      : workspace.error ? <div className="page-state error-state">{message(workspace.error)}</div>
        : data && <><section className="reception-grid"><QueueBoard key={selectedBranchId} branch={data.branch} tickets={data.queue} refresh={refresh}
          printedBy={user?.displayName ?? null}
          canCancel={canCancelEncounters} />
          <AppointmentArrivals items={data.appointments} refresh={refresh} /></section>
          <WalkInPanel key={selectedBranchId} branchId={selectedBranchId} data={data} refresh={refresh} /></>}
  </>
}

function QueueBoard({ branch, tickets, printedBy, refresh, canCancel }: {
  branch: ReceptionWorkspace['branch']; tickets: ReceptionWorkspace['queue']; printedBy: string | null;
  refresh: () => void; canCancel: boolean
}) {
  const groups = [['SERVING', 'Đang phục vụ'], ['CALLED', 'Đã gọi'], ['WAITING', 'Đang chờ'],
    ['SKIPPED', 'Đã bỏ qua']] as const
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null); const [notice, setNotice] = useState('')
  const changeStatus = async (ticket: ReceptionWorkspace['queue'][number], action: 'SKIP' | 'RECALL') => {
    const label = action === 'SKIP' ? 'bỏ qua' : 'gọi lại'
    const entered = window.prompt(`Lý do ${label} số ${ticket.displayNumber} (tối thiểu 10 ký tự):`)
    if (entered == null) return
    const reason = entered.trim()
    if (reason.length < 10) { setError(new Error('CANCELLATION_REASON_TOO_SHORT')); return }
    setBusy(ticket.publicId); setError(null); setNotice('')
    try {
      if (action === 'SKIP') await apiClient.reception.skip(ticket.publicId, { reason })
      else await apiClient.reception.recall(ticket.publicId, { reason })
      setNotice(`Đã ${label} số ${ticket.displayNumber}.`); refresh()
    } catch (cause) { setError(cause) }
    finally { setBusy('') }
  }
  const cancel = async (ticket: ReceptionWorkspace['queue'][number]) => {
    const entered = window.prompt(`Lý do hủy lượt ${ticket.encounterCode} (tối thiểu 10 ký tự):`)
    if (entered == null) return
    const reason = entered.trim()
    if (reason.length < 10) { setError(new Error('CANCELLATION_REASON_TOO_SHORT')); return }
    if (!window.confirm(`Xác nhận hủy lượt ${ticket.encounterCode} của ${ticket.patient.fullName}?`)) return
    setBusy(ticket.publicId); setError(null); setNotice('')
    try {
      await apiClient.reception.cancelEncounter(ticket.encounterPublicId, { reason })
      setNotice(`Đã hủy lượt ${ticket.encounterCode} và đóng số ${ticket.displayNumber}.`); refresh()
    } catch (cause) { setError(cause) }
    finally { setBusy('') }
  }
  return <section className="panel queue-board"><div className="detail-heading"><div><h2>Hàng đợi hiện tại</h2>
    <p>{tickets.length} bệnh nhân đang chờ, được gọi, phục vụ hoặc đã bỏ qua.</p></div></div>
    {notice && <div className="form-success" role="status">{notice}</div>}
    {Boolean(error) && <div className="form-error" role="alert">{message(error)}</div>}
    <div className="queue-columns">{groups.map(([status, label]) => <div key={status}><h3>{label}</h3>
      {tickets.filter((ticket) => ticket.status === status).map((ticket) => <article className={`queue-ticket queue-${status.toLowerCase()}`} key={ticket.publicId}>
        <strong>{ticket.displayNumber}</strong><div><b>{ticket.patient.fullName}</b><span>{ticket.patient.code} · {ticket.doctor.fullName}</span>
          <small>{ticket.room?.name ?? 'Chưa xếp phòng'}{ticket.priorityLevel ? ` · Ưu tiên ${ticket.priorityLevel}` : ''}
            {ticket.plannedStartTimeLocal ? ` · Giờ dự kiến ${ticket.plannedStartTimeLocal}` : ''}
            {ticket.status === 'WAITING' && ticket.estimatedWaitMinutes !== null ? ` · Còn ${ticket.estimatedWaitMinutes} phút đến giờ dự kiến` : ''}</small></div>
        <div className="queue-ticket-actions"><button type="button" className="secondary"
          onClick={() => openPrintDocument(receptionSlipPrintDocument(branch, ticket, printedBy))}>In phiếu</button>
          {status === 'CALLED' && <button type="button" className="secondary" disabled={Boolean(busy)}
            onClick={() => void changeStatus(ticket, 'SKIP')}>Bỏ qua</button>}
          {status === 'SKIPPED' && <button type="button" className="secondary" disabled={Boolean(busy)}
            onClick={() => void changeStatus(ticket, 'RECALL')}>Gọi lại</button>}
          {canCancel && <button type="button" className="danger-link" disabled={Boolean(busy)} onClick={() => void cancel(ticket)}>
            {busy === ticket.publicId ? 'Đang hủy…' : 'Hủy lượt'}
          </button>}</div></article>)}
      {!tickets.some((ticket) => ticket.status === status) && <div className="empty-column">Trống</div>}</div>)}</div>
  </section>
}

function AppointmentArrivals({ items, refresh }: { items: CheckInCandidate[]; refresh: () => void }) {
  const [busy, setBusy] = useState(''); const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const checkIn = async (item: CheckInCandidate) => { const entered = window.prompt('Mức ưu tiên 0–9:', '0')
    if (entered == null) return; const priority = Number(entered)
    if (!Number.isInteger(priority) || priority < 0 || priority > 9) { setError(new Error('priority')); return }
    setBusy(item.publicId); setError(null); setNotice(''); try {
      const response = await apiClient.reception.checkIn(item.publicId, { priorityLevel: priority }, idempotencyKey())
      setNotice(`Đã cấp số ${response.data.displayNumber}. Dùng “In phiếu” tại hàng đợi để giao bệnh nhân.`); refresh()
    }
    catch (cause) { setError(cause) } finally { setBusy('') } }
  return <section className="panel arrival-list"><h2>Lịch chờ check-in</h2><p>{items.length} lịch CONFIRMED trong ngày nghiệp vụ.</p>
    {items.map((item) => <article key={item.publicId} className="arrival-card"><div><strong>{item.startTimeLocal} · {item.patient.fullName}</strong>
      <span>{item.code} · {item.service.name}</span><small>{item.doctor.fullName} · {item.room.name}</small></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => void checkIn(item)}>{busy === item.publicId ? 'Đang cấp số…' : 'Check-in'}</button></article>)}
    {!items.length && <div className="empty-column">Không có lịch chờ check-in.</div>}
    {notice && <div className="form-success" role="status">{notice}</div>}
    {Boolean(error) && <div className="form-error" role="alert">{error instanceof ApiClientError ? message(error) : 'Mức ưu tiên phải từ 0 đến 9.'}</div>}
  </section>
}

function WalkInPanel({ branchId, data, refresh }: { branchId: string; data: ReceptionWorkspace; refresh: () => void }) {
  const [patientQuery, setPatientQuery] = useState(''); const [patients, setPatients] = useState<ReceptionPatient[]>([])
  const [patient, setPatient] = useState<ReceptionPatient | null>(null); const [serviceId, setServiceId] = useState(data.services[0]?.publicId ?? '')
  const selectedServiceId = scopedSelection(serviceId, data.services)
  const eligibleDoctors = useMemo(() => data.doctors.filter((doctor) => data.walkInSlots.some((item) =>
    item.doctorPublicId === doctor.publicId && item.servicePublicId === selectedServiceId)), [data, selectedServiceId])
  const [doctorId, setDoctorId] = useState(''); const [roomId, setRoomId] = useState(data.rooms[0]?.publicId ?? '')
  const [complaint, setComplaint] = useState(''); const [priority, setPriority] = useState(0); const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('')
  const retry = useRef<{ payload: string; key: string } | null>(null)
  const selectedDoctorId = eligibleDoctors.some((item) => item.publicId === doctorId) ? doctorId : eligibleDoctors[0]?.publicId ?? ''
  const eligibleRooms = data.rooms.filter((room) => data.walkInSlots.some((slot) =>
    slot.servicePublicId === selectedServiceId && slot.doctorPublicId === selectedDoctorId && slot.roomPublicId === room.publicId))
  const selectedRoomId = scopedSelection(roomId, eligibleRooms)
  const nextSlot = data.walkInSlots.find((slot) => slot.servicePublicId === selectedServiceId
    && slot.doctorPublicId === selectedDoctorId && slot.roomPublicId === selectedRoomId)
  const search = async () => { if (patientQuery.trim().length < 2) return; setError(null); try {
    setPatients((await apiClient.reception.searchPatients(branchId, patientQuery.trim())).data)
  } catch (cause) { setError(cause) } }
  const create = async () => { if (!patient || !selectedServiceId || !selectedDoctorId || !selectedRoomId) return
    const body: CreateWalkInRequest = { branchPublicId: branchId, patientPublicId: patient.publicId,
      doctorPublicId: selectedDoctorId, roomPublicId: selectedRoomId, servicePublicId: selectedServiceId, priorityLevel: priority,
      ...(complaint.trim() ? { chiefComplaint: complaint.trim() } : {}) }
    const payload = JSON.stringify(body); if (!retry.current || retry.current.payload !== payload) retry.current = { payload, key: idempotencyKey() }
    setBusy(true); setError(null); setNotice(''); try { const response = await apiClient.reception.createWalkIn(body, retry.current.key)
      retry.current = null; setPatient(null); setPatients([]); setComplaint(''); refresh()
      setNotice(`Đã cấp số ${response.data.displayNumber}. Dùng “In phiếu” tại hàng đợi để giao bệnh nhân.`)
    } catch (cause) { setError(cause) } finally { setBusy(false) } }
  return <section className="panel walk-in-panel"><div className="detail-heading"><div><h2>Tiếp nhận walk-in</h2>
    <p>Chỉ tiếp nhận khi còn ô giờ của bác sĩ và phòng trong {data.branch.walkInMaxWaitMinutes} phút tới. Nếu đã kín, hẹn giờ khác để tránh chờ lâu.</p></div></div>
    <div className="inline-search"><label>Tìm bệnh nhân<input value={patientQuery} onChange={(event) => setPatientQuery(event.target.value)}
      placeholder="Mã BN, họ tên hoặc số điện thoại" /></label><button type="button" className="secondary"
        disabled={patientQuery.trim().length < 2} onClick={() => void search()}>Tìm</button></div>
    {patients.length > 0 && <div className="choice-list">{patients.map((item) => <button type="button" key={item.publicId}
      className={patient?.publicId === item.publicId ? 'selected-choice' : 'secondary'} onClick={() => setPatient(item)}>{item.fullName} · {item.code}</button>)}</div>}
    {patient && <div className="walk-in-fields"><label>Dịch vụ<select value={selectedServiceId} onChange={(event) => { setServiceId(event.target.value); setDoctorId('') }}>
      {data.services.map((item) => <option value={item.publicId} key={item.publicId}>{item.name} · {Number(item.priceAmount).toLocaleString('vi-VN')} ₫</option>)}</select></label>
      <label>Bác sĩ<select value={selectedDoctorId} onChange={(event) => setDoctorId(event.target.value)}>{eligibleDoctors.map((item) =>
        <option value={item.publicId} key={item.publicId}>{item.fullName}</option>)}</select></label>
      <label>Phòng<select value={selectedRoomId} onChange={(event) => setRoomId(event.target.value)}>{eligibleRooms.map((item) =>
        <option value={item.publicId} key={item.publicId}>{item.name}</option>)}</select></label>
      {nextSlot ? <p className="wide policy-note">Giờ khám gần nhất: {nextSlot.startTimeLocal}. Slot có thể thay đổi trước khi xác nhận.</p>
        : <p className="wide policy-note">Dịch vụ, bác sĩ và phòng này chưa có ô giờ trống trong giới hạn chờ.</p>}
      <label>Ưu tiên<select value={priority} onChange={(event) => setPriority(Number(event.target.value))}>{Array.from({ length: 10 }, (_, value) =>
        <option value={value} key={value}>{value === 0 ? '0 · Thường' : value}</option>)}</select></label>
      <label className="wide">Lý do khám<input maxLength={1000} value={complaint} onChange={(event) => setComplaint(event.target.value)} /></label>
      <button type="button" disabled={busy || !selectedServiceId || !selectedDoctorId || !selectedRoomId} onClick={() => void create()}>{busy ? 'Đang cấp số…' : 'Tiếp nhận & cấp số'}</button></div>}
    {notice && <div className="form-success" role="status">{notice}</div>}
    {Boolean(error) && <div className="form-error" role="alert">{message(error)}</div>}
  </section>
}
