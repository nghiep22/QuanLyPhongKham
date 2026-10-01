import { ApiClientError } from '@clinic/generated-api-client'
import type {
  CreateOrganizationBranchRequest, OrganizationBranch, OrganizationCategory, OrganizationSpecialty,
  UpdateOrganizationBranchRequest,
} from '@clinic/generated-api-types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { apiClient } from '../../shared/api/client'

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'CATALOG_VERSION_CONFLICT') return 'Dữ liệu đã thay đổi ở phiên khác. Hãy tải lại rồi sửa tiếp.'
    if (error.code === 'CATALOG_IN_USE') return 'Đang có lịch hẹn, slot hoặc dịch vụ hoạt động liên quan. Hãy xử lý trước khi tạm ngừng hoặc đổi múi giờ.'
    if (error.code === 'CATALOG_CODE_CONFLICT') return 'Mã hoặc tên danh mục đã tồn tại.'
    return error.message
  }
  return 'Không thể kết nối hệ thống. Hãy thử lại.'
}

const emptyBranch: CreateOrganizationBranchRequest = {
  code: '', name: '', addressLine: '', ward: null, district: null, province: null,
  phone: null, email: null, medicalLicenseNo: null, timezoneName: 'SE Asia Standard Time',
  bookingHorizonDays: 60, onlineHoldMinutes: 15, cancellationDeadlineMinutes: 120,
  checkInEarlyMinutes: 120, checkInLateMinutes: 180, walkInMaxWaitMinutes: 45,
}

const optional = (value: string) => value.trim() || null

function BranchForm({ item, onDone }: { item?: OrganizationBranch; onDone: () => void }) {
  const [form, setForm] = useState<CreateOrganizationBranchRequest>(item ? {
    code: item.code, name: item.name, addressLine: item.addressLine, ward: item.ward,
    district: item.district, province: item.province, phone: item.phone, email: item.email,
    medicalLicenseNo: item.medicalLicenseNo, timezoneName: item.timezoneName,
    bookingHorizonDays: item.bookingHorizonDays, onlineHoldMinutes: item.onlineHoldMinutes,
    cancellationDeadlineMinutes: item.cancellationDeadlineMinutes,
    checkInEarlyMinutes: item.checkInEarlyMinutes, checkInLateMinutes: item.checkInLateMinutes,
    walkInMaxWaitMinutes: item.walkInMaxWaitMinutes,
  } : emptyBranch)
  const [active, setActive] = useState(item?.isActive ?? true)
  const mutation = useMutation({ mutationFn: () => {
    const { code: _code, ...fields } = form
    return item
      ? apiClient.catalog.updateBranch(item.publicId, { ...fields, isActive: active } satisfies UpdateOrganizationBranchRequest, item.rowVersion)
      : apiClient.catalog.createBranch(form)
  }, onSuccess: () => { if (!item) setForm(emptyBranch); onDone() } })
  const edit = <K extends keyof CreateOrganizationBranchRequest>(field: K, value: CreateOrganizationBranchRequest[K]) =>
    setForm((current) => ({ ...current, [field]: value }))
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate() }
  return <form className="catalog-form panel" onSubmit={submit}>
    <h3>{item ? `Sửa ${item.code}` : 'Thêm chi nhánh'}</h3>
    <div className="form-grid">
      {!item && <label>Mã chi nhánh<input required minLength={2} maxLength={20} pattern="[A-Za-z0-9_-]+" value={form.code}
        onChange={(event) => edit('code', event.target.value.toUpperCase())} /></label>}
      <label>Tên chi nhánh<input required minLength={2} maxLength={200} value={form.name}
        onChange={(event) => edit('name', event.target.value)} /></label>
      <label>Địa chỉ<input required minLength={2} maxLength={300} value={form.addressLine}
        onChange={(event) => edit('addressLine', event.target.value)} /></label>
      <label>Phường / xã<input maxLength={100} value={form.ward ?? ''}
        onChange={(event) => edit('ward', optional(event.target.value))} /></label>
      <label>Quận / huyện<input maxLength={100} value={form.district ?? ''}
        onChange={(event) => edit('district', optional(event.target.value))} /></label>
      <label>Tỉnh / thành<input maxLength={100} value={form.province ?? ''}
        onChange={(event) => edit('province', optional(event.target.value))} /></label>
      <label>Điện thoại<input maxLength={20} value={form.phone ?? ''}
        onChange={(event) => edit('phone', optional(event.target.value))} /></label>
      <label>Email<input type="email" maxLength={254} value={form.email ?? ''}
        onChange={(event) => edit('email', optional(event.target.value))} /></label>
      <label>Số giấy phép<input maxLength={100} value={form.medicalLicenseNo ?? ''}
        onChange={(event) => edit('medicalLicenseNo', optional(event.target.value))} /></label>
      <label>Múi giờ Windows<input required maxLength={128} value={form.timezoneName}
        onChange={(event) => edit('timezoneName', event.target.value)} /></label>
      <label>Đặt trước tối đa (ngày)<input required type="number" min={1} max={365} value={form.bookingHorizonDays}
        onChange={(event) => edit('bookingHorizonDays', Number(event.target.value))} /></label>
      <label>Giữ slot (phút)<input required type="number" min={1} max={120} value={form.onlineHoldMinutes}
        onChange={(event) => edit('onlineHoldMinutes', Number(event.target.value))} /></label>
      <label>Hạn hủy trước giờ khám (phút)<input required type="number" min={0} max={525600} value={form.cancellationDeadlineMinutes}
        onChange={(event) => edit('cancellationDeadlineMinutes', Number(event.target.value))} /></label>
      <label>Check-in sớm (phút)<input required type="number" min={0} max={720} value={form.checkInEarlyMinutes}
        onChange={(event) => edit('checkInEarlyMinutes', Number(event.target.value))} /></label>
      <label>Check-in muộn (phút)<input required type="number" min={0} max={1440} value={form.checkInLateMinutes}
        onChange={(event) => edit('checkInLateMinutes', Number(event.target.value))} /></label>
      <label>Chờ walk-in tối đa (phút)<input required type="number" min={15} max={180} value={form.walkInMaxWaitMinutes}
        onChange={(event) => edit('walkInMaxWaitMinutes', Number(event.target.value))} /></label>
      {item && <label className="checkbox"><input type="checkbox" checked={active}
        onChange={(event) => setActive(event.target.checked)} /> Hoạt động</label>}
    </div>
    {mutation.error && <div className="form-error" role="alert">{errorMessage(mutation.error)}</div>}
    <button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Đang lưu…' : item ? 'Lưu chi nhánh' : 'Tạo chi nhánh'}</button>
  </form>
}

