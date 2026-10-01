import { ApiClientError } from '@clinic/generated-api-client'
import type { PatientBranch, PatientDetail, PatientMergePreview, PatientSummary } from '@clinic/generated-api-types'
import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { apiClient } from '../../shared/api/client'

function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Vui lòng thử lại.'
  if (error.code === 'PATIENT_VERSION_CONFLICT') return 'Một hồ sơ đã thay đổi. Hãy xem trước lại trước khi gộp.'
  if (error.code === 'PATIENT_MERGE_IDENTITY_CONFLICT') return 'Ngày sinh, giới tính hoặc định danh không khớp; cần đối chiếu lại.'
  if (error.code === 'PATIENT_MERGE_BLOCKED') return 'Còn lịch, lượt khám, yêu cầu liên kết hoặc quyền truy cập xung đột.'
  if (error.status === 403) return 'Chỉ quản trị viên toàn cục được gộp hồ sơ.'
  return error.message
}

export function PatientMergePanel({ source, branches, onMerged }: {
  source: PatientDetail; branches: PatientBranch[];
  onMerged: (targetPatientId: string, targetBranchId: string) => void;
}) {
  const history = useQuery({ queryKey: ['patient-merge-history', source.publicId],
    queryFn: async () => (await apiClient.patients.mergeHistory(source.publicId)).data })
  const [targetBranchId, setTargetBranchId] = useState(source.branch.publicId)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<PatientSummary[]>([])
  const [preview, setPreview] = useState<PatientMergePreview | null>(null)
  const [reason, setReason] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const search = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setPreview(null); setAcknowledged(false)
    try { const response = await apiClient.patients.search({ branchPublicId: targetBranchId, query: query.trim() })
      setCandidates(response.data.filter((item) => item.publicId !== source.publicId)) }
    catch (cause) { setError(message(cause)) }
    finally { setBusy(false) }
  }
  const choose = async (targetPatientId: string) => {
    setBusy(true); setError(''); setPreview(null); setAcknowledged(false)
    try { const response = await apiClient.patients.previewMerge(source.publicId, { targetPatientId })
      setPreview(response.data) }
    catch (cause) { setError(message(cause)) }
    finally { setBusy(false) }
  }
  const merge = async () => {
    if (!preview || !acknowledged || reason.trim().length < 20 || !preview.identityCompatible ||
      preview.hasOpenWork || preview.hasInboundMerge || preview.hasLinkConflict || preview.hasContactConflict) return
    setBusy(true); setError('')
    try { const response = await apiClient.patients.merge(source.publicId,
      { targetPatientId: preview.targetPublicId, targetRowVersion: preview.targetRowVersion,
        reason: reason.trim() }, preview.sourceRowVersion)
      onMerged(response.data.targetPublicId, preview.targetBranchPublicId ?? targetBranchId) }
    catch (cause) { setError(message(cause)); setPreview(null); setAcknowledged(false) }
    finally { setBusy(false) }
  }
  return <section className="panel patient-form-panel">
    <h3>Gộp hồ sơ trùng</h3>
    <p>Chỉ quản trị viên toàn cục thực hiện. Hồ sơ đang mở là nguồn; chọn hồ sơ chuẩn để tiếp tục dùng.
      Lịch sử đã ký, đơn thuốc và hóa đơn giữ nguyên định danh gốc để bảo toàn dấu vết.</p>
    <form className="form-grid" onSubmit={(event) => void search(event)}>
      <label>Chi nhánh hồ sơ chuẩn<select value={targetBranchId} onChange={(event) => {
        setTargetBranchId(event.target.value); setCandidates([]); setPreview(null) }}>
        {branches.map((branch) => <option key={branch.publicId} value={branch.publicId}>{branch.name}</option>)}
      </select></label>
      <label>Mã, tên, điện thoại hoặc định danh<input minLength={2} maxLength={100} value={query}
        onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="submit" disabled={busy || query.trim().length < 2}>Tìm hồ sơ chuẩn</button>
    </form>
    {candidates.map((item) => <div className="patient-duplicate-warning" key={item.publicId}>
      <strong>{item.code} · {item.fullName}</strong> · {item.dateOfBirth} · {item.phone ?? 'Chưa có SĐT'}
      <button type="button" className="secondary" disabled={busy} onClick={() => void choose(item.publicId)}>Xem trước</button>
    </div>)}
    {preview && <div className="patient-duplicate-warning">
      <h4>{preview.sourceCode} → {preview.targetCode}</h4>
      <p>Nguồn: {preview.sourceName} · {preview.sourceDateOfBirth} · {preview.sourceGender} · {preview.sourceBranchName ?? 'Chưa gắn chi nhánh'}</p>
      <p>Chuẩn: {preview.targetName} · {preview.targetDateOfBirth} · {preview.targetGender} · {preview.targetBranchName ?? 'Chưa gắn chi nhánh'}</p>
      <p>Định danh cuối: {preview.sourceNationalIdLast4 ?? '—'} / {preview.targetNationalIdLast4 ?? '—'}</p>
      <p>Lịch nguồn: {preview.sourceAppointments}; lượt khám đã ký: {preview.sourceSignedEncounters};
        hóa đơn: {preview.sourceInvoices}; liên kết tài khoản: {preview.sourceActiveLinks}.</p>
      <p>Dị ứng: {preview.sourceActiveAllergies}; bệnh nền: {preview.sourceOpenConditions};
        liên hệ khẩn cấp: {preview.sourceActiveContacts}.</p>
      {!preview.identityCompatible && <div className="form-error">Ngày sinh, giới tính hoặc định danh không khớp.</div>}
      {preview.hasOpenWork && <div className="form-error">Nguồn còn lịch, lượt khám hoặc yêu cầu liên kết chưa kết thúc.</div>}
      {preview.hasInboundMerge && <div className="form-error">Đã có hồ sơ khác gộp vào nguồn. Hãy chọn hồ sơ chuẩn khác.</div>}
      {preview.hasLinkConflict && <div className="form-error">Liên kết tài khoản của hai hồ sơ xung đột. Cần xử lý trước khi gộp.</div>}
      {preview.hasContactConflict && <div className="form-error">Cả hai hồ sơ có liên hệ khẩn cấp. Cần chọn danh sách dùng tiếp trước khi gộp.</div>}
      <label>Lý do đã đối chiếu hồ sơ<textarea minLength={20} maxLength={500} value={reason}
        onChange={(event) => setReason(event.target.value)} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={acknowledged}
        onChange={(event) => setAcknowledged(event.target.checked)} />
        Tôi đã kiểm tra hai hồ sơ và hiểu rằng thao tác gộp được ghi audit.</label>
      <button type="button" disabled={busy || !acknowledged || reason.trim().length < 20 ||
        !preview.identityCompatible || preview.hasOpenWork || preview.hasInboundMerge || preview.hasLinkConflict ||
        preview.hasContactConflict}
        onClick={() => void merge()}>
        {busy ? 'Đang gộp…' : 'Gộp vào hồ sơ chuẩn'}</button>
    </div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <h4>Lịch sử gộp vào hồ sơ này</h4>
    {history.isLoading ? <p>Đang tải lịch sử…</p> : history.error ? <div className="form-error">{message(history.error)}</div>
      : history.data?.length ? <ul>{history.data.map((item) => <li key={item.sourcePublicId}>
        <strong>{item.sourceCode} · {item.sourceName}</strong> · {new Date(item.mergedAtUtc).toLocaleString('vi-VN')}
        <p>{item.reason} · {item.performedByName}</p>
      </li>)}</ul> : <p>Chưa có hồ sơ nào được gộp vào.</p>}
  </section>
}
