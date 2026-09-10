import { ApiClientError } from '@clinic/generated-api-client'
import type { BranchReference, PatientLinkRequestStatus, StaffPatientLinkRequest } from '@clinic/generated-api-types'
import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../../shared/api/client'

const statusLabels: Record<PatientLinkRequestStatus, string> = {
  PENDING: 'Đang chờ', APPROVED: 'Đã duyệt', REJECTED: 'Đã từ chối',
  CANCELLED: 'Đã hủy', EXPIRED: 'Hết hạn',
}
const relationshipLabels = {
  SELF: 'Bản thân', CHILD: 'Con', SPOUSE: 'Vợ/chồng', PARENT: 'Cha/mẹ',
  GUARDIAN: 'Người giám hộ', OTHER: 'Khác',
} as const

function errorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Vui lòng thử lại.'
  if (error.code === 'PATIENT_LINK_VERSION_CONFLICT') return 'Yêu cầu đã được người khác xử lý. Danh sách đã được tải lại.'
  if (error.code === 'PATIENT_LINK_STATE_CONFLICT') return 'Yêu cầu không còn ở trạng thái chờ xử lý.'
  if (error.code === 'FORBIDDEN') return 'Bạn không có quyền duyệt liên kết tại chi nhánh này.'
  return error.message || 'Không thể xử lý yêu cầu.'
}

export function PatientLinksPage() {
  const [branches, setBranches] = useState<BranchReference[]>([])
  const [branchPublicId, setBranchPublicId] = useState('')
  const [status, setStatus] = useState<PatientLinkRequestStatus | ''>('PENDING')
  const [items, setItems] = useState<StaffPatientLinkRequest[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadRequests = useCallback(async (branchId: string, requestStatus: PatientLinkRequestStatus | '') => {
    if (!branchId) return
    setLoading(true)
    setError(null)
    try {
      const response = await apiClient.patientLinkAdmin.list({
        branchPublicId: branchId, ...(requestStatus ? { status: requestStatus } : {}), page: 1, pageSize: 50,
      })
      setItems(response.data)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void apiClient.patientLinkAdmin.references().then((response) => {
      if (!active) return
      setBranches(response.data.branches)
      const initialBranch = response.data.branches[0]?.publicId ?? ''
      setBranchPublicId(initialBranch)
      if (initialBranch) void loadRequests(initialBranch, 'PENDING')
      else setLoading(false)
    }).catch((cause: unknown) => {
      if (active) { setError(errorMessage(cause)); setLoading(false) }
    })
    return () => { active = false }
  }, [loadRequests])

  const decide = async (item: StaffPatientLinkRequest, decision: 'APPROVE' | 'REJECT') => {
    if (reason.trim().length < 3) {
      setError('Nhập căn cứ đã đối chiếu hoặc lý do từ chối (ít nhất 3 ký tự).')
      return
    }
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await apiClient.patientLinkAdmin.decide(item.publicId, { decision, reason: reason.trim() }, item.rowVersion)
      setSelectedId(null)
      setReason('')
      setSuccess(decision === 'APPROVE' ? 'Đã duyệt và kích hoạt quyền truy cập.' : 'Đã từ chối yêu cầu.')
      await loadRequests(branchPublicId, status)
    } catch (cause) {
      setError(errorMessage(cause))
      if (cause instanceof ApiClientError && ['PATIENT_LINK_VERSION_CONFLICT', 'PATIENT_LINK_STATE_CONFLICT'].includes(cause.code)) {
        await loadRequests(branchPublicId, status)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return <>
    <header><div>
      <span className="eyebrow">CỔNG BỆNH NHÂN</span>
      <h1>Duyệt liên kết hồ sơ</h1>
      <p>Đối chiếu giấy tờ ngoài hệ thống trước khi cấp quyền đặt lịch cho hồ sơ có sẵn.</p>
    </div></header>

    <section className="patient-link-toolbar panel">
      <label>Chi nhánh
        <select value={branchPublicId} onChange={(event) => {
          setBranchPublicId(event.target.value)
          void loadRequests(event.target.value, status)
        }}>
          {branches.map((branch) => <option key={branch.publicId} value={branch.publicId}>{branch.name}</option>)}
        </select>
      </label>
      <label>Trạng thái
        <select value={status} onChange={(event) => {
          const nextStatus = event.target.value as PatientLinkRequestStatus | ''
          setStatus(nextStatus)
          void loadRequests(branchPublicId, nextStatus)
        }}>
          <option value="">Tất cả</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button className="secondary" type="button" disabled={loading || !branchPublicId}
        onClick={() => void loadRequests(branchPublicId, status)}>Tải lại</button>
    </section>

    {error && <div className="form-error" role="alert">{error}</div>}
    {success && <div className="form-success" role="status">{success}</div>}
    {loading ? <div className="page-state">Đang tải yêu cầu liên kết…</div>
      : !branches.length ? <div className="page-state error-state">Không có chi nhánh được phép duyệt liên kết.</div>
        : !items.length ? <div className="page-state">Không có yêu cầu phù hợp bộ lọc.</div>
          : <section className="patient-link-list">
            {items.map((item) => <article className="patient-link-card" key={item.publicId}>
              <div className="detail-heading">
                <div><span className="status">{statusLabels[item.status]}</span>
                  <h2>{item.patient.fullName}</h2>
                  <p>{item.patient.code} · Sinh ngày {item.patient.dateOfBirth}</p>
                </div>
                <strong>{relationshipLabels[item.relationshipType]}</strong>
              </div>
              <dl className="patient-link-details">
                <div><dt>Người yêu cầu</dt><dd>{item.requester.displayName}</dd></div>
                <div><dt>Liên hệ</dt><dd>{item.requester.email ?? item.requester.phone ?? 'Không có'}</dd></div>
                <div><dt>Gửi lúc</dt><dd>{new Date(item.createdAtUtc).toLocaleString('vi-VN')}</dd></div>
                <div><dt>Hết hạn</dt><dd>{new Date(item.expiresAtUtc).toLocaleString('vi-VN')}</dd></div>
              </dl>
              {item.requestNote && <p className="request-note"><strong>Giấy tờ/ghi chú:</strong> {item.requestNote}</p>}
              {item.decisionReason && <p className="request-note"><strong>Kết quả:</strong> {item.decisionReason}</p>}
              {item.status === 'PENDING' && (selectedId === item.publicId
                ? <div className="decision-box">
                  <label>Căn cứ duyệt hoặc lý do từ chối
                    <textarea value={reason} maxLength={500} rows={3} autoFocus
                      onChange={(event) => setReason(event.target.value)} />
                  </label>
                  <div className="action-row">
                    <button type="button" disabled={submitting} onClick={() => void decide(item, 'APPROVE')}>Duyệt liên kết</button>
                    <button className="danger-button" type="button" disabled={submitting}
                      onClick={() => void decide(item, 'REJECT')}>Từ chối</button>
                    <button className="secondary" type="button" disabled={submitting}
                      onClick={() => { setSelectedId(null); setReason('') }}>Đóng</button>
                  </div>
                </div>
                : <button type="button" onClick={() => { setSelectedId(item.publicId); setReason('') }}>Xử lý yêu cầu</button>)}
            </article>)}
          </section>}
  </>
}
