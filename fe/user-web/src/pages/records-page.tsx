import { ApiClientError } from '@clinic/generated-api-client'
import type { PatientClinicalRecord } from '@clinic/generated-api-types'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, dateTime, dayMonth, errorMessage } from '../api'

function recordErrorMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403)
    return 'Quyền truy cập hồ sơ đã thay đổi. Hãy kiểm tra lại hồ sơ được ủy quyền.'
  if (error instanceof ApiClientError && error.status === 404)
    return 'Hồ sơ này chưa được công bố hoặc không còn khả dụng.'
  return errorMessage(error)
}

function Fact({ label, value }: { label: string; value?: string | null }) { return value ? <div className="fact"><span>{label}</span><strong>{value}</strong></div> : null }
function ResultValues({ value }: { value: unknown }) {
  if (value == null) return null
  if (Array.isArray(value)) return <ol className="result-values-list">{value.map((item, index) =>
    <li key={index}><ResultValues value={item} /></li>)}</ol>
  if (typeof value === 'object') return <dl className="result-values">{Object.entries(value).map(([key, item]) =>
    <div key={key}><dt>{key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')}</dt>
      <dd><ResultValues value={item} /></dd></div>)}</dl>
  return <span>{typeof value === 'boolean' ? value ? 'Có' : 'Không' : String(value)}</span>
}
function RecordDetail({ record }: { record: PatientClinicalRecord }) {
  return <article className="record-detail"><div className="record-hero"><span className="eyebrow light">HỒ SƠ ĐÃ KÝ VÀ CÔNG BỐ</span><h2>{record.primaryDiagnosis?.name ?? 'Kết quả lượt khám'}</h2><p>{dateTime(record.arrivedAtUtc)} · {record.branch.name}</p><p>{record.doctor.fullName} · {record.code}</p></div>
    <section className="panel"><h3>Nội dung khám</h3><Fact label="Lý do khám" value={record.chiefComplaint} /><Fact label="Bệnh sử" value={record.historyOfPresentIllness} /><Fact label="Khám thực thể" value={record.physicalExamination} /><Fact label="Nhận định" value={record.clinicalAssessment} /><Fact label="Kế hoạch điều trị" value={record.treatmentPlan} /><Fact label="Dặn dò" value={record.followUpInstructions} /><Fact label="Ngày tái khám" value={record.followUpDate} /></section>
    <section className="panel"><h3>Chẩn đoán</h3>{record.diagnoses.length ? record.diagnoses.map((item) => <div className="result-row" key={item.publicId}><strong>{item.isPrimary ? 'Chính · ' : ''}{item.code}</strong><p>{item.name}</p></div>) : <p className="muted">Chưa có chẩn đoán.</p>}</section>
    <section className="panel"><h3>Chỉ số sinh hiệu</h3>{record.vitalSigns.length ? record.vitalSigns.map((item) => <div className="result-row" key={item.publicId}><strong>{dateTime(item.measuredAtUtc)}</strong><p>Nhiệt độ {item.temperatureC ?? '—'} °C · Mạch {item.pulseBpm ?? '—'}</p><p>Huyết áp {item.systolicBpMmhg ?? '—'}/{item.diastolicBpMmhg ?? '—'} · SpO₂ {item.spo2Percent ?? '—'}%</p></div>) : <p className="muted">Không có chỉ số sinh hiệu.</p>}</section>
    <section className="panel"><h3>Dịch vụ và kết quả</h3>{record.services.length ? record.services.map((item) => <div className="result-row" key={item.publicId}><strong>{item.name}</strong>{item.result ? <>
      <p><span className="pill">{item.result.status === 'AMENDED' ? 'Đã cập nhật' : 'Đã hoàn tất'} · Lần cập nhật {item.result.version}</span></p>
      {item.result.summary && <p>{item.result.summary}</p>}{item.result.conclusion && <p><strong>Kết luận: </strong>{item.result.conclusion}</p>}
      {item.result.result != null && <ResultValues value={item.result.result} />}
      {!item.result.summary && !item.result.conclusion && item.result.result == null && <p>Kết quả đã hoàn tất.</p>}
      <small>Công bố {dateTime(item.result.releasedAtUtc)}</small></> : <p className="muted">Không có kết quả riêng.</p>}</div>) : <p className="muted">Không có dịch vụ.</p>}</section>
    {!!record.amendments.length && <section className="panel"><h3>Phụ lục sau ký</h3>{record.amendments.map((item) => <div className="result-row" key={item.publicId}><strong>#{item.number} · {item.reason}</strong><p>{item.content}</p><small>{dateTime(item.amendedAtUtc)}</small></div>)}</section>}
    <section className="panel integrity"><h3>Dấu vết toàn vẹn hồ sơ</h3><p>Hồ sơ được khóa lúc {dateTime(record.signature.signedAtUtc)} theo {record.signature.schemaVersion}.</p><p className={record.signature.isVerified ? 'success' : 'error'}>{record.signature.isVerified ? 'Nội dung hiện tại khớp dấu SHA-256 đã lưu.' : 'Cảnh báo: nội dung hiện tại không khớp dấu đã lưu.'}</p><code>{record.signature.sha256}</code></section>
  </article>
}
export function RecordsPage() {
  const [patientId, setPatientId] = useState(''); const [recordId, setRecordId] = useState('')
  const access = useQuery({ queryKey: ['user', 'profiles'], queryFn: async () => (await api.patientAccess.get()).data.links, staleTime: 30000 })
  useEffect(() => {
    if (!access.data) return
    if (!access.data.some((link) => link.patient.publicId === patientId)) {
      setPatientId(access.data[0]?.patient.publicId ?? '')
      setRecordId('')
    }
  }, [access.data, patientId])
  const history = useQuery({ queryKey: ['user', 'records', patientId], queryFn: async () => (await api.patientClinicalRecords.list(patientId)).data, enabled: !!patientId })
  const detail = useQuery({ queryKey: ['user', 'record', patientId, recordId], queryFn: async () => (await api.patientClinicalRecords.get(patientId, recordId)).data, enabled: !!patientId && !!recordId })
  return <main className="container page patient-page records-page"><div className="page-intro patient-intro"><div className="patient-intro-copy"><span className="eyebrow">HỒ SƠ SỨC KHỎE</span><h1>Lịch sử khám của bạn</h1><p>Chỉ hiển thị hồ sơ đã được bác sĩ ký và chủ động công bố.</p></div><div className="patient-intro-note"><span className="patient-note-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8m-8 4h5" /></svg></span><div><strong>Thông tin từ bác sĩ</strong><small>Kết quả và dặn dò trong mỗi lượt khám.</small></div></div></div>
    {access.isLoading ? <div className="state">Đang tải hồ sơ…</div> : access.isError ? <div className="error" role="alert">{recordErrorMessage(access.error)} <button className="inline-link" onClick={() => void access.refetch()}>Thử lại</button></div>
      : !access.data?.length ? <div className="empty-state"><strong>Chưa có hồ sơ được xác minh</strong><p>Liên kết hồ sơ của bạn hoặc người thân trước khi xem lịch sử khám.</p><Link className="button button-small" to="/profiles">Liên kết hồ sơ</Link></div>
        : <><div className="profile-tabs" role="group" aria-label="Chọn hồ sơ sức khỏe">{access.data.map((link) => <button key={link.publicId} aria-pressed={patientId === link.patient.publicId} className={patientId === link.patient.publicId ? 'active' : ''} onClick={() => { setPatientId(link.patient.publicId); setRecordId('') }}>{link.patient.fullName}<small>{link.patient.code}</small></button>)}</div>
          {recordId ? <><div className="section-heading compact"><button className="back-link" onClick={() => setRecordId('')}>← Quay lại lịch sử</button><button className="inline-link" disabled={detail.isFetching} onClick={() => void detail.refetch()}>{detail.isFetching ? 'Đang tải…' : 'Tải lại ↻'}</button></div>{detail.isLoading ? <div className="state">Đang tải kết quả…</div> : detail.isError ? <div className="error" role="alert">{recordErrorMessage(detail.error)} <button className="inline-link" onClick={() => void detail.refetch()}>Thử lại</button></div> : detail.data && <RecordDetail record={detail.data} />}</>
            : <section><div className="section-heading compact"><div><h2>Các lượt khám đã công bố</h2><span className="muted">{history.data?.length ?? 0} lượt khám</span></div><button className="inline-link" disabled={history.isFetching} onClick={() => void Promise.all([access.refetch(), history.refetch()])}>{history.isFetching ? 'Đang tải…' : 'Tải lại ↻'}</button></div>{history.isLoading ? <div className="state">Đang tải lịch sử khám…</div> : history.isError ? <div className="error" role="alert">{recordErrorMessage(history.error)} <button className="inline-link" onClick={() => void history.refetch()}>Thử lại</button></div> : history.data?.length ? <div className="record-list">{history.data.map((item) => { const date = dayMonth(item.arrivedAtUtc); return <button key={item.publicId} onClick={() => setRecordId(item.publicId)}><span className="date-tile"><strong>{date.day}</strong><small>THÁNG {date.month}</small></span><span><strong>{item.primaryDiagnosis?.name ?? item.chiefComplaint ?? 'Lượt khám đã hoàn tất'}</strong><small>{item.doctor.fullName} · {item.branch.name} · {item.code}</small><small>Công bố {dateTime(item.releasedAtUtc)}</small></span><span>↗</span></button> })}</div> : <div className="empty-state"><strong>Chưa có hồ sơ đã công bố</strong><p>Hồ sơ sẽ xuất hiện sau khi bác sĩ hoàn tất, ký và công bố.</p></div>}</section>}
        </>}
  </main>
}
