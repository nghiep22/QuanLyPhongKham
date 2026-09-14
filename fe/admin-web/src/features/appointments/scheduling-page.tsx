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
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống.'
  if (error.code === 'SLOT_CONFLICT') return 'Ca làm việc chồng lịch bác sĩ hoặc phòng.'
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
    <header><div><span className="eyebrow">SCHEDULING</span><h1>Ca làm việc & slot khám</h1>
      <p>Tạo lịch lặp theo giờ địa phương; hệ thống chặn chồng bác sĩ/phòng và sinh slot idempotent.</p></div></header>
    <section className="panel schedule-toolbar"><label>Chi nhánh<select value={selectedBranchId} onChange={(event) => {
      setBranchId(event.target.value); setForm(empty) }}>
      {references.data?.data.branches.map((branch) => <option value={branch.publicId} key={branch.publicId}>{branch.name}</option>)}
    </select></label></section>
    {scheduling.isLoading ? <div className="page-state">Đang tải ca làm việc…</div>
      : scheduling.error ? <div className="page-state error-state">{message(scheduling.error)}</div>
        : data && <div className="schedule-workspace">
          <form className="panel schedule-form" onSubmit={submit}><h2>Tạo ca làm việc</h2>
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
              <label>Thời lượng slot<input type="number" min={5} max={240} value={form.slotDurationMinutes}
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
              {create.isPending ? 'Đang tạo…' : 'Tạo ca làm việc'}</button>
          </form>
          <section className="schedule-list"><h2>Ca đang cấu hình</h2>
            {data.schedules.length ? data.schedules.map((schedule) => <ScheduleCard key={schedule.publicId}
              schedule={schedule} branchId={selectedBranchId} />) : <div className="page-state panel">Chưa có ca làm việc tại chi nhánh.</div>}
          </section>
        </div>}
  </>
}

function ScheduleCard({ schedule, branchId }: { schedule: SchedulingData['schedules'][number]; branchId: string }) {
  const client = useQueryClient(); const [fromDate, setFromDate] = useState(today()); const [toDate, setToDate] = useState(plusDays(30))
  const generate = useMutation({ mutationFn: () => apiClient.scheduling.generateSlots(schedule.publicId, { fromDate, toDate }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['scheduling', branchId] }) })
  return <article className="schedule-card"><div className="catalog-card-heading"><div><span className="status status-active">{weekdays[schedule.weekdayIso]}</span>
    <h3>{schedule.doctorName}</h3><p>{schedule.localStartTime}–{schedule.localEndTime} · {schedule.roomName} · {schedule.slotDurationMinutes} phút</p></div>
    <strong>{schedule.slotCount} slot</strong></div>
    <p>Hiệu lực {schedule.effectiveFrom}{schedule.effectiveTo ? ` → ${schedule.effectiveTo}` : ' trở đi'}</p>
    {schedule.breaks.map((item, index) => <small key={`${item.localStartTime}-${index}`}>Nghỉ {item.localStartTime}–{item.localEndTime} {item.breakName}</small>)}
    <div className="generate-row"><label>Từ<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label>Đến<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      <button type="button" disabled={generate.isPending} onClick={() => generate.mutate()}>{generate.isPending ? 'Đang sinh…' : 'Sinh slot'}</button></div>
    {generate.data && <div className="form-success">Đã tạo thêm {generate.data.data.createdCount} slot.</div>}
    {generate.error && <div className="form-error">{message(generate.error)}</div>}
  </article>
}
