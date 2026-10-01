import { ApiClientError } from '@clinic/generated-api-client'
import type { ClinicalEncounterDetail, ClinicalEncounterStatus, ClinicalNotesRequest, PatientAllergyRequest, PatientConditionRequest, ReceptionBranch } from '@clinic/generated-api-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api/client'
import { clinicalReportPrintDocument, openPrintDocument } from '../../shared/printing'
import { useAuth } from '../auth/auth-context'

const labels: Record<ClinicalEncounterStatus, string> = {
  WAITING: 'Đang chờ', IN_PROGRESS: 'Đang khám', COMPLETED: 'Đã hoàn tất',
  SIGNED: 'Đã ký', CANCELLED: 'Đã hủy',
}

function errorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Hãy thử lại.'
  if (error.status === 403) return 'Bạn không được phân công lượt khám này hoặc không có quyền tại chi nhánh.'
  if (error.code === 'CLINICAL_QUEUE_NOT_CALLED') return 'Quầy cần gọi số trước khi bắt đầu khám.'
  if (error.code === 'CLINICAL_QUEUE_BYPASS_REASON_REQUIRED') return 'Ngoại lệ cần lý do tối thiểu 10 ký tự.'
  if (error.code === 'CLINICAL_QUEUE_ORDER_CONFLICT') return 'Còn lượt ưu tiên hoặc FIFO đứng trước. Không thể bắt đầu ngoại lệ.'
  if (error.code === 'CLINICAL_VERSION_CONFLICT') return 'Nội dung khám đã đổi ở phiên khác. Đối chiếu bản mới trước khi lưu.'
  if (error.status === 409) return 'Trạng thái hồ sơ vừa thay đổi hoặc còn công việc chưa hoàn tất. Hãy tải lại.'
  return error.message
}

function utc(value: string | null) {
  return value ? new Date(value).toLocaleString('vi-VN') : '—'
}

type Action = (label: string, operation: () => Promise<unknown>) => Promise<boolean>

export function ClinicalPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [branchId, setBranchId] = useState('')
  const [encounterId, setEncounterId] = useState('')
  const [status, setStatus] = useState('WAITING,IN_PROGRESS,COMPLETED,SIGNED')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [notice, setNotice] = useState('')
  const branches = useQuery({ queryKey: ['clinical-branches'], queryFn: () => apiClient.clinical.branches() })
  const selectedBranchId = branchId || branches.data?.data[0]?.publicId || ''
  const encounters = useQuery({ queryKey: ['clinical-encounters', selectedBranchId, status],
    queryFn: () => apiClient.clinical.list(selectedBranchId, status), enabled: Boolean(selectedBranchId),
    refetchInterval: 20_000 })
  const detail = useQuery({ queryKey: ['clinical-encounter', encounterId],
    queryFn: () => apiClient.clinical.get(encounterId), enabled: Boolean(encounterId) })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['clinical-encounters', selectedBranchId] })
    if (encounterId) void queryClient.invalidateQueries({ queryKey: ['clinical-encounter', encounterId] })
  }
  const run: Action = async (label, operation) => {
    setBusy(label); setError(null); setNotice('')
    try {
      await operation(); refresh(); setNotice(`${label} thành công.`); return true
    } catch (cause) { setError(cause); return false }
    finally { setBusy('') }
  }

  if (branches.isLoading) return <div className="page-state">Đang tải phạm vi khám bệnh…</div>
  if (branches.error) return <div className="page-state error-state">{errorMessage(branches.error)}</div>
  if (!branches.data?.data.length) return <div className="page-state panel">
    Tài khoản chưa có chi nhánh lâm sàng được phân công. Liên hệ quản trị để kiểm tra hồ sơ bác sĩ và phân công chi nhánh.
  </div>

  return <>
    <header><div><span className="eyebrow">HỒ SƠ KHÁM BỆNH</span><h1>Khám bệnh</h1>
      <p>Lượt khám của bác sĩ phụ trách, từ số đã gọi đến hồ sơ ký.</p></div></header>
    <section className="panel clinical-toolbar">
      <label>Chi nhánh<select value={selectedBranchId} onChange={(event) => { setBranchId(event.target.value); setEncounterId('') }}>
        {branches.data.data.map((branch) => <option key={branch.publicId} value={branch.publicId}>{branch.name}</option>)}</select></label>
      <label>Trạng thái<select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="WAITING,IN_PROGRESS,COMPLETED,SIGNED">Đang chờ, đang khám và đã hoàn tất</option>
        <option value="WAITING">Đang chờ</option><option value="IN_PROGRESS">Đang khám</option>
        <option value="COMPLETED">Chờ ký</option><option value="SIGNED">Đã ký</option>
      </select></label>
      <button type="button" className="secondary" onClick={refresh}>Tải lại</button>
    </section>
    {notice && <div className="form-success" role="status">{notice}</div>}
    {Boolean(error) && <div className="form-error" role="alert">{errorMessage(error)}</div>}
    <div className="clinical-workspace">
      <section className="panel clinical-list"><h2>Lượt khám của tôi</h2>
        {encounters.isLoading ? <p>Đang tải lượt khám…</p> : encounters.error
          ? <div className="form-error">{errorMessage(encounters.error)}</div>
          : encounters.data?.data.length ? encounters.data.data.map((item) => <button type="button"
              key={item.publicId} className={`clinical-list-item ${encounterId === item.publicId ? 'selected' : ''}`}
              onClick={() => setEncounterId(item.publicId)}>
              <span className={`status status-${item.status.toLowerCase()}`}>{labels[item.status]}</span>
              <strong>{item.patient.fullName}</strong><small>{item.patient.code} · {item.code}</small>
              <small>{item.queue?.displayNumber ?? 'Chưa cấp số'} · {utc(item.arrivedAtUtc)}</small>
            </button>) : <p className="empty-column">Không có lượt khám trong trạng thái đã chọn.</p>}
      </section>
      <div className="clinical-detail">
        {!encounterId ? <section className="panel page-state">Chọn một lượt khám để mở hồ sơ.</section>
          : detail.isLoading ? <section className="panel page-state">Đang tải hồ sơ khám…</section>
            : detail.error ? <section className="panel error-state page-state">{errorMessage(detail.error)}</section>
              : detail.data && <EncounterEditor key={detail.data.data.publicId} item={detail.data.data} busy={busy} run={run}
                  branch={branches.data.data.find((branch) => branch.publicId === selectedBranchId) ?? branches.data.data[0]}
                  printedBy={user?.displayName ?? null}
                  canBypassQueue={Boolean(user?.permissions.includes('ENCOUNTERS_QUEUE_BYPASS'))} />}
      </div>
    </div>
  </>
}

