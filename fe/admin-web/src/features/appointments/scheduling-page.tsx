import { ApiClientError } from '@clinic/generated-api-client'
import type { CreateWorkingScheduleRequest, SchedulingData } from '@clinic/generated-api-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '../../shared/api/client'

const weekdays = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật']
const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const today = () => localDate(new Date())
const plusDays = (days: number) => { const value = new Date(); value.setDate(value.getDate() + days); return localDate(value) }
function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return error instanceof Error ? error.message : 'Không thể kết nối hệ thống.'
  if (error.code === 'SLOT_CONFLICT') return 'Ca làm việc chồng lịch bác sĩ hoặc phòng.'
  if (error.code === 'SCHEDULE_STATE_CONFLICT') return 'Trạng thái ca đã thay đổi. Vui lòng tải lại lịch.'
  if (error.code === 'SCHEDULE_VALIDATION_ERROR') return 'Ngày, giờ, phòng hoặc khoảng nghỉ không hợp lệ.'
  if (error.status === 403) return 'Bạn không có quyền quản lý lịch tại chi nhánh này.'
  return error.message
}

type ScheduleForm = Omit<CreateWorkingScheduleRequest, 'branchPublicId' | 'breaks'> & {
  breakStart: string; breakEnd: string; breakName: string
}
const empty: ScheduleForm = { doctorPublicId: '', roomPublicId: '', weekdayIso: 1, localStartTime: '08:00',
  localEndTime: '12:00', slotDurationMinutes: 30, effectiveFrom: today(), effectiveTo: null,
  bookingHorizonDays: null, breakStart: '', breakEnd: '', breakName: '' }

