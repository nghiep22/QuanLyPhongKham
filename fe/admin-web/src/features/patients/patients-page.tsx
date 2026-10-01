import { ApiClientError } from '@clinic/generated-api-client'
import type { PatientDetail, PatientSummary, PatientWriteRequest } from '@clinic/generated-api-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { downloadExcelCsv, openPrintDocument, patientProfilePrintDocument } from '../../shared/printing'
import { useAuth } from '../auth/auth-context'
import { PatientMergePanel } from './patient-merge-panel'

type FormValues = {
  fullName: string; dateOfBirth: string; gender: PatientWriteRequest['gender'];
  nationalId: string; healthInsuranceNo: string; phone: string; email: string;
  addressLine: string; province: string;
}
const emptyForm: FormValues = { fullName: '', dateOfBirth: '', gender: 'OTHER', nationalId: '',
  healthInsuranceNo: '', phone: '', email: '', addressLine: '', province: '' }
function fromPatient(patient?: PatientDetail): FormValues {
  return patient ? { fullName: patient.fullName, dateOfBirth: patient.dateOfBirth, gender: patient.gender,
    nationalId: patient.nationalId ?? '', healthInsuranceNo: patient.healthInsuranceNo ?? '',
    phone: patient.phone ?? '', email: patient.email ?? '', addressLine: patient.addressLine ?? '',
    province: patient.province ?? '' } : { ...emptyForm }
}
function body(values: FormValues): PatientWriteRequest {
  return { fullName: values.fullName.trim(), dateOfBirth: values.dateOfBirth, gender: values.gender,
    nationalId: values.nationalId.trim() || null, healthInsuranceNo: values.healthInsuranceNo.trim() || null,
    phone: values.phone.trim() || null, email: values.email.trim() || null,
    addressLine: values.addressLine.trim() || null, province: values.province.trim() || null }
}
function message(error: unknown) {
  if (!(error instanceof ApiClientError)) return 'Không thể kết nối hệ thống. Vui lòng thử lại.'
  if (error.code === 'PATIENT_VERSION_CONFLICT') return 'Hồ sơ đã được người khác cập nhật. Hãy tải lại trước khi lưu.'
  if (error.code === 'PATIENT_ID_CONFLICT') return 'Số định danh đã có trong hệ thống. Hãy đối chiếu hồ sơ hiện có.'
  if (error.code === 'POSSIBLE_DUPLICATE') return 'Có hồ sơ có thể trùng. Hãy kiểm tra danh sách bên dưới.'
  if (error.status === 403) return 'Bạn không có quyền quản lý bệnh nhân tại chi nhánh này.'
  return error.message
}
function PatientFields({ values, change }: { values: FormValues; change: (next: FormValues) => void }) {
  const field = (name: keyof FormValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    change({ ...values, [name]: event.target.value })
  return <div className="form-grid">
    <label>Họ tên<input required minLength={2} maxLength={200} value={values.fullName} onChange={field('fullName')} /></label>
    <label>Ngày sinh<input required type="date" value={values.dateOfBirth} onChange={field('dateOfBirth')} /></label>
    <label>Giới tính<select value={values.gender} onChange={field('gender')}>
      <option value="OTHER">Khác</option><option value="FEMALE">Nữ</option><option value="MALE">Nam</option>
    </select></label>
    <label>Số điện thoại<input maxLength={20} value={values.phone} onChange={field('phone')} /></label>
    <label>Số định danh<input maxLength={30} value={values.nationalId} onChange={field('nationalId')} /></label>
    <label>Email<input type="email" maxLength={254} value={values.email} onChange={field('email')} /></label>
    <label>Số BHYT<input maxLength={30} value={values.healthInsuranceNo} onChange={field('healthInsuranceNo')} /></label>
    <label>Tỉnh/thành<input maxLength={100} value={values.province} onChange={field('province')} /></label>
    <label className="wide">Địa chỉ<input maxLength={300} value={values.addressLine} onChange={field('addressLine')} /></label>
  </div>
}

function CreateForm({ branchPublicId, onCreated }: { branchPublicId: string; onCreated: (id: string) => void }) {
  const client = useQueryClient()
  const [values, setValues] = useState<FormValues>({ ...emptyForm })
  const [candidates, setCandidates] = useState<PatientSummary[] | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(false)
  const create = async (override: boolean) => {
    const result = await apiClient.patients.create({ ...body(values), branchPublicId,
      duplicateOverride: override, ...(override ? { duplicateReason: reason.trim() } : {}) })
    setValues({ ...emptyForm }); setCandidates(null); setReason('')
    void client.invalidateQueries({ queryKey: ['patients-search'] })
    onCreated(result.data.publicId)
  }
  const checkAndCreate = async () => {
    setError(null); setPending(true)
    try {
      const found = await apiClient.patients.duplicates({ ...body(values), branchPublicId })
      setCandidates(found.data)
      if (!found.data.length) await create(false)
    } catch (caught) {
      setError(caught)
      if (caught instanceof ApiClientError && caught.code === 'POSSIBLE_DUPLICATE') {
        try {
          const found = await apiClient.patients.duplicates({ ...body(values), branchPublicId })
          setCandidates(found.data)
        } catch { /* original error stays visible */ }
      }
    } finally { setPending(false) }
  }
  const confirmDuplicate = async () => {
    setError(null); setPending(true)
    try { await create(true) } catch (caught) { setError(caught) } finally { setPending(false) }
  }
  return <section className="panel patient-form-panel">
    <h2>Thêm hồ sơ hành chính</h2>
    <p>Kiểm tra hồ sơ có thể trùng tại chi nhánh trước khi cấp mã mới.</p>
    <form onSubmit={(event) => { event.preventDefault(); void checkAndCreate() }}>
      <PatientFields values={values} change={(next) => { setValues(next); setCandidates(null); setError(null) }} />
      {error !== null && <div className="form-error" role="alert">{message(error)}</div>}
      <button type="submit" disabled={pending || !branchPublicId}>{pending ? 'Đang kiểm tra…' : 'Kiểm tra và tạo hồ sơ'}</button>
    </form>
    {candidates && candidates.length > 0 && <div className="patient-duplicate-warning" role="alert">
      <h3>Hồ sơ có thể trùng</h3>
      <p>Đối chiếu trước khi tạo mới. Số định danh ở chi nhánh khác có thể vẫn bị hệ thống từ chối.</p>
      <ul>{candidates.map((item) => <li key={item.publicId}>
        <strong>{item.code} · {item.fullName}</strong> · {item.dateOfBirth} · {item.phone ?? 'Không có số điện thoại'}
        {' '}<button type="button" className="secondary" onClick={() => onCreated(item.publicId)}>Mở hồ sơ</button>
      </li>)}</ul>
      <label>Lý do vẫn tạo hồ sơ mới<textarea minLength={10} maxLength={500} value={reason}
        onChange={(event) => setReason(event.target.value)} /></label>
      <button type="button" disabled={pending || reason.trim().length < 10} onClick={() => void confirmDuplicate()}>
        Xác nhận tạo hồ sơ mới
      </button>
    </div>}
  </section>
}

function EditForm({ branchPublicId, patient }: { branchPublicId: string; patient: PatientDetail }) {
  const client = useQueryClient()
  const [values, setValues] = useState<FormValues>(() => fromPatient(patient))
  const [contacts, setContacts] = useState(() => patient.emergencyContacts.map((contact) => ({
    fullName: contact.fullName, relationshipName: contact.relationshipName ?? '',
    phone: contact.phone, isPrimary: contact.isPrimary,
  })))
  const update = useMutation({
    mutationFn: () => apiClient.patients.update(patient.publicId, branchPublicId, body(values), patient.rowVersion),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['patients-search'] })
      void client.invalidateQueries({ queryKey: ['patient-detail', branchPublicId, patient.publicId] })
    },
  })
  const saveContacts = useMutation({
    mutationFn: () => apiClient.patients.replaceEmergencyContacts(patient.publicId, branchPublicId, {
      contacts: contacts.map((contact) => ({ ...contact,
        fullName: contact.fullName.trim(), relationshipName: contact.relationshipName.trim() || null,
        phone: contact.phone.trim() })),
    }, patient.rowVersion),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['patient-detail', branchPublicId, patient.publicId] }),
  })
  const removeContact = (index: number) => setContacts((current) => {
    const next = current.filter((_, position) => position !== index)
    return next.length && !next.some((contact) => contact.isPrimary)
      ? next.map((contact, position) => ({ ...contact, isPrimary: position === 0 })) : next
  })
  const exportPatient = () => downloadExcelCsv<PatientDetail>(`ho-so-${patient.code}`, [
    { header: 'Mã bệnh nhân', value: 'code' },
    { header: 'Họ tên', value: 'fullName' },
    { header: 'Ngày sinh', value: 'dateOfBirth' },
    { header: 'Giới tính', value: 'gender' },
    { header: 'Điện thoại', value: 'phone' },
    { header: 'Email', value: 'email' },
    { header: 'Số định danh', value: 'nationalId' },
    { header: 'Số BHYT', value: 'healthInsuranceNo' },
    { header: 'Địa chỉ', value: 'addressLine' },
    { header: 'Tỉnh/thành', value: 'province' },
    { header: 'Chi nhánh', value: (row) => row.branch.name },
    { header: 'Trạng thái', value: 'status' },
  ], [patient])
  return <section className="panel patient-form-panel">
    <div className="detail-heading"><div><h2>{patient.fullName}</h2>
      <p>{patient.code} · Chi nhánh đăng ký: {patient.branch.name}</p></div>
      <div className="action-row"><button type="button" className="secondary"
        onClick={() => openPrintDocument(patientProfilePrintDocument(patient))}>In hồ sơ hành chính</button>
        <button type="button" className="secondary" onClick={exportPatient}>Xuất Excel (.csv)</button></div></div>
    <form onSubmit={(event) => { event.preventDefault(); update.mutate() }}>
      <PatientFields values={values} change={setValues} />
      {update.error && <div className="form-error" role="alert">{message(update.error)}</div>}
      {update.error instanceof ApiClientError && update.error.code === 'PATIENT_VERSION_CONFLICT'
        && <button type="button" className="secondary" onClick={() => void client.invalidateQueries({
          queryKey: ['patient-detail', branchPublicId, patient.publicId],
        })}>Tải lại hồ sơ</button>}
      {update.isSuccess && <div className="form-success" role="status">Đã lưu hồ sơ.</div>}
      <button type="submit" disabled={update.isPending || saveContacts.isPending}>
        {update.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
    </form>
    <section className="patient-emergency-contacts"><h3>Liên hệ khẩn cấp</h3>
      <p>Tối đa 5 người; chọn một người liên hệ chính. Thay đổi chỉ được lưu khi bấm nút bên dưới.</p>
      {contacts.map((contact, index) => <div className="form-grid" key={index}>
        <label>Họ tên<input required minLength={2} maxLength={200} value={contact.fullName}
          onChange={(event) => setContacts((current) => current.map((item, position) =>
            position === index ? { ...item, fullName: event.target.value } : item))} /></label>
        <label>Quan hệ<input maxLength={80} value={contact.relationshipName}
          onChange={(event) => setContacts((current) => current.map((item, position) =>
            position === index ? { ...item, relationshipName: event.target.value } : item))} /></label>
        <label>Số điện thoại<input required minLength={7} maxLength={20} pattern="[0-9+(). -]+"
          value={contact.phone} onChange={(event) => setContacts((current) => current.map((item, position) =>
            position === index ? { ...item, phone: event.target.value } : item))} /></label>
        <label className="checkbox-label"><input type="radio" name={`primary-contact-${patient.publicId}`}
          checked={contact.isPrimary} onChange={() => setContacts((current) => current.map((item, position) =>
            ({ ...item, isPrimary: position === index })))} />Liên hệ chính</label>
        <button type="button" className="secondary" onClick={() => removeContact(index)}>Bỏ khỏi danh sách</button>
      </div>)}
      <div className="action-row"><button type="button" className="secondary" disabled={contacts.length >= 5}
        onClick={() => setContacts((current) => [...current, {
          fullName: '', relationshipName: '', phone: '', isPrimary: current.length === 0,
        }])}>+ Thêm liên hệ</button>
        <button type="button" disabled={saveContacts.isPending || update.isPending || contacts.length > 5 ||
          contacts.filter((contact) => contact.isPrimary).length !== (contacts.length ? 1 : 0) ||
          contacts.some((contact) => contact.fullName.trim().length < 2 ||
            !/^[0-9+(). -]{7,20}$/.test(contact.phone.trim()))}
          onClick={() => saveContacts.mutate()}>{saveContacts.isPending ? 'Đang lưu…' : 'Lưu liên hệ khẩn cấp'}</button></div>
      {saveContacts.error && <div className="form-error" role="alert">{message(saveContacts.error)}</div>}
      {saveContacts.isSuccess && <div className="form-success" role="status">Đã lưu liên hệ khẩn cấp.</div>}
    </section>
  </section>
}

