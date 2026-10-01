import { ApiClientError } from '@clinic/generated-api-client'
import type { DoctorWorkingSchedule } from '@clinic/generated-api-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '../../shared/api/client'

const weekdays = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật']
const labels = {
  PROPOSED: 'Chờ bạn xác nhận', DOCTOR_CONFIRMED: 'Đã xác nhận, chờ admin công bố',
  REJECTED: 'Đã từ chối', PUBLISHED: 'Đã công bố',
} as const
const timeOffLabels = { PENDING: 'Chờ admin duyệt', APPROVED: 'Đã duyệt',
  REJECTED: 'Đã từ chối', CANCELLED: 'Đã hủy' } as const

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message
  return 'Không thể kết nối hệ thống.'
}

function ScheduleDecision({ schedule }: { schedule: DoctorWorkingSchedule }) {
  const client = useQueryClient()
  const [reason, setReason] = useState('')
  const confirm = useMutation({ mutationFn: () => apiClient.scheduling.confirm(schedule.publicId),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['doctor-schedules'] }) })
  const reject = useMutation({ mutationFn: () => apiClient.scheduling.reject(schedule.publicId, reason.trim()),
    onSuccess: () => { setReason(''); void client.invalidateQueries({ queryKey: ['doctor-schedules'] }) } })
  const busy = confirm.isPending || reject.isPending

  return <article className="panel schedule-card">
    <div className="catalog-card-heading"><div>
      <span className="status status-active">{labels[schedule.workflowStatus]}</span>
      <h2>{weekdays[schedule.weekdayIso]} · {schedule.localStartTime}–{schedule.localEndTime}</h2>
      <p>{schedule.branchName} · {schedule.roomName} · {schedule.slotDurationMinutes} phút/lượt</p>
    </div></div>
    <p>Hiệu lực {schedule.effectiveFrom}{schedule.effectiveTo ? ` → ${schedule.effectiveTo}` : ' trở đi'}</p>
    {schedule.breaks.map((item, index) => <small key={`${item.localStartTime}-${index}`}>
      Nghỉ {item.localStartTime}–{item.localEndTime} {item.breakName}</small>)}
    {schedule.decisionNote && <p>Lý do đã gửi: {schedule.decisionNote}</p>}
    {schedule.workflowStatus === 'PROPOSED' && <div className="schedule-decision">
      <button type="button" disabled={busy} onClick={() => confirm.mutate()}>
        {confirm.isPending ? 'Đang xác nhận…' : 'Xác nhận ca'}</button>
      <label>Lý do nếu không thể nhận ca
        <input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}
          placeholder="Ví dụ: trùng lịch trực bệnh viện" /></label>
      <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => reject.mutate()}>
        {reject.isPending ? 'Đang gửi…' : 'Từ chối ca'}</button>
    </div>}
    {(confirm.error || reject.error) && <div className="form-error" role="alert">
      {errorMessage(confirm.error || reject.error)}</div>}
  </article>
}

export function DoctorSchedulesPage() {
  const schedules = useQuery({ queryKey: ['doctor-schedules'], queryFn: () => apiClient.scheduling.mine() })
  const timeOff = useQuery({ queryKey: ['doctor-time-off'], queryFn: () => apiClient.scheduling.timeOff() })
  const client = useQueryClient()
  const [branchId, setBranchId] = useState('')
  const [serviceDate, setServiceDate] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [endTime, setEndTime] = useState('12:00')
  const [reason, setReason] = useState('')
  const branches = Array.from(new Map(schedules.data?.data.map((item) =>
    [item.branchPublicId, item.branchName] as const) ?? []).entries())
  const selectedBranch = branchId || branches[0]?.[0] || ''
  const requestTimeOff = useMutation({ mutationFn: () => apiClient.scheduling.requestTimeOff({
    branchPublicId: selectedBranch, serviceDate, localStartTime: startTime, localEndTime: endTime, reason: reason.trim(),
  }), onSuccess: () => { setReason(''); void client.invalidateQueries({ queryKey: ['doctor-time-off'] }) } })
  const cancel = useMutation({ mutationFn: (id: string) => apiClient.scheduling.cancelTimeOff(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['doctor-time-off'] }) })
  return <>
    <header><div><span className="eyebrow">LỊCH BÁC SĨ</span><h1>Xác nhận ca khám</h1>
      <p>Xem đề xuất của phòng khám và báo lại nếu ca trùng lịch bệnh viện.</p></div></header>
    {schedules.isLoading ? <div className="page-state">Đang tải lịch…</div>
      : schedules.error ? <div className="page-state error-state">{errorMessage(schedules.error)}</div>
        : schedules.data?.data.length ? <section className="schedule-list">
          {schedules.data.data.map((schedule) => <ScheduleDecision key={schedule.publicId} schedule={schedule} />)}
        </section> : <div className="page-state panel">Chưa có ca làm việc nào được đề xuất.</div>}
    <section className="panel schedule-form"><h2>Báo bận do lịch bệnh viện thay đổi</h2>
      <p>Gửi yêu cầu cho admin. Lịch đã đặt cần được xử lý trước khi duyệt.</p>
      <form onSubmit={(event) => { event.preventDefault(); requestTimeOff.mutate() }}>
        <label>Chi nhánh<select value={selectedBranch} onChange={(event) => setBranchId(event.target.value)} required>
          {branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
        <div className="form-grid"><label>Ngày<input type="date" value={serviceDate} required
          onChange={(event) => setServiceDate(event.target.value)} /></label>
        <label>Bận từ<input type="time" value={startTime} required
          onChange={(event) => setStartTime(event.target.value)} /></label>
        <label>Đến<input type="time" value={endTime} required
          onChange={(event) => setEndTime(event.target.value)} /></label></div>
        <label>Lý do<input maxLength={500} value={reason} required minLength={3}
          onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: bệnh viện đổi lịch trực" /></label>
        <button type="submit" disabled={requestTimeOff.isPending || !selectedBranch || !serviceDate
          || startTime >= endTime || reason.trim().length < 3}>Gửi yêu cầu</button>
        {requestTimeOff.error && <div className="form-error" role="alert">{errorMessage(requestTimeOff.error)}</div>}
      </form>
    </section>
    <section className="schedule-list"><h2>Yêu cầu báo bận</h2>
      {timeOff.isLoading ? <div className="page-state">Đang tải yêu cầu…</div>
        : timeOff.error ? <div className="page-state error-state">{errorMessage(timeOff.error)}</div>
          : timeOff.data?.data.length ? timeOff.data.data.map((item) => <article className="panel schedule-card" key={item.publicId}>
            <h3>{item.serviceDate} · {item.localStartTime}–{item.localEndTime}</h3>
            <p>{item.branchName} · {item.reason}</p><strong>{timeOffLabels[item.status]}</strong>
            {item.decisionNote && <p>Phản hồi admin: {item.decisionNote}</p>}
            {item.status === 'PENDING' && <button type="button" disabled={cancel.isPending}
              onClick={() => cancel.mutate(item.publicId)}>Hủy yêu cầu</button>}
          </article>) : <div className="page-state panel">Chưa có yêu cầu báo bận.</div>}
      {cancel.error && <div className="form-error" role="alert">{errorMessage(cancel.error)}</div>}
    </section>
  </>
}
