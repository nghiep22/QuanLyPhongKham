import type {
  CreateStaffRequestWritable,
  EmployeeType,
  Staff,
  StaffReferenceData,
  UpdateStaffRequest,
} from '@clinic/generated-api-types'
import { ApiClientError } from '@clinic/generated-api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useAuth } from '../auth/auth-context'
import { apiClient } from '../../shared/api/client'

const employeeLabels: Record<EmployeeType, string> = {
  DOCTOR: 'Bác sĩ',
  NURSE: 'Điều dưỡng',
  RECEPTIONIST: 'Lễ tân',
  PHARMACIST: 'Dược sĩ',
  CASHIER: 'Thu ngân',
  LAB_TECH: 'Kỹ thuật viên xét nghiệm',
  TECHNICIAN: 'Kỹ thuật viên',
  MANAGER: 'Quản lý',
  OTHER: 'Khác',
}

function message(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 403) return 'Bạn không có quyền thực hiện thao tác trong chi nhánh này.'
    if (error.status === 409) return error.message || 'Dữ liệu đã thay đổi hoặc bị trùng. Hãy tải lại và thử lại.'
    return error.message
  }
  return 'Không thể kết nối hệ thống. Vui lòng thử lại.'
}

function optional(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

type CreateValues = CreateStaffRequestWritable

function CreateStaffForm({
  references,
  onCreated,
}: {
  references: StaffReferenceData
  onCreated: (staff: Staff) => void
}) {
  const [serverError, setServerError] = useState<string | null>(null)
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<CreateValues>({
    defaultValues: {
      branchPublicId: references.branches[0]?.publicId,
      employeeType: 'RECEPTIONIST',
      hireDate: new Date().toISOString().slice(0, 10),
      defaultSlotMinutes: 30,
      acceptsOnlineBooking: true,
    },
  })
  const queryClient = useQueryClient()
  const type = useWatch({ control, name: 'employeeType' })
  const mutation = useMutation({
    mutationFn: (body: CreateStaffRequestWritable) => apiClient.staff.create(body),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ['staff'] })
      onCreated(response.data)
      reset()
    },
    onError: (error) => setServerError(message(error)),
  })

  const submit = handleSubmit((values) => {
    setServerError(null)
    mutation.mutate({
      ...values,
      username: values.username.trim(),
      employeeCode: values.employeeCode.trim(),
      fullName: values.fullName.trim(),
      email: optional(values.email),
      phone: optional(values.phone),
      dateOfBirth: optional(values.dateOfBirth),
      addressLine: optional(values.addressLine),
      medicalLicenseNo: optional(values.medicalLicenseNo),
      licenseIssuedDate: optional(values.licenseIssuedDate),
      licenseExpiryDate: optional(values.licenseExpiryDate),
      academicTitle: optional(values.academicTitle),
      biography: optional(values.biography),
      specialtyPublicId: optional(values.specialtyPublicId),
    })
  })

  return (
    <form className="staff-form" onSubmit={submit}>
      <div className="form-grid">
        <label>Chi nhánh
          <select {...register('branchPublicId', { required: true })}>
            {references.branches.map((branch) =>
              <option key={branch.publicId} value={branch.publicId}>{branch.name}</option>)}
          </select>
        </label>
        <label>Loại nhân viên
          <select {...register('employeeType')}>
            {Object.entries(employeeLabels).map(([value, label]) =>
              <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Mã nhân viên
          <input {...register('employeeCode', { required: 'Bắt buộc', minLength: 2 })} />
          {errors.employeeCode && <span className="field-error">Nhập mã nhân viên.</span>}
        </label>
        <label>Họ tên
          <input {...register('fullName', { required: 'Bắt buộc', minLength: 2 })} />
          {errors.fullName && <span className="field-error">Nhập họ tên.</span>}
        </label>
        <label>Tên đăng nhập
          <input autoComplete="off" {...register('username', { required: 'Bắt buộc', minLength: 3 })} />
          {errors.username && <span className="field-error">Tối thiểu 3 ký tự.</span>}
        </label>
        <label>Mật khẩu tạm
          <input type="password" autoComplete="new-password"
            {...register('temporaryPassword', { required: 'Bắt buộc', minLength: 12 })} />
          {errors.temporaryPassword && <span className="field-error">Tối thiểu 12 ký tự.</span>}
        </label>
        <label>Email
          <input type="email" {...register('email')} />
        </label>
        <label>Số điện thoại
          <input {...register('phone', { minLength: 8 })} />
        </label>
        <label>Ngày vào làm
          <input type="date" {...register('hireDate', { required: true })} />
        </label>
        <label>Ngày sinh
          <input type="date" {...register('dateOfBirth')} />
        </label>
        <label>Giới tính
          <select {...register('gender')}>
            <option value="">Không khai báo</option>
            <option value="MALE">Nam</option><option value="FEMALE">Nữ</option><option value="OTHER">Khác</option>
          </select>
        </label>
        <label>Địa chỉ
          <input {...register('addressLine')} />
        </label>
      </div>
      {type === 'DOCTOR' && (
        <fieldset>
          <legend>Thông tin bác sĩ</legend>
          <div className="form-grid">
            <label>Số chứng chỉ hành nghề
              <input {...register('medicalLicenseNo', { required: type === 'DOCTOR' })} />
            </label>
            <label>Chuyên khoa chính
              <select {...register('specialtyPublicId')}>
                {references.specialties.map((item) =>
                  <option key={item.publicId} value={item.publicId}>{item.name}</option>)}
              </select>
            </label>
            <label>Ngày cấp chứng chỉ<input type="date" {...register('licenseIssuedDate')} /></label>
            <label>Ngày hết hạn<input type="date" {...register('licenseExpiryDate')} /></label>
            <label>Học hàm/học vị<input {...register('academicTitle')} /></label>
            <label>Độ dài slot (phút)
              <input type="number" {...register('defaultSlotMinutes', { valueAsNumber: true, min: 5, max: 240 })} />
            </label>
            <label className="checkbox"><input type="checkbox" {...register('acceptsOnlineBooking')} />
              Nhận đặt lịch online
            </label>
            <label className="wide">Tiểu sử<textarea {...register('biography')} rows={3} /></label>
          </div>
        </fieldset>
      )}
      {serverError && <div className="form-error" role="alert">{serverError}</div>}
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Đang tạo…' : 'Tạo nhân viên'}
      </button>
    </form>
  )
}

type EditValues = {
  email: string
  phone: string
  fullName: string
  dateOfBirth: string
  gender: '' | 'MALE' | 'FEMALE' | 'OTHER'
  addressLine: string
  hireDate: string
  employmentStatus: 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED'
  terminationDate: string
  medicalLicenseNo: string
  licenseIssuedDate: string
  licenseExpiryDate: string
  academicTitle: string
  biography: string
  defaultSlotMinutes: number
  acceptsOnlineBooking: boolean
}

function StaffDetail({
  staff,
  references,
  onChanged,
}: {
  staff: Staff
  references: StaffReferenceData
  onChanged: (staff: Staff) => void
}) {
  const { register, handleSubmit, reset, control } = useForm<EditValues>()
  const [reason, setReason] = useState('')
  const [roleCode, setRoleCode] = useState(references.roles[0]?.code ?? '')
  const [roleBranch, setRoleBranch] = useState(staff.branch.publicId)
  const [validTo, setValidTo] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const status = useWatch({ control, name: 'employmentStatus' })

  useEffect(() => {
    reset({
      email: staff.email ?? '',
      phone: staff.phone ?? '',
      fullName: staff.fullName,
      dateOfBirth: staff.dateOfBirth ?? '',
      gender: staff.gender ?? '',
      addressLine: staff.addressLine ?? '',
      hireDate: staff.hireDate,
      employmentStatus: staff.employmentStatus,
      terminationDate: '',
      medicalLicenseNo: staff.doctor?.medicalLicenseNo ?? '',
      licenseIssuedDate: staff.doctor?.licenseIssuedDate ?? '',
      licenseExpiryDate: staff.doctor?.licenseExpiryDate ?? '',
      academicTitle: staff.doctor?.academicTitle ?? '',
      biography: staff.doctor?.biography ?? '',
      defaultSlotMinutes: staff.doctor?.defaultSlotMinutes ?? 30,
      acceptsOnlineBooking: staff.doctor?.acceptsOnlineBooking ?? false,
    })
  }, [reset, staff])

  const changed = (next: Staff) => {
    setServerError(null)
    setReason('')
    onChanged(next)
    void queryClient.invalidateQueries({ queryKey: ['staff'] })
  }
  const mutation = useMutation({
    mutationFn: (input: UpdateStaffRequest) => apiClient.staff.update(
      staff.publicId, input, staff.rowVersion, staff.doctor?.rowVersion,
    ),
    onSuccess: (response) => changed(response.data),
    onError: (error) => setServerError(message(error)),
  })
  const action = useMutation({
    mutationFn: async (kind: 'status' | 'unlock') => kind === 'unlock'
      ? apiClient.staff.unlock(staff.userPublicId, { reason })
      : apiClient.staff.setStatus(staff.userPublicId, {
          status: staff.accountStatus === 'DISABLED' ? 'ACTIVE' : 'DISABLED', reason,
        }),
    onSuccess: (response) => changed(response.data),
    onError: (error) => setServerError(message(error)),
  })
  const grant = useMutation({
    mutationFn: () => {
      const role = references.roles.find((item) => item.code === roleCode)
      return apiClient.staff.grantRole(staff.userPublicId, {
        roleCode,
        branchPublicId: role?.scope === 'GLOBAL' ? undefined : roleBranch,
        validToUtc: validTo ? new Date(validTo).toISOString() : undefined,
      })
    },
    onSuccess: (response) => changed(response.data),
    onError: (error) => setServerError(message(error)),
  })
  const revoke = useMutation({
    mutationFn: (assignmentId: string) =>
      apiClient.staff.revokeRole(staff.userPublicId, assignmentId, { reason }),
    onSuccess: (response) => changed(response.data),
    onError: (error) => setServerError(message(error)),
  })

  const submit = handleSubmit((values) => mutation.mutate({
    fullName: values.fullName.trim(),
    email: optional(values.email),
    phone: optional(values.phone),
    dateOfBirth: optional(values.dateOfBirth),
    gender: values.gender || undefined,
    addressLine: optional(values.addressLine),
    hireDate: values.hireDate,
    employmentStatus: values.employmentStatus,
    terminationDate: optional(values.terminationDate),
    medicalLicenseNo: optional(values.medicalLicenseNo),
    licenseIssuedDate: optional(values.licenseIssuedDate),
    licenseExpiryDate: optional(values.licenseExpiryDate),
    academicTitle: optional(values.academicTitle),
    biography: optional(values.biography),
    defaultSlotMinutes: staff.doctor ? values.defaultSlotMinutes : undefined,
    acceptsOnlineBooking: staff.doctor ? values.acceptsOnlineBooking : undefined,
  }))

  const busy = mutation.isPending || action.isPending || grant.isPending || revoke.isPending
  return (
    <section className="staff-detail">
      <div className="detail-heading">
        <div><span className="eyebrow">{staff.employeeCode}</span><h2>{staff.fullName}</h2></div>
        <span className={`status status-${staff.accountStatus.toLowerCase()}`}>{staff.accountStatus}</span>
      </div>
      <form className="staff-form compact" onSubmit={submit}>
        <div className="form-grid">
          <label>Họ tên<input {...register('fullName', { required: true, minLength: 2 })} /></label>
          <label>Email<input type="email" {...register('email')} /></label>
          <label>Số điện thoại<input {...register('phone')} /></label>
          <label>Ngày sinh<input type="date" {...register('dateOfBirth')} /></label>
          <label>Giới tính<select {...register('gender')}>
            <option value="">Không khai báo</option><option value="MALE">Nam</option>
            <option value="FEMALE">Nữ</option><option value="OTHER">Khác</option>
          </select></label>
          <label>Địa chỉ<input {...register('addressLine')} /></label>
          <label>Ngày vào làm<input type="date" {...register('hireDate', { required: true })} /></label>
          <label>Trạng thái nhân sự<select {...register('employmentStatus')}>
            <option value="ACTIVE">Đang làm</option><option value="ON_LEAVE">Nghỉ phép</option>
            <option value="SUSPENDED">Tạm đình chỉ</option><option value="TERMINATED">Đã nghỉ việc</option>
          </select></label>
          {status === 'TERMINATED' &&
            <label>Ngày nghỉ việc<input type="date" {...register('terminationDate', { required: true })} /></label>}
          {staff.doctor && <>
            <label>Số chứng chỉ<input {...register('medicalLicenseNo', { required: true })} /></label>
            <label>Ngày cấp<input type="date" {...register('licenseIssuedDate')} /></label>
            <label>Ngày hết hạn<input type="date" {...register('licenseExpiryDate')} /></label>
            <label>Học hàm/học vị<input {...register('academicTitle')} /></label>
            <label>Độ dài slot<input type="number" {...register('defaultSlotMinutes', { valueAsNumber: true })} /></label>
            <label className="checkbox"><input type="checkbox" {...register('acceptsOnlineBooking')} />Nhận lịch online</label>
            <label className="wide">Tiểu sử<textarea rows={3} {...register('biography')} /></label>
          </>}
        </div>
        <button type="submit" disabled={busy}>Lưu hồ sơ</button>
      </form>

      <div className="security-actions">
        <h3>Tài khoản và phân quyền</h3>
        <label>Lý do thao tác
          <input value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder="Bắt buộc khi khóa, mở khóa hoặc thu hồi role" />
        </label>
        <div className="action-row">
          <button type="button" className="secondary" disabled={busy || reason.trim().length < 3}
            onClick={() => action.mutate('status')}>
            {staff.accountStatus === 'DISABLED' ? 'Kích hoạt tài khoản' : 'Vô hiệu hóa tài khoản'}
          </button>
          {(staff.accountStatus === 'LOCKED' || staff.lockedUntilUtc) &&
            <button type="button" className="secondary" disabled={busy || reason.trim().length < 3}
              onClick={() => action.mutate('unlock')}>Mở khóa</button>}
        </div>
        <div className="role-list">
          {staff.roles.map((role) => (
            <div key={role.publicId} className="role-item">
              <span><strong>{role.name}</strong><small>{role.branch?.name ?? 'Toàn hệ thống'}</small></span>
              {references.roles.length > 0 &&
                <button type="button" className="danger-link" disabled={busy || reason.trim().length < 3}
                  onClick={() => revoke.mutate(role.publicId)}>Thu hồi</button>}
            </div>
          ))}
        </div>
        {references.roles.length > 0 && (
          <div className="role-grant">
            <select value={roleCode} onChange={(event) => setRoleCode(event.target.value)}>
              {references.roles.map((role) => <option key={role.code} value={role.code}>{role.name}</option>)}
            </select>
            <select value={roleBranch} onChange={(event) => setRoleBranch(event.target.value)}
              disabled={references.roles.find((role) => role.code === roleCode)?.scope === 'GLOBAL'}>
              {references.branches.map((branch) =>
                <option key={branch.publicId} value={branch.publicId}>{branch.name}</option>)}
            </select>
            <input type="datetime-local" value={validTo} onChange={(event) => setValidTo(event.target.value)} />
            <button type="button" disabled={busy || !roleCode} onClick={() => grant.mutate()}>Gán role</button>
          </div>
        )}
      </div>
      {serverError && <div className="form-error" role="alert">{serverError}</div>}
    </section>
  )
}

export function StaffPage() {
  const { user } = useAuth()
  const [branchPublicId, setBranchPublicId] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const isGlobalAdmin = user?.roles.some((role) => role.code === 'ADMIN' && role.branchId === null)
  const referencesQuery = useQuery({
    queryKey: ['staff-references'],
    queryFn: () => apiClient.staff.references(),
  })
  const references = referencesQuery.data?.data

  const effectiveBranchPublicId = branchPublicId
    || (!isGlobalAdmin ? references?.branches[0]?.publicId ?? '' : '')

  const listQuery = useQuery({
    queryKey: ['staff', effectiveBranchPublicId, search],
    queryFn: () => apiClient.staff.list({
      branchPublicId: effectiveBranchPublicId || undefined,
      query: search || undefined,
      page: 1,
      pageSize: 50,
    }),
    enabled: Boolean(references && (isGlobalAdmin || effectiveBranchPublicId)),
  })
  const staff = listQuery.data?.data ?? []
  const selected = staff.find((item) => item.publicId === selectedId) ?? null

  if (referencesQuery.isPending) return <div className="page-state">Đang tải phạm vi nhân sự…</div>
  if (referencesQuery.isError) {
    return <div className="page-state error-state">
      <h1>Không thể mở quản lý nhân sự</h1><p>{message(referencesQuery.error)}</p>
    </div>
  }
  if (!references) return null

  return (
    <div className="staff-page">
      <header>
        <div><span className="eyebrow">WORKFORCE & RBAC</span><h1>Nhân sự và tài khoản</h1>
          <p>Tạo account, quản lý hồ sơ và phân quyền đúng phạm vi chi nhánh.</p></div>
        <button type="button" onClick={() => setShowCreate((value) => !value)}>
          {showCreate ? 'Đóng biểu mẫu' : '+ Thêm nhân viên'}
        </button>
      </header>
      {showCreate &&
        <section className="panel"><h2>Tạo nhân viên</h2>
          <CreateStaffForm references={references} onCreated={(created) => {
            setShowCreate(false); setSelectedId(created.publicId)
          }} />
        </section>}
      <section className="staff-toolbar">
        <input aria-label="Tìm nhân viên" value={search}
          onChange={(event) => setSearch(event.target.value)} placeholder="Tìm theo tên, mã hoặc username…" />
        <select aria-label="Chi nhánh" value={effectiveBranchPublicId}
          onChange={(event) => { setBranchPublicId(event.target.value); setSelectedId(null) }}>
          {isGlobalAdmin && <option value="">Tất cả chi nhánh</option>}
          {references.branches.map((branch) =>
            <option key={branch.publicId} value={branch.publicId}>{branch.name}</option>)}
        </select>
      </section>
      {listQuery.isPending && <div className="page-state">Đang tải danh sách nhân sự…</div>}
      {listQuery.isError && <div className="form-error" role="alert">{message(listQuery.error)}</div>}
      {!listQuery.isPending && !listQuery.isError && staff.length === 0 &&
        <div className="page-state"><h2>Chưa có nhân viên</h2><p>Thêm nhân viên đầu tiên trong phạm vi đã chọn.</p></div>}
      {staff.length > 0 && (
        <div className="staff-workspace">
          <div className="staff-list">
            {staff.map((item) => (
              <button type="button" key={item.publicId}
                className={selectedId === item.publicId ? 'staff-row selected' : 'staff-row'}
                onClick={() => setSelectedId(item.publicId)}>
                <span className="avatar">{item.fullName.slice(0, 1).toUpperCase()}</span>
                <span><strong>{item.fullName}</strong>
                  <small>{item.employeeCode} · {employeeLabels[item.employeeType]} · {item.branch.name}</small></span>
                <span className={`status status-${item.accountStatus.toLowerCase()}`}>{item.accountStatus}</span>
              </button>
            ))}
          </div>
          {selected
            ? <StaffDetail key={selected.publicId} staff={selected} references={references}
                onChanged={(next) => setSelectedId(next.publicId)} />
            : <div className="page-state">Chọn một nhân viên để xem và cập nhật.</div>}
        </div>
      )}
    </div>
  )
}