function SpecialtyForm({ item, onDone }: { item?: OrganizationSpecialty; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [active, setActive] = useState(item?.isActive ?? true)
  const mutation = useMutation({ mutationFn: () => item
    ? apiClient.catalog.updateSpecialty(item.publicId, { name: name.trim(), description: optional(description), isActive: active }, item.rowVersion)
    : apiClient.catalog.createSpecialty({ code: code.trim().toUpperCase(), name: name.trim(), description: optional(description) }),
  onSuccess: () => { if (!item) { setCode(''); setName(''); setDescription('') } onDone() } })
  return <form className="catalog-form panel" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
    <h3>{item ? `Sửa ${item.code}` : 'Thêm chuyên khoa'}</h3>
    <div className="form-grid">
      {!item && <label>Mã<input required minLength={2} maxLength={30} pattern="[A-Za-z0-9_-]+" value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>}
      <label>Tên<input required minLength={2} maxLength={150} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Mô tả<input maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      {item && <label className="checkbox"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Hoạt động</label>}
    </div>
    {mutation.error && <div className="form-error" role="alert">{errorMessage(mutation.error)}</div>}
    <button disabled={mutation.isPending} type="submit">{item ? 'Lưu chuyên khoa' : 'Tạo chuyên khoa'}</button>
  </form>
}

function CategoryForm({ item, onDone }: { item?: OrganizationCategory; onDone: () => void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState(item?.name ?? '')
  const [displayOrder, setDisplayOrder] = useState(item?.displayOrder ?? 0)
  const [active, setActive] = useState(item?.isActive ?? true)
  const mutation = useMutation({ mutationFn: () => item
    ? apiClient.catalog.updateCategory(item.publicId, { name: name.trim(), displayOrder, isActive: active }, item.rowVersion)
    : apiClient.catalog.createCategory({ code: code.trim().toUpperCase(), name: name.trim(), displayOrder }),
  onSuccess: () => { if (!item) { setCode(''); setName(''); setDisplayOrder(0) } onDone() } })
  return <form className="catalog-form panel" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
    <h3>{item ? `Sửa ${item.code}` : 'Thêm nhóm dịch vụ'}</h3>
    <div className="form-grid">
      {!item && <label>Mã<input required minLength={2} maxLength={30} pattern="[A-Za-z0-9_-]+" value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>}
      <label>Tên<input required minLength={2} maxLength={150} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Thứ tự hiển thị<input required type="number" min={0} max={1000000} value={displayOrder}
        onChange={(event) => setDisplayOrder(Number(event.target.value))} /></label>
      {item && <label className="checkbox"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Hoạt động</label>}
    </div>
    {mutation.error && <div className="form-error" role="alert">{errorMessage(mutation.error)}</div>}
    <button disabled={mutation.isPending} type="submit">{item ? 'Lưu nhóm' : 'Tạo nhóm'}</button>
  </form>
}

export function OrganizationCatalog() {
  const client = useQueryClient()
  const data = useQuery({ queryKey: ['catalog-organization'], queryFn: () => apiClient.catalog.organization().then((response) => response.data) })
  const [editing, setEditing] = useState('')
  const done = () => {
    setEditing('')
    void Promise.all([
      client.invalidateQueries({ queryKey: ['catalog-organization'] }),
      client.invalidateQueries({ queryKey: ['catalog-references'] }),
      client.invalidateQueries({ queryKey: ['catalog-services'] }),
      client.invalidateQueries({ queryKey: ['catalog-rooms'] }),
    ])
  }
  if (data.isLoading) return <div className="page-state">Đang tải danh mục tổ chức…</div>
  if (data.error || !data.data) return <div className="form-error" role="alert">{errorMessage(data.error)}</div>
  return <section className="panel">
    <h2>Chi nhánh, chuyên khoa và nhóm dịch vụ</h2>
    <p>Chỉ Admin có quyền quản lý danh mục toàn tổ chức được sửa các mục này.</p>
    <button type="button" className="secondary" onClick={() => void data.refetch()}>Tải lại danh mục</button>
    <div className="catalog-columns">
      <div>
        <h3>Chi nhánh</h3>
        <BranchForm key="new-branch" onDone={done} />
        {data.data.branches.map((item) => <article key={item.publicId} className="catalog-card">
          <strong>{item.name}</strong><p>{item.code} · {item.addressLine} · {item.timezoneName} · {item.isActive ? 'Hoạt động' : 'Tạm ngừng'}</p>
          <button type="button" className="secondary" onClick={() => setEditing(editing === item.publicId ? '' : item.publicId)}>Sửa chi nhánh</button>
          {editing === item.publicId && <BranchForm key={item.rowVersion} item={item} onDone={done} />}
        </article>)}
      </div>
      <div>
        <h3>Chuyên khoa</h3>
        <SpecialtyForm key="new-specialty" onDone={done} />
        {data.data.specialties.map((item) => <article key={item.publicId} className="catalog-card">
          <strong>{item.name}</strong><p>{item.code} · {item.isActive ? 'Hoạt động' : 'Tạm ngừng'}</p>
          <button type="button" className="secondary" onClick={() => setEditing(editing === item.publicId ? '' : item.publicId)}>Sửa chuyên khoa</button>
          {editing === item.publicId && <SpecialtyForm key={item.rowVersion} item={item} onDone={done} />}
        </article>)}
        <h3>Nhóm dịch vụ</h3>
        <CategoryForm key="new-category" onDone={done} />
        {data.data.categories.map((item) => <article key={item.publicId} className="catalog-card">
          <strong>{item.name}</strong><p>{item.code} · thứ tự {item.displayOrder} · {item.isActive ? 'Hoạt động' : 'Tạm ngừng'}</p>
          <button type="button" className="secondary" onClick={() => setEditing(editing === item.publicId ? '' : item.publicId)}>Sửa nhóm</button>
          {editing === item.publicId && <CategoryForm key={item.rowVersion} item={item} onDone={done} />}
        </article>)}
      </div>
    </div>
  </section>
}