export function SchedulingPage() {
  const client = useQueryClient()
  const references = useQuery({ queryKey: ['catalog-reference'], queryFn: () => apiClient.catalog.references() })
  const [branchId, setBranchId] = useState('')
  const [form, setForm] = useState<ScheduleForm>(empty)
  const [error, setError] = useState<unknown>(null)
  const selectedBranchId = branchId || references.data?.data.branches[0]?.publicId || ''
  const scheduling = useQuery({ queryKey: ['scheduling', selectedBranchId], queryFn: () => apiClient.scheduling.get(selectedBranchId), enabled: Boolean(selectedBranchId) })
  const schedulingData = scheduling.data?.data
  const selectedDoctorId = form.doctorPublicId || schedulingData?.doctors[0]?.publicId || ''
  const selectedRoomId = form.roomPublicId || schedulingData?.rooms[0]?.publicId || ''
  const create = useMutation({ mutationFn: (body: CreateWorkingScheduleRequest) => apiClient.scheduling.create(body),
    onSuccess: () => { setForm(empty); setError(null); void client.invalidateQueries({ queryKey: ['scheduling', selectedBranchId] }) },
    onError: setError })
  const submit = (event: React.FormEvent) => {
    event.preventDefault(); setError(null)
    if (Boolean(form.breakStart) !== Boolean(form.breakEnd)) {
      setError(new Error('Nhập đủ giờ bắt đầu và kết thúc khoảng nghỉ, hoặc để trống cả hai.')); return
    }
    if (form.breakStart && (form.breakStart >= form.breakEnd
      || form.breakStart < form.localStartTime || form.breakEnd > form.localEndTime)) {
      setError(new Error('Khoảng nghỉ phải nằm trong giờ ca và có giờ bắt đầu trước giờ kết thúc.')); return
    }
    const body: CreateWorkingScheduleRequest = { branchPublicId: selectedBranchId, doctorPublicId: selectedDoctorId,
      roomPublicId: selectedRoomId, weekdayIso: form.weekdayIso, localStartTime: form.localStartTime,
      localEndTime: form.localEndTime, slotDurationMinutes: form.slotDurationMinutes,
      effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo || null,
      bookingHorizonDays: form.bookingHorizonDays || null,
      breaks: form.breakStart && form.breakEnd ? [{ localStartTime: form.breakStart, localEndTime: form.breakEnd,
        breakName: form.breakName || null }] : [] }
    create.mutate(body)
  }
  if (references.isLoading) return <div className="page-state">Đang tải phạm vi lịch…</div>
  if (references.error) return <div className="page-state error-state">{message(references.error)}</div>
  const data = schedulingData
  return <>
    <header><div><span className="eyebrow">LỊCH LÀM VIỆC</span><h1>Ca làm việc & slot khám</h1>
      <p>Đề xuất ca cho bác sĩ xác nhận, sau đó công bố và sinh slot khám.</p></div></header>
    <section className="panel schedule-toolbar"><label>Chi nhánh<select value={selectedBranchId} onChange={(event) => {
      setBranchId(event.target.value); setForm(empty) }}>
      {references.data?.data.branches.map((branch) => <option value={branch.publicId} key={branch.publicId}>{branch.name}</option>)}
    </select></label></section>
    {scheduling.isLoading ? <div className="page-state">Đang tải ca làm việc…</div>
      : scheduling.error ? <div className="page-state error-state">{message(scheduling.error)}</div>
        : data && <div className="schedule-workspace">
          <form className="panel schedule-form" onSubmit={submit}><h2>Đề xuất ca làm việc</h2>
            <label>Bác sĩ<select required value={selectedDoctorId} onChange={(event) => {
              const doctor = data.doctors.find((item) => item.publicId === event.target.value)
              setForm({ ...form, doctorPublicId: event.target.value,
                slotDurationMinutes: doctor?.defaultSlotMinutes ?? form.slotDurationMinutes }) }}>
              <option value="">Chọn bác sĩ</option>{data.doctors.map((doctor) => <option value={doctor.publicId} key={doctor.publicId}>
                {doctor.fullName}{doctor.acceptsOnlineBooking ? ' · Online' : ''}</option>)}</select></label>
            <label>Phòng<select required value={selectedRoomId} onChange={(event) => setForm({ ...form, roomPublicId: event.target.value })}>
              <option value="">Chọn phòng</option>{data.rooms.map((room) => <option value={room.publicId} key={room.publicId}>{room.name}</option>)}</select></label>
            <div className="form-grid"><label>Thứ<select value={form.weekdayIso} onChange={(event) => setForm({ ...form, weekdayIso: Number(event.target.value) })}>
              {weekdays.slice(1).map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select></label>
              <label>Thời lượng slot<input type="number" min={5} max={480} value={form.slotDurationMinutes}
                onChange={(event) => setForm({ ...form, slotDurationMinutes: Number(event.target.value) })} /></label>
              <label>Bắt đầu<input type="time" required value={form.localStartTime} onChange={(event) => setForm({ ...form, localStartTime: event.target.value })} /></label>
              <label>Kết thúc<input type="time" required value={form.localEndTime} onChange={(event) => setForm({ ...form, localEndTime: event.target.value })} /></label>
              <label>Hiệu lực từ<input type="date" required value={form.effectiveFrom} onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })} /></label>
              <label>Hiệu lực đến<input type="date" value={form.effectiveTo ?? ''} onChange={(event) => setForm({ ...form, effectiveTo: event.target.value || null })} /></label>
              <label>Nghỉ từ<input type="time" value={form.breakStart} onChange={(event) => setForm({ ...form, breakStart: event.target.value })} /></label>
              <label>Nghỉ đến<input type="time" value={form.breakEnd} onChange={(event) => setForm({ ...form, breakEnd: event.target.value })} /></label>
              <label className="wide">Tên khoảng nghỉ<input maxLength={100} value={form.breakName} onChange={(event) => setForm({ ...form, breakName: event.target.value })} /></label>
            </div>
            {Boolean(error) && <div className="form-error" role="alert">{message(error)}</div>}
            <button disabled={create.isPending || !selectedDoctorId || !selectedRoomId} type="submit">
              {create.isPending ? 'Đang gửi…' : 'Gửi đề xuất'}</button>
          </form>
          <section className="schedule-list"><h2>Ca làm việc và đề xuất</h2>
            {data.schedules.length ? data.schedules.map((schedule) => <ScheduleCard key={schedule.publicId}
              schedule={schedule} branchId={selectedBranchId} />) : <div className="page-state panel">Chưa có ca làm việc tại chi nhánh.</div>}
          </section>
        </div>}
    {selectedBranchId && <TimeOffAdmin branchId={selectedBranchId} />}
  </>
}