function PatientSafetyProfile({ patientId, branchId, busy, run }: {
  patientId: string; branchId: string; busy: string; run: Action;
}) {
  const client = useQueryClient()
  const key = ['patient-clinical-summary', branchId, patientId]
  const profile = useQuery({ queryKey: key,
    queryFn: () => apiClient.patients.clinicalSummary(patientId, branchId).then((result) => result.data),
    retry: false })
  const [allergenName, setAllergenName] = useState('')
  const [allergyType, setAllergyType] = useState<PatientAllergyRequest['type']>('DRUG')
  const [severity, setSeverity] = useState<PatientAllergyRequest['severity']>('UNKNOWN')
  const [reaction, setReaction] = useState('')
  const [notedAt, setNotedAt] = useState('')
  const [conditionName, setConditionName] = useState('')
  const [conditionCode, setConditionCode] = useState('')
  const [conditionStatus, setConditionStatus] = useState<PatientConditionRequest['status']>('ACTIVE')
  const [diagnosedDate, setDiagnosedDate] = useState('')
  const [conditionNotes, setConditionNotes] = useState('')
  const [reasonError, setReasonError] = useState('')
  const addAllergy = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Ghi dị ứng', () => apiClient.patients.addAllergy(patientId, branchId, {
      allergenName: allergenName.trim(), type: allergyType, severity,
      reaction: reaction.trim() || null, notedAt: notedAt || null,
    }))) {
      setAllergenName(''); setReaction(''); setNotedAt('')
      void client.invalidateQueries({ queryKey: key })
    }
  }
  const addCondition = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Ghi bệnh nền', () => apiClient.patients.addCondition(patientId, branchId, {
      code: conditionCode.trim() || null, name: conditionName.trim(), status: conditionStatus,
      diagnosedDate: diagnosedDate || null, notes: conditionNotes.trim() || null,
    }))) {
      setConditionName(''); setConditionCode(''); setDiagnosedDate(''); setConditionNotes('')
      void client.invalidateQueries({ queryKey: key })
    }
  }
  const closeRecord = async (kind: 'allergy' | 'condition', id: string) => {
    const reason = window.prompt(kind === 'allergy'
      ? 'Lý do ngừng hiệu lực dị ứng (tối thiểu 10 ký tự):'
      : 'Lý do đánh dấu bệnh nền đã giải quyết (tối thiểu 10 ký tự):')
    if (reason == null) return
    if (reason.trim().length < 10) { setReasonError('Cần nhập lý do tối thiểu 10 ký tự.'); return }
    setReasonError('')
    const action = kind === 'allergy'
      ? () => apiClient.patients.deactivateAllergy(patientId, branchId, id, reason.trim())
      : () => apiClient.patients.resolveCondition(patientId, branchId, id, reason.trim())
    if (await run(kind === 'allergy' ? 'Ngừng hiệu lực dị ứng' : 'Giải quyết bệnh nền', action))
      void client.invalidateQueries({ queryKey: key })
  }
  return <section className="panel"><h2>Dị ứng và bệnh nền</h2>
    <p>Chỉ nhân viên đang trực tiếp chăm sóc người bệnh mới xem và ghi thông tin này.</p>
    {profile.isLoading && <p>Đang tải thông tin sức khỏe…</p>}
    {profile.error && <div className="form-error" role="alert">{errorMessage(profile.error)}
      {' '}<button type="button" className="secondary" onClick={() => void profile.refetch()}>Thử lại</button></div>}
    {reasonError && <div className="form-error" role="alert">{reasonError}</div>}
    {profile.data && <>
      <h3>Dị ứng đang hiệu lực</h3>
      {!profile.data.allergies.length && <p>Chưa ghi nhận dị ứng.</p>}
      {profile.data.allergies.map((allergy) => <p className="clinical-record" key={allergy.publicId}>
        <strong>{allergy.allergenName}</strong> · {allergy.type} · {allergy.severity}
        {allergy.reaction && <> · {allergy.reaction}</>}
        {' '}<button type="button" className="secondary" disabled={Boolean(busy)}
          onClick={() => void closeRecord('allergy', allergy.publicId)}>Ngừng hiệu lực</button>
      </p>)}
      <form className="clinical-form-grid" onSubmit={(event) => void addAllergy(event)}>
        <label>Dị nguyên<input required minLength={2} maxLength={200} value={allergenName}
          onChange={(event) => setAllergenName(event.target.value)} /></label>
        <label>Loại<select value={allergyType} onChange={(event) => setAllergyType(event.target.value as PatientAllergyRequest['type'])}>
          <option value="DRUG">Thuốc</option><option value="FOOD">Thức ăn</option>
          <option value="ENVIRONMENT">Môi trường</option><option value="OTHER">Khác</option></select></label>
        <label>Mức độ<select value={severity} onChange={(event) => setSeverity(event.target.value as PatientAllergyRequest['severity'])}>
          <option value="UNKNOWN">Chưa rõ</option><option value="MILD">Nhẹ</option>
          <option value="MODERATE">Vừa</option><option value="SEVERE">Nặng</option></select></label>
        <label>Phản ứng<input maxLength={500} value={reaction} onChange={(event) => setReaction(event.target.value)} /></label>
        <label>Ngày ghi nhận<input type="date" value={notedAt} onChange={(event) => setNotedAt(event.target.value)} /></label>
        <button type="submit" disabled={Boolean(busy)}>Ghi dị ứng</button>
      </form>
      <h3>Bệnh nền đang theo dõi</h3>
      {!profile.data.conditions.length && <p>Chưa ghi nhận bệnh nền.</p>}
      {profile.data.conditions.map((condition) => <p className="clinical-record" key={condition.publicId}>
        <strong>{condition.name}</strong> · {condition.status}
        {condition.notes && <> · {condition.notes}</>}
        {' '}<button type="button" className="secondary" disabled={Boolean(busy)}
          onClick={() => void closeRecord('condition', condition.publicId)}>Đã giải quyết</button>
      </p>)}
      <form className="clinical-form-grid" onSubmit={(event) => void addCondition(event)}>
        <label>Tên bệnh nền<input required minLength={2} maxLength={200} value={conditionName}
          onChange={(event) => setConditionName(event.target.value)} /></label>
        <label>Mã bệnh<input maxLength={30} value={conditionCode} onChange={(event) => setConditionCode(event.target.value)} /></label>
        <label>Trạng thái<select value={conditionStatus}
          onChange={(event) => setConditionStatus(event.target.value as PatientConditionRequest['status'])}>
          <option value="ACTIVE">Đang mắc</option><option value="CONTROLLED">Đã kiểm soát</option></select></label>
        <label>Ngày chẩn đoán<input type="date" value={diagnosedDate}
          onChange={(event) => setDiagnosedDate(event.target.value)} /></label>
        <label>Ghi chú<input maxLength={1000} value={conditionNotes}
          onChange={(event) => setConditionNotes(event.target.value)} /></label>
        <button type="submit" disabled={Boolean(busy)}>Ghi bệnh nền</button>
      </form>
    </>}
  </section>
}

