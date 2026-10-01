import { ApiClientError } from '@clinic/generated-api-client'
import type { PatientAccessData, PatientRelationship } from '@clinic/generated-api-types'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, errorMessage, localDate } from '../api'
import { MyEmergencyContactsEditor } from './my-emergency-contacts'

const relationships: Record<PatientRelationship, string> = { SELF: 'Bản thân', CHILD: 'Con', SPOUSE: 'Vợ/chồng', PARENT: 'Cha/mẹ', GUARDIAN: 'Giám hộ', OTHER: 'Khác' }
const status: Record<string, string> = { PENDING: 'Đang chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Đã từ chối', CANCELLED: 'Đã hủy', EXPIRED: 'Đã hết hạn' }
export function ProfilesPage() {
  const queries = useQueryClient(); const [data, setData] = useState<PatientAccessData | null>(null)
  const [branches, setBranches] = useState<{ publicId: string; name: string }[]>([])
  const [branchId, setBranchId] = useState(''); const [patientCode, setPatientCode] = useState(''); const [dateOfBirth, setDateOfBirth] = useState('')
  const [relationship, setRelationship] = useState<PatientRelationship>('SELF'); const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [emergencyPatientId, setEmergencyPatientId] = useState<string | null>(null)
  const retry = useRef<{ payload: string; key: string } | null>(null)
  const loadRequest = useRef(0)
  const load = async () => { const current = ++loadRequest.current; setLoading(true); setError('')
    try { const [access, refs] = await Promise.all([api.patientAccess.get(), api.patientAccess.references()])
      if (current !== loadRequest.current) return
      setData(access.data); setBranches(refs.data.branches)
      setBranchId((value) => refs.data.branches.some((item) => item.publicId === value)
        ? value : refs.data.branches[0]?.publicId ?? '')
      await queries.invalidateQueries({ queryKey: ['user', 'profiles'] })
    } catch (cause) { if (current === loadRequest.current) setError(errorMessage(cause)) }
    finally { if (current === loadRequest.current) setLoading(false) } }
  useEffect(() => { void load(); return () => { loadRequest.current++ } }, [])
  const submit = async (event: FormEvent) => { event.preventDefault()
    const parsed = new Date(`${dateOfBirth}T00:00:00.000Z`)
    if (!branchId || patientCode.trim().length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)
      || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== dateOfBirth || parsed >= new Date()) {
      setError('Chọn chi nhánh, nhập mã bệnh nhân và ngày sinh hợp lệ.'); return }
    if (relationship !== 'SELF' && note.trim().length < 3) { setError('Liên kết người thân cần ghi chú về giấy tờ xác minh.'); return }
    const body = { branchPublicId: branchId, patientCode: patientCode.trim().toUpperCase(), dateOfBirth, relationshipType: relationship,
      ...(note.trim() ? { requestNote: note.trim() } : {}) }
    const payload = JSON.stringify(body)
    if (!retry.current || retry.current.payload !== payload) retry.current = { payload, key: crypto.randomUUID() }
    setBusy(true); setError(''); setNotice('')
    try { await api.patientAccess.requestLink(body, retry.current.key); retry.current = null
      setPatientCode(''); setDateOfBirth(''); setNote(''); setNotice('Đã tiếp nhận yêu cầu. Phòng khám sẽ đối chiếu giấy tờ trước khi duyệt.')
      await load() }
    catch (cause) { if (cause instanceof ApiClientError && cause.code === 'IDEMPOTENCY_KEY_REUSED') retry.current = null; setError(errorMessage(cause)) }
    finally { setBusy(false) } }
  const cancel = async (id: string) => { setBusy(true); setError('')
    try { await api.patientAccess.cancelRequest(id); setNotice('Đã hủy yêu cầu.'); await load() }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) } }
  const revoke = async (id: string, name: string) => { if (!window.confirm(`Thu hồi quyền truy cập của ${name}?`)) return
    setBusy(true); setError(''); try { await api.patientAccess.revokeLink(id, { reason: 'Người dùng chủ động thu hồi trên web' }); setNotice('Đã thu hồi quyền truy cập.'); await load() }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) } }
  return <main className="container page patient-page profiles-page"><div className="page-intro patient-intro"><div className="patient-intro-copy"><span className="eyebrow">HỒ SƠ ĐƯỢC ỦY QUYỀN</span><h1>Hồ sơ của bạn và người thân</h1><p>Chỉ hồ sơ đã được xác minh mới có thể dùng để đặt lịch và xem kết quả đã công bố.</p><button className="inline-link" disabled={loading} onClick={() => void load()}>{loading ? 'Đang tải…' : 'Tải lại hồ sơ ↻'}</button></div><div className="patient-intro-note"><span className="patient-note-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z" /><path d="m8 12 3 3 5-5" /></svg></span><div><strong>Kết nối hồ sơ an toàn</strong><small>Quyền truy cập được xác minh bởi phòng khám.</small></div></div></div>
    {error && <div className="error" role="alert">{error}</div>}{notice && <div className="success" role="status">{notice}</div>}
    <div className="profile-layout"><div><section className="panel"><div className="panel-head"><h2>Đang có quyền truy cập</h2><Link className="inline-link" to="/booking">Đặt lịch ↗</Link></div>
      {loading ? <div className="state patient-form-loading">Đang tải hồ sơ…</div> : data?.links.length ? <div className="profile-list">{data.links.map((link) => <article className="profile-card" key={link.publicId}><span className="avatar large">{link.patient.fullName.charAt(0)}</span><div className="profile-card-content"><h3>{link.patient.fullName}</h3><p>{link.patient.code} · Ngày sinh {link.patient.dateOfBirth}</p><span className="pill">{relationships[link.relationshipType]}</span>{link.accessKind === 'DELEGATED' && <p>Người được cấp: {link.linkedUser.displayName}</p>}</div><div className="profile-card-actions">{link.accessKind === 'OWN' && link.relationshipType === 'SELF' && <button className="inline-link" onClick={() => setEmergencyPatientId(link.patient.publicId)}>Liên hệ khẩn cấp</button>}{link.canRevoke && <button className="inline-link danger-text" disabled={busy} onClick={() => void revoke(link.publicId, link.linkedUser.displayName)}>Thu hồi</button>}</div></article>)}</div> : <div className="empty-state"><strong>Chưa có hồ sơ đã xác minh.</strong><p>Gửi yêu cầu liên kết hồ sơ để bắt đầu quản lý sức khỏe.</p></div>}</section>
      {emergencyPatientId && data?.links.some((link) => link.accessKind === 'OWN' && link.relationshipType === 'SELF' && link.patient.publicId === emergencyPatientId) && <MyEmergencyContactsEditor key={emergencyPatientId} patientId={emergencyPatientId} patientName={data.links.find((link) => link.patient.publicId === emergencyPatientId)!.patient.fullName} onClose={() => setEmergencyPatientId(null)} />}
      <section className="panel profile-history"><h2>Lịch sử yêu cầu</h2>{loading && !data ? <div className="state patient-form-loading">Đang tải yêu cầu…</div> : data?.requests.length ? <div className="request-list">{data.requests.map((request) => <article key={request.publicId}><div><strong>{request.patientReference}</strong><span className={`pill request-status request-status-${request.status.toLowerCase()}`}>{status[request.status]}</span></div><p>{request.branch.name} · {relationships[request.relationshipType]}</p>{request.decisionReason && <p>Phản hồi: {request.decisionReason}</p>}{request.status === 'PENDING' && <button className="inline-link danger-text" disabled={busy} onClick={() => void cancel(request.publicId)}>Hủy yêu cầu</button>}</article>)}</div> : <div className="empty-state patient-empty-compact"><p>Chưa gửi yêu cầu nào.</p></div>}</section></div>
      <section className="panel link-form"><span className="eyebrow">LIÊN KẾT HỒ SƠ</span><h2>Hồ sơ có sẵn</h2><p>Nếu đã có hồ sơ tại phòng khám, hãy gửi yêu cầu để nhân viên đối chiếu giấy tờ.</p><form onSubmit={(event) => void submit(event)}><label>Chi nhánh đối chiếu<select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">Chọn chi nhánh</option>{branches.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}</select></label><label>Mã bệnh nhân<input value={patientCode} onChange={(event) => setPatientCode(event.target.value)} placeholder="Ví dụ: BN000123" autoComplete="off" /></label><label>Ngày sinh<input type="date" max={localDate()} value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></label><label>Quan hệ<select value={relationship} onChange={(event) => setRelationship(event.target.value as PatientRelationship)}>{Object.entries(relationships).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label>Ghi chú giấy tờ xác minh{relationship !== 'SELF' && <span className="field-required"> · Bắt buộc</span>}<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder={relationship === 'SELF' ? 'Thông tin bổ sung (nếu có)' : 'Ví dụ: Giấy khai sinh hoặc giấy ủy quyền'} /></label><button className="button full" disabled={busy || loading || !branches.length}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu liên kết →'}</button></form></section></div></main>
}