function TimeOffAdmin({ branchId }: { branchId: string }) {
  const client = useQueryClient()
  const requests = useQuery({ queryKey: ['schedule-time-off', branchId],
    queryFn: () => apiClient.scheduling.timeOff(branchId) })
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({})
  const approve = useMutation({ mutationFn: (id: string) => apiClient.scheduling.approveTimeOff(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['schedule-time-off', branchId] }) })
  const reject = useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) =>
    apiClient.scheduling.rejectTimeOff(id, reason),
  onSuccess: () => void client.invalidateQueries({ queryKey: ['schedule-time-off', branchId] }) })
  const statusLabels = { PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt',
    REJECTED: 'Đã từ chối', CANCELLED: 'Bác sĩ đã hủy' } as const
  return <section className="schedule-list"><h2>Yêu cầu báo bận của bác sĩ</h2>
    {requests.isLoading ? <div className="page-state">Đang tải yêu cầu…</div>
      : requests.error ? <div className="page-state error-state">{message(requests.error)}</div>
        : requests.data?.data.length ? requests.data.data.map((item) => <article className="panel schedule-card" key={item.publicId}>
          <h3>{item.doctorName} · {item.serviceDate} · {item.localStartTime}–{item.localEndTime}</h3>
          <p>{item.reason}</p><strong>{statusLabels[item.status]}</strong>
          {item.decisionNote && <p>Phản hồi: {item.decisionNote}</p>}
          {item.status === 'PENDING' && <>
            {item.appointmentConflictCount > 0 && <p className="form-error">
              Có {item.appointmentConflictCount} lịch hẹn cần đổi hoặc hủy trước khi duyệt nghỉ.</p>}
            <button type="button" disabled={approve.isPending || item.appointmentConflictCount > 0}
              onClick={() => approve.mutate(item.publicId)}>Duyệt nghỉ</button>
            <label>Lý do từ chối<input maxLength={500} value={rejectionReasons[item.publicId] ?? ''}
              onChange={(event) => setRejectionReasons({ ...rejectionReasons, [item.publicId]: event.target.value })} /></label>
            <button type="button" disabled={reject.isPending || (rejectionReasons[item.publicId] ?? '').trim().length < 3}
              onClick={() => reject.mutate({ id: item.publicId, reason: rejectionReasons[item.publicId]!.trim() })}>
              Từ chối yêu cầu</button>
          </>}
        </article>) : <div className="page-state panel">Chưa có yêu cầu báo bận.</div>}
    {(approve.error || reject.error) && <div className="form-error" role="alert">{message(approve.error || reject.error)}</div>}
  </section>
}

function ScheduleCard({ schedule, branchId }: { schedule: SchedulingData['schedules'][number]; branchId: string }) {
  const client = useQueryClient(); const [fromDate, setFromDate] = useState(today()); const [toDate, setToDate] = useState(plusDays(30))
  const validRange = Boolean(fromDate && toDate && fromDate <= toDate)
  const generate = useMutation({ mutationFn: () => apiClient.scheduling.generateSlots(schedule.publicId, { fromDate, toDate }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['scheduling', branchId] }) })
  const publish = useMutation({ mutationFn: () => apiClient.scheduling.publish(schedule.publicId),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['scheduling', branchId] }) })
  const workflowLabel = { PROPOSED: 'Chờ bác sĩ xác nhận', DOCTOR_CONFIRMED: 'Bác sĩ đã xác nhận',
    REJECTED: 'Bác sĩ từ chối', PUBLISHED: 'Đã công bố' }[schedule.workflowStatus]
  return <article className="schedule-card"><div className="catalog-card-heading"><div><span className="status status-active">{weekdays[schedule.weekdayIso]}</span>
    <h3>{schedule.doctorName}</h3><p>{schedule.localStartTime}–{schedule.localEndTime} · {schedule.roomName} · {schedule.slotDurationMinutes} phút</p></div>
    <strong>{workflowLabel}</strong></div>
    <p>Hiệu lực {schedule.effectiveFrom}{schedule.effectiveTo ? ` → ${schedule.effectiveTo}` : ' trở đi'}</p>
    {schedule.decisionNote && <p>Lý do từ chối: {schedule.decisionNote}</p>}
    {schedule.breaks.map((item, index) => <small key={`${item.localStartTime}-${index}`}>Nghỉ {item.localStartTime}–{item.localEndTime} {item.breakName}</small>)}
    {schedule.workflowStatus === 'DOCTOR_CONFIRMED' && <button type="button" disabled={publish.isPending}
      onClick={() => publish.mutate()}>{publish.isPending ? 'Đang công bố…' : 'Công bố ca'}</button>}
    {publish.error && <div className="form-error">{message(publish.error)}</div>}
    {schedule.workflowStatus === 'PUBLISHED' && <div className="generate-row"><label>Từ<input type="date" max={toDate} value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label>Đến<input type="date" min={fromDate} value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      <button type="button" disabled={generate.isPending || !validRange} onClick={() => generate.mutate()}>{generate.isPending ? 'Đang sinh…' : 'Sinh slot'}</button></div>
    }
    {schedule.workflowStatus === 'PUBLISHED' && <p>{schedule.slotCount} slot đã tạo</p>}
    {generate.data && <div className="form-success">Đã tạo thêm {generate.data.data.createdCount} slot.</div>}
    {generate.error && <div className="form-error">{message(generate.error)}</div>}
  </article>
}