function EncounterEditor({ item, branch, printedBy, busy, run, canBypassQueue }: {
  item: ClinicalEncounterDetail; branch: ReceptionBranch; printedBy: string | null;
  busy: string; run: Action; canBypassQueue: boolean
}) {
  const queryClient = useQueryClient()
  const open = item.status === 'IN_PROGRESS'
  const serverNotes: ClinicalNotesRequest = useMemo(() => ({
    historyOfPresentIllness: item.historyOfPresentIllness ?? '',
    physicalExamination: item.physicalExamination ?? '', clinicalAssessment: item.clinicalAssessment ?? '',
    treatmentPlan: item.treatmentPlan ?? '', followUpInstructions: item.followUpInstructions ?? '',
    followUpDate: item.followUpDate ?? null,
  }), [item.historyOfPresentIllness, item.physicalExamination, item.clinicalAssessment,
    item.treatmentPlan, item.followUpInstructions, item.followUpDate])
  const [notesDraft, setNotesDraft] = useState({ notes: serverNotes, originalNotes: serverNotes,
    notesVersion: item.rowVersion, lastSeenVersion: item.rowVersion, notesConflict: false })
  if (item.rowVersion !== notesDraft.lastSeenVersion) {
    const dirty = JSON.stringify(notesDraft.notes) !== JSON.stringify(notesDraft.originalNotes)
    setNotesDraft(dirty && JSON.stringify(serverNotes) !== JSON.stringify(notesDraft.originalNotes)
      ? { ...notesDraft, lastSeenVersion: item.rowVersion, notesConflict: true }
      : { notes: dirty ? notesDraft.notes : serverNotes, originalNotes: serverNotes,
        notesVersion: item.rowVersion, lastSeenVersion: item.rowVersion, notesConflict: false })
  }
  const { notes, originalNotes, notesVersion, notesConflict } = notesDraft
  const notesDirty = JSON.stringify(notes) !== JSON.stringify(originalNotes)
  const [temperature, setTemperature] = useState(''); const [pulse, setPulse] = useState('')
  const [systolic, setSystolic] = useState(''); const [diastolic, setDiastolic] = useState('')
  const [spo2, setSpo2] = useState(''); const [height, setHeight] = useState(''); const [weight, setWeight] = useState('')
  const [diagnosisCode, setDiagnosisCode] = useState(''); const [diagnosisName, setDiagnosisName] = useState('')
  const [diagnosisType, setDiagnosisType] = useState<'PROVISIONAL' | 'DIFFERENTIAL' | 'FINAL'>('FINAL')
  const [isPrimary, setIsPrimary] = useState(false)
  const [serviceId, setServiceId] = useState(''); const [quantity, setQuantity] = useState('1')
  const [amendReason, setAmendReason] = useState(''); const [amendContent, setAmendContent] = useState('')
  const saveNotes = async (event: FormEvent) => {
    event.preventDefault()
    if (!notesDirty || notesConflict) return
    let saved: ClinicalEncounterDetail | null = null
    if (await run('Lưu nội dung khám', async () => {
      saved = (await apiClient.clinical.updateNotes(item.publicId, notes, notesVersion)).data
    })) {
      setNotesDraft((current) => ({ ...current, originalNotes: notes,
        notesVersion: (saved as ClinicalEncounterDetail | null)?.rowVersion ?? notesVersion, notesConflict: false }))
    } else await queryClient.invalidateQueries({ queryKey: ['clinical-encounter', item.publicId] })
  }
  const addVitals = async (event: FormEvent) => {
    event.preventDefault()
    const values = { temperatureC: temperature ? Number(temperature) : undefined, pulseBpm: pulse ? Number(pulse) : undefined,
      systolicBpMmhg: systolic ? Number(systolic) : undefined, diastolicBpMmhg: diastolic ? Number(diastolic) : undefined,
      spo2Percent: spo2 ? Number(spo2) : undefined, heightCm: height ? Number(height) : undefined,
      weightKg: weight ? Number(weight) : undefined }
    if (await run('Ghi sinh hiệu', () => apiClient.clinical.addVitalSigns(item.publicId, values))) {
      setTemperature(''); setPulse(''); setSystolic(''); setDiastolic(''); setSpo2(''); setHeight(''); setWeight('')
    }
  }
  const addDiagnosis = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Ghi chẩn đoán', () => apiClient.clinical.addDiagnosis(item.publicId, {
      code: diagnosisCode.trim(), name: diagnosisName.trim(), type: diagnosisType, isPrimary,
    }))) { setDiagnosisCode(''); setDiagnosisName(''); setIsPrimary(false) }
  }
  const orderService = async (event: FormEvent) => {
    event.preventDefault(); if (!serviceId) return
    if (await run('Chỉ định dịch vụ', () => apiClient.clinical.orderService(item.publicId, {
      servicePublicId: serviceId, quantity: Number(quantity),
    }))) { setServiceId(''); setQuantity('1') }
  }
  const amend = async (event: FormEvent) => {
    event.preventDefault()
    if (await run('Thêm phụ lục', () => apiClient.clinical.amend(item.publicId, {
      reason: amendReason.trim(), content: amendContent.trim(),
    }))) { setAmendReason(''); setAmendContent('') }
  }
  const bypassQueueCall = () => {
    const reason = window.prompt('Lý do bắt đầu khi chưa gọi số (tối thiểu 10 ký tự):')
    if (reason == null) return
    void run('Bắt đầu lượt khám theo ngoại lệ', () => apiClient.clinical.start(item.publicId, {
      queueBypassReason: reason.trim(),
    }))
  }
  const setNote = (field: keyof ClinicalNotesRequest, value: string | null) =>
    setNotesDraft((current) => ({ ...current, notes: { ...current.notes, [field]: value } }))

  return <>
    <section className="panel"><div className="detail-heading"><div><span className={`status status-${item.status.toLowerCase()}`}>
      {labels[item.status]}</span><h2>{item.patient.fullName}</h2><p>{item.patient.code} · {item.code}</p></div>
      <div className="clinical-actions">{open && <Link to={`/pharmacy?encounterId=${encodeURIComponent(item.publicId)}`}>
        Kê đơn thuốc</Link>}{item.status === 'WAITING' && item.queue?.status === 'CALLED' && <button type="button" disabled={Boolean(busy)}
        onClick={() => void run('Bắt đầu lượt khám', () => apiClient.clinical.start(item.publicId))}>Bắt đầu khám</button>}
        {item.status === 'WAITING' && item.queue?.status === 'WAITING' && canBypassQueue && <button type="button"
          className="secondary" disabled={Boolean(busy)} onClick={bypassQueueCall}>Bắt đầu ngoại lệ</button>}
        {open && <button type="button" disabled={Boolean(busy)}
          onClick={() => void run('Hoàn tất lượt khám', () => apiClient.clinical.complete(item.publicId))}>Hoàn tất</button>}
        {item.status === 'COMPLETED' && <button type="button" disabled={Boolean(busy)}
          onClick={() => void run('Ký hồ sơ', () => apiClient.clinical.sign(item.publicId))}>Ký hồ sơ</button>}
        {item.status === 'SIGNED' && !item.patientRelease && <button type="button" disabled={Boolean(busy)}
          onClick={() => void run('Công bố cho bệnh nhân', () => apiClient.clinical.releaseToPatient(item.publicId))}>
          Công bố cho bệnh nhân</button>}
        {item.status === 'COMPLETED' && <button type="button" className="secondary"
          onClick={() => openPrintDocument(clinicalReportPrintDocument(branch, item, printedBy))}>In bản chờ ký</button>}
        {item.status === 'SIGNED' && <button type="button" className="secondary"
          disabled={!item.signature?.isVerified} title={!item.signature?.isVerified ? 'Không thể in bản chính thức khi dấu ký không hợp lệ.' : undefined}
          onClick={() => openPrintDocument(clinicalReportPrintDocument(branch, item, printedBy))}>In kết quả khám</button>}</div></div>
      <div className="clinical-facts"><span><b>Số:</b> {item.queue?.displayNumber ?? '—'} ({item.queue?.status ?? '—'})</span>
        <span><b>Bác sĩ:</b> {item.doctor.fullName}</span><span><b>Phòng:</b> {item.room?.name ?? 'Chưa xếp'}</span>
        <span><b>Đến lúc:</b> {utc(item.arrivedAtUtc)}</span><span><b>Lý do:</b> {item.chiefComplaint ?? 'Chưa ghi'}</span></div>
      {item.status === 'WAITING' && item.queue?.status === 'WAITING' && <p className="appointment-warning">
        {canBypassQueue ? 'Ngoại lệ chỉ bỏ qua bước gọi số cho lượt đang đứng đầu theo ưu tiên/FIFO và phải ghi lý do.'
          : 'Quầy cần gọi số trước khi bác sĩ bắt đầu khám.'}</p>}
      {item.signature && <div className={`clinical-signature ${item.signature.isVerified ? '' : 'clinical-signature-failed'}`}>
        <strong>{item.signature.isVerified ? 'Toàn vẹn đã xác minh' : 'Cảnh báo: hồ sơ không khớp dấu đã ký'} · {utc(item.signature.signedAtUtc)}</strong>
        <span>{item.signature.schemaVersion}</span>
        <code>{item.signature.sha256}</code></div>}
      {item.patientRelease && <p className="form-success">Đã công bố cho bệnh nhân lúc {utc(item.patientRelease.releasedAtUtc)}
        {' '}bởi {item.patientRelease.releasedBy}.</p>}
    </section>
    {(item.status === 'WAITING' || item.status === 'IN_PROGRESS') &&
      <PatientSafetyProfile patientId={item.patient.publicId} branchId={branch.publicId} busy={busy} run={run} />}
    <section className="panel"><h2>Sinh hiệu</h2>
      {item.vitalSigns.map((vital) => <p className="clinical-record" key={vital.publicId}>
        {utc(vital.measuredAtUtc)} · {vital.measuredBy}: {vital.temperatureC ?? '—'} °C,
        mạch {vital.pulseBpm ?? '—'}, huyết áp {vital.systolicBpMmhg ?? '—'}/{vital.diastolicBpMmhg ?? '—'},
        SpO₂ {vital.spo2Percent ?? '—'}%, BMI {vital.bmi ?? '—'}
      </p>)}
      {!item.vitalSigns.length && <p>Chưa có lần đo sinh hiệu.</p>}
      {(open || item.status === 'WAITING') && <form className="clinical-form-grid" onSubmit={(event) => void addVitals(event)}>
        <label>Nhiệt độ (°C)<input type="number" step="0.1" min="25" max="45" value={temperature} onChange={(event) => setTemperature(event.target.value)} /></label>
        <label>Mạch (lần/phút)<input type="number" min="10" max="300" value={pulse} onChange={(event) => setPulse(event.target.value)} /></label>
        <label>Huyết áp tâm thu<input type="number" min="30" max="300" value={systolic} onChange={(event) => setSystolic(event.target.value)} /></label>
        <label>Huyết áp tâm trương<input type="number" min="20" max="200" value={diastolic} onChange={(event) => setDiastolic(event.target.value)} /></label>
        <label>SpO₂ (%)<input type="number" step="0.01" min="0" max="100" value={spo2} onChange={(event) => setSpo2(event.target.value)} /></label>
        <label>Chiều cao (cm)<input type="number" step="0.01" min="20" max="300" value={height} onChange={(event) => setHeight(event.target.value)} /></label>
        <label>Cân nặng (kg)<input type="number" step="0.01" min="0.2" max="500" value={weight} onChange={(event) => setWeight(event.target.value)} /></label>
        <button type="submit" disabled={Boolean(busy) || ![temperature, pulse, systolic, diastolic, spo2, height, weight].some(Boolean)}>
          Ghi lần đo</button></form>}
    </section>
    <section className="panel"><h2>Nội dung khám</h2>
      {notesConflict && <div className="form-error" role="alert"><p>Nội dung trên máy chủ đã thay đổi. Bản bạn đang nhập vẫn được giữ để đối chiếu.</p>
        <dl>{([
          ['historyOfPresentIllness', 'Bệnh sử'], ['physicalExamination', 'Khám thực thể'],
          ['clinicalAssessment', 'Nhận định'], ['treatmentPlan', 'Kế hoạch điều trị'],
          ['followUpInstructions', 'Dặn dò tái khám'], ['followUpDate', 'Ngày tái khám'],
        ] as const).map(([field, label]) => <div key={field}><dt>{label} trên máy chủ</dt>
          <dd>{serverNotes[field] || '—'}</dd></div>)}</dl>
        <button type="button" className="secondary" onClick={() => {
          setNotesDraft({ notes: serverNotes, originalNotes: serverNotes, notesVersion: item.rowVersion,
            lastSeenVersion: item.rowVersion, notesConflict: false })
        }}>Dùng bản trên máy chủ</button></div>}
      <form className="clinical-notes" onSubmit={(event) => void saveNotes(event)}>
        {([
          ['historyOfPresentIllness', 'Bệnh sử'], ['physicalExamination', 'Khám thực thể'],
          ['clinicalAssessment', 'Nhận định'], ['treatmentPlan', 'Kế hoạch điều trị'],
          ['followUpInstructions', 'Dặn dò tái khám'],
        ] as const).map(([field, label]) => <label key={field}>{label}<textarea maxLength={10000} rows={3}
          disabled={!open} value={notes[field] ?? ''} onChange={(event) => setNote(field, event.target.value)} /></label>)}
        <label>Ngày tái khám<input type="date" disabled={!open} value={notes.followUpDate ?? ''}
          onChange={(event) => setNote('followUpDate', event.target.value || null)} /></label>
        {open && <button type="submit" disabled={Boolean(busy) || !notesDirty || notesConflict}>Lưu nội dung khám</button>}
      </form></section>
    <section className="panel"><h2>Chẩn đoán</h2>
      {item.diagnoses.map((diagnosis) => <p className="clinical-record" key={diagnosis.publicId}>
        <strong>{diagnosis.isPrimary ? 'Chính · ' : ''}{diagnosis.code}</strong> — {diagnosis.name} ({diagnosis.type})</p>)}
      {!item.diagnoses.length && <p>Chưa có chẩn đoán.</p>}
      {open && <form className="clinical-form-grid" onSubmit={(event) => void addDiagnosis(event)}>
        <label>Mã chẩn đoán<input required maxLength={30} value={diagnosisCode} onChange={(event) => setDiagnosisCode(event.target.value)} /></label>
        <label>Tên chẩn đoán<input required minLength={2} maxLength={500} value={diagnosisName} onChange={(event) => setDiagnosisName(event.target.value)} /></label>
        <label>Loại<select value={diagnosisType} onChange={(event) => setDiagnosisType(event.target.value as typeof diagnosisType)}>
          <option value="PROVISIONAL">Sơ bộ</option><option value="DIFFERENTIAL">Phân biệt</option><option value="FINAL">Cuối cùng</option>
        </select></label><label className="checkbox"><input type="checkbox" checked={isPrimary}
          disabled={item.diagnoses.some((diagnosis) => diagnosis.isPrimary)} onChange={(event) => setIsPrimary(event.target.checked)} />
          Chẩn đoán chính</label><button type="submit" disabled={Boolean(busy)}>Ghi chẩn đoán</button></form>}
    </section>
    <section className="panel"><h2>Chỉ định & kết quả</h2>
      {item.services.map((service) => <ServiceRow key={service.publicId} service={service} open={open} busy={busy} run={run} />)}
      {!item.services.length && <p>Chưa có dịch vụ.</p>}
      {open && <form className="clinical-form-grid" onSubmit={(event) => void orderService(event)}>
        <label>Dịch vụ<select required value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
          <option value="">Chọn dịch vụ</option>{item.availableServices.map((service) => <option key={service.publicId} value={service.publicId}>
            {service.name} · {Number(service.priceAmount).toLocaleString('vi-VN')} ₫</option>)}</select></label>
        <label>Số lượng<input required type="number" min="0.001" max="1000" step="0.001" value={quantity}
          onChange={(event) => setQuantity(event.target.value)} /></label><button type="submit" disabled={Boolean(busy) || !serviceId}>
          Thêm chỉ định</button></form>}
    </section>
    {item.status === 'SIGNED' && <section className="panel"><h2>Phụ lục sau ký</h2>
      {item.amendments.map((amendment) => <article className="clinical-record" key={amendment.publicId}>
        <strong>#{amendment.number} · {amendment.reason}</strong><p>{amendment.content}</p>
        <small>{amendment.amendedBy} · {utc(amendment.amendedAtUtc)}</small></article>)}
      {!item.amendments.length && <p>Chưa có phụ lục.</p>}
      <form className="clinical-notes" onSubmit={(event) => void amend(event)}>
        <label>Lý do bổ sung<input required minLength={10} maxLength={1000} value={amendReason}
          onChange={(event) => setAmendReason(event.target.value)} /></label>
        <label>Nội dung phụ lục<textarea required maxLength={20000} rows={4} value={amendContent}
          onChange={(event) => setAmendContent(event.target.value)} /></label>
        <button type="submit" disabled={Boolean(busy)}>Thêm phụ lục</button></form></section>}
  </>
}