export function PatientsPage() {
  const { user } = useAuth()
  const canMerge = Boolean(user?.roles.some((role) => role.code === 'ADMIN' && role.branchId === null))
  const client = useQueryClient()
  const references = useQuery({ queryKey: ['patient-references'], queryFn: () => apiClient.patients.references().then((result) => result.data) })
  const [selectedBranch, setSelectedBranch] = useState('')
  const branchPublicId = selectedBranch || references.data?.branches[0]?.publicId || ''
  const [query, setQuery] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [filters, setFilters] = useState({ query: '', dateOfBirth: '' })
  const [selectedId, setSelectedId] = useState('')
  const list = useQuery({ queryKey: ['patients-search', branchPublicId, filters], enabled: Boolean(branchPublicId),
    queryFn: () => apiClient.patients.search({ branchPublicId,
      ...(filters.query ? { query: filters.query } : {}),
      ...(filters.dateOfBirth ? { dateOfBirth: filters.dateOfBirth } : {}) }).then((result) => result.data) })
  const detail = useQuery({ queryKey: ['patient-detail', branchPublicId, selectedId],
    enabled: Boolean(branchPublicId && selectedId),
    queryFn: () => apiClient.patients.get(selectedId, branchPublicId).then((result) => result.data) })

  if (references.isLoading) return <div className="page-state">Đang tải chi nhánh…</div>
  if (references.error || !references.data) return <div className="page-state error-state">{message(references.error)}</div>

  return <>
    <header><div><span className="eyebrow">HỒ SƠ BỆNH NHÂN</span><h1>Tra cứu và đăng ký</h1>
      <p>Thông tin hành chính được giới hạn theo chi nhánh. Hồ sơ lâm sàng có quyền đọc riêng.</p></div></header>
    <form className="panel patient-search-bar" onSubmit={(event) => {
      event.preventDefault(); setFilters({ query: query.trim(), dateOfBirth }); setSelectedId('')
    }}>
      <label>Chi nhánh<select value={branchPublicId} onChange={(event) => { setSelectedBranch(event.target.value); setSelectedId('') }}>
        {references.data.branches.map((item) => <option key={item.publicId} value={item.publicId}>{item.name}</option>)}
      </select></label>
      <label>Mã, tên, điện thoại hoặc định danh<input minLength={2} maxLength={100} value={query}
        onChange={(event) => setQuery(event.target.value)} /></label>
      <label>Ngày sinh<input type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></label>
      <button type="submit">Tra cứu</button>
    </form>
    <div className="patient-workspace">
      <section className="staff-list">
        {list.isLoading && <div className="page-state">Đang tìm hồ sơ…</div>}
        {list.error && <div className="page-state error-state">{message(list.error)}</div>}
        {list.data?.length === 0 && <div className="page-state">Không tìm thấy hồ sơ tại chi nhánh này.</div>}
        {list.data?.map((item) => <button key={item.publicId} type="button"
          className={`staff-row ${selectedId === item.publicId ? 'selected' : ''}`}
          onClick={() => setSelectedId(item.publicId)}>
          <span className="avatar">{item.fullName.slice(0, 1)}</span>
          <span><strong>{item.fullName}</strong><small>{item.code} · {item.dateOfBirth} · {item.phone ?? 'Chưa có SĐT'}</small></span>
          <span className="status status-active">{item.status}</span>
        </button>)}
      </section>
      <div>
        {selectedId ? (detail.isLoading ? <div className="page-state">Đang tải hồ sơ…</div>
          : detail.error ? <div className="page-state error-state">{message(detail.error)}</div>
            : detail.data && <><EditForm key={`${detail.data.publicId}:${detail.data.rowVersion}`}
              branchPublicId={branchPublicId} patient={detail.data} />
              {canMerge && <PatientMergePanel key={`merge-${detail.data.publicId}`} source={detail.data}
                branches={references.data.branches} onMerged={(targetId, targetBranchId) => {
                  void client.invalidateQueries({ queryKey: ['patients-search'] })
                  void client.invalidateQueries({ queryKey: ['patient-detail'] })
                  void client.invalidateQueries({ queryKey: ['patient-merge-history'] })
                  setSelectedBranch(targetBranchId); setSelectedId(targetId)
                }} />}</>)
          : <CreateForm key={branchPublicId} branchPublicId={branchPublicId} onCreated={setSelectedId} />}
        {selectedId && <button type="button" className="secondary" onClick={() => setSelectedId('')}>+ Thêm hồ sơ mới</button>}
      </div>
    </div>
  </>
}