function ServiceRow({ service, open, busy, run }: {
  service: ClinicalEncounterDetail['services'][number]; open: boolean; busy: string; run: Action
}) {
  const [summary, setSummary] = useState(''); const [conclusion, setConclusion] = useState('')
  const [structuredValues, setStructuredValues] = useState<Record<string, string | boolean>>({})
  const finalize = async (event: FormEvent) => {
    event.preventDefault()
    const result: Record<string, unknown> = {}
    if (service.resultSchema) for (const [name, field] of Object.entries(service.resultSchema.properties)) {
      const raw = structuredValues[name]
      if (field.type === 'boolean') {
        if (service.resultSchema.required.includes(name) || raw !== undefined) result[name] = Boolean(raw)
      } else if (typeof raw === 'string' && raw.trim()) {
        result[name] = field.type === 'number' || field.type === 'integer' ? Number(raw) : raw.trim()
      }
    }
    if (await run('Chốt kết quả', () => apiClient.clinical.finalizeResult(service.publicId, {
      summary: summary.trim() || null, conclusion: conclusion.trim() || null,
      ...(Object.keys(result).length ? { result } : {}),
    }))) { setSummary(''); setConclusion(''); setStructuredValues({}) }
  }
  return <article className="clinical-service"><div className="detail-heading"><div><strong>{service.name}</strong>
    <p>{service.code} · {service.quantity} × {Number(service.unitPrice).toLocaleString('vi-VN')} ₫</p></div>
    <span className="status">{service.status}</span></div>
    {service.result && <div className="clinical-record">Kết quả FINAL v{service.result.version}: {' '}
      {service.result.summary || service.result.conclusion || JSON.stringify(service.result.result)}</div>}
    {open && service.type !== 'CONSULTATION' && !service.result && service.status !== 'CANCELLED' &&
      <form className="clinical-notes" onSubmit={(event) => void finalize(event)}>
        <label>Tóm tắt kết quả<textarea maxLength={10000} rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label>Kết luận<textarea maxLength={10000} rows={2} value={conclusion} onChange={(event) => setConclusion(event.target.value)} /></label>
        {service.resultSchema && <fieldset><legend>Kết quả có cấu trúc</legend>
          {Object.entries(service.resultSchema.properties).map(([name, field]) => {
            const required = service.resultSchema?.required.includes(name) ?? false
            const label = `${field.title}${field.unit ? ` (${field.unit})` : ''}${required ? ' *' : ''}`
            if (field.type === 'boolean') return <label className="checkbox" key={name}>
              <input type="checkbox" checked={Boolean(structuredValues[name])}
                onChange={(event) => setStructuredValues((current) => ({ ...current, [name]: event.target.checked }))} />
              {label}</label>
            if (field.enum) return <label key={name}>{label}<select required={required}
              value={String(structuredValues[name] ?? '')}
              onChange={(event) => setStructuredValues((current) => ({ ...current, [name]: event.target.value }))}>
              <option value="">Chọn giá trị</option>{field.enum.map((option) => <option key={option} value={option}>{option}</option>)}
            </select></label>
            return <label key={name}>{label}<input required={required}
              type={field.type === 'string' ? 'text' : 'number'}
              step={field.type === 'integer' ? 1 : field.type === 'number' ? 'any' : undefined}
              min={field.minimum} max={field.maximum} minLength={field.minLength} maxLength={field.maxLength}
              value={String(structuredValues[name] ?? '')}
              onChange={(event) => setStructuredValues((current) => ({ ...current, [name]: event.target.value }))} /></label>
          })}</fieldset>}
        <button type="submit" disabled={Boolean(busy)
          || !service.resultSchema && !summary.trim() && !conclusion.trim()}>Chốt FINAL</button>
      </form>}
  </article>
}
