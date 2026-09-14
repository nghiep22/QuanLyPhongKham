import type { ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ApiClientError } from '@clinic/generated-api-client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams,
} from 'react-router-dom'
import { z } from 'zod'
import './App.css'
import { useAuth } from './features/auth/auth-context'
import { ChangePasswordPage, ForgotPasswordPage, ResetPasswordPage } from './features/auth/password-pages'
import { StaffPage } from './features/staff/staff-page'
import { PatientLinksPage } from './features/patient-links/patient-links-page'
import { CatalogPage } from './features/catalog/catalog-page'
import { PatientsPage } from './features/patients/patients-page'
import { AppointmentsPage } from './features/appointments/appointments-page'
import { SchedulingPage } from './features/appointments/scheduling-page'
import { ReceptionPage } from './features/reception/reception-page'
import { ClinicalPage } from './features/clinical/clinical-page'
import { PharmacyPage } from './features/pharmacy/pharmacy-page'
import { BillingPage } from './features/billing/billing-page'
import { ReportsPage } from './features/reports/reports-page'

const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Nhập tài khoản, email hoặc số điện thoại.'),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự.'),
})
type LoginValues = z.infer<typeof loginSchema>

function LoginPage() {
  const { user, isRestoring, login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [serverError, setServerError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  })

  if (isRestoring) return <main className="loading-screen">Đang khôi phục phiên đăng nhập…</main>
  if (user) return <Navigate to="/dashboard" replace />

  const submit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      await login(values)
      navigate('/dashboard', { replace: true })
    } catch (error) {
      if (error instanceof ApiClientError) {
        setServerError(error.code === 'ACCOUNT_LOCKED'
          ? 'Tài khoản đang tạm khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau.'
          : 'Tài khoản hoặc mật khẩu không đúng.')
        return
      }
      setServerError('Không thể kết nối hệ thống. Vui lòng thử lại.')
    }
  })

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <span className="eyebrow">PHÒNG KHÁM TƯ NHÂN</span>
        <h1 id="login-title">Đăng nhập nhân viên</h1>
        <p>Dùng tài khoản được quản trị viên cấp để vào hệ thống điều hành phòng khám.</p>
        {(searchParams.has('passwordChanged') || searchParams.has('passwordReset'))
          && <div className="form-success" role="status">Mật khẩu đã được cập nhật. Hãy đăng nhập lại.</div>}
        <form onSubmit={submit} noValidate>
          <label>
            Tài khoản
            <input {...register('identifier')} aria-invalid={Boolean(errors.identifier)}
              autoComplete="username" autoFocus placeholder="Username, email hoặc số điện thoại" />
            {errors.identifier && <span className="field-error">{errors.identifier.message}</span>}
          </label>
          <label>
            Mật khẩu
            <input {...register('password')} aria-invalid={Boolean(errors.password)}
              autoComplete="current-password" type="password" placeholder="Nhập mật khẩu" />
            {errors.password && <span className="field-error">{errors.password.message}</span>}
          </label>
          {serverError && <div className="form-error" role="alert">{serverError}</div>}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
        <div className="auth-links"><Link to="/forgot-password">Quên mật khẩu?</Link></div>
      </section>
    </main>
  )
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isRestoring } = useAuth()
  const location = useLocation()
  if (isRestoring) return <main className="loading-screen">Đang khôi phục phiên đăng nhập…</main>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

function AdminLayout() {
  const { user, logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const canManageStaff = user?.roles.some((role) => role.code === 'ADMIN')
    || user?.permissions.includes('USERS_MANAGE')
  const canManagePatientLinks = user?.roles.some((role) => role.code === 'ADMIN')
    || user?.permissions.includes('PATIENT_PORTAL_LINK_MANAGE')
  const canManageCatalog = user?.roles.some((role) => role.code === 'ADMIN')
    || user?.permissions.includes('MASTER_DATA_MANAGE')
  const canManagePatients = user?.roles.some((role) => role.code === 'ADMIN')
    || user?.permissions.includes('PATIENTS_MANAGE')
  const canManageAppointments = user?.roles.some((role) => role.code === 'ADMIN')
    || user?.permissions.includes('APPOINTMENTS_MANAGE')
  const canManageSchedules = user?.roles.some((role) => role.code === 'ADMIN')
    || user?.permissions.includes('SCHEDULES_MANAGE')
  const canManageReception = user?.roles.some((role) => role.code === 'ADMIN')
    || user?.permissions.includes('QUEUE_MANAGE') || user?.permissions.includes('ENCOUNTERS_CREATE')
  const canUseClinical = user?.permissions.includes('ENCOUNTERS_CLINICAL')
  const canUsePharmacy = user?.permissions.some((permission) =>
    ['PRESCRIPTIONS_WRITE', 'PHARMACY_DISPENSE', 'INVENTORY_MANAGE'].includes(permission))
  const canUseBilling = user?.roles.some((role) => role.code === 'ADMIN')
    || user?.permissions.some((permission) =>
      ['BILLING_MANAGE', 'PAYMENT_COLLECT', 'PAYMENT_REFUND'].includes(permission))
  const canViewReports = user?.roles.some((role) => role.code === 'ADMIN')
    || user?.permissions.includes('REPORTS_VIEW')

  const onLogout = async () => {
    setIsLoggingOut(true)
    await logout()
  }

  return (
    <div className="app-shell">
      <aside>
        <div className="brand">Clinic Admin</div>
        <nav>
          <NavLink to="/dashboard">Tổng quan</NavLink>
          {canManageStaff && <NavLink to="/staff">Nhân sự</NavLink>}
          {canManagePatientLinks && <NavLink to="/patient-links">Liên kết hồ sơ</NavLink>}
          {canManageCatalog && <NavLink to="/catalog">Danh mục</NavLink>}
          {canManagePatients && <NavLink to="/patients">Bệnh nhân</NavLink>}
          {canManageAppointments && <NavLink to="/appointments">Lịch hẹn</NavLink>}
          {canManageSchedules && <NavLink to="/schedules">Ca & slot</NavLink>}
          {canManageReception && <NavLink to="/reception">Tiếp nhận</NavLink>}
          {canUseClinical && <NavLink to="/clinical">Khám bệnh</NavLink>}
          {canUsePharmacy && <NavLink to="/pharmacy">Nhà thuốc</NavLink>}
          {canUseBilling && <NavLink to="/billing">Thu ngân</NavLink>}
          {canViewReports && <NavLink to="/reports">Báo cáo</NavLink>}
          <NavLink to="/change-password">Đổi mật khẩu</NavLink>
        </nav>
        <div className="sidebar-user">
          <strong>{user?.displayName}</strong>
          <span>{user?.roles.map((role) => role.code).join(' · ')}</span>
          <button className="logout" type="button" disabled={isLoggingOut} onClick={() => void onLogout()}>
            {isLoggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </button>
        </div>
      </aside>
      <main className="dashboard"><Outlet /></main>
    </div>
  )
}

function DashboardPage() {
  const { user } = useAuth()
  const modules = [
    ['Nhân sự', 'Tài khoản, hồ sơ bác sĩ và phân quyền theo chi nhánh'],
    ['Lịch hẹn hôm nay', 'Tiếp nhận lịch online và bệnh nhân đến trực tiếp'],
    ['Danh sách chờ', 'Điều phối bệnh nhân theo phòng và bác sĩ'],
    ['Hồ sơ khám', 'Sinh hiệu, chẩn đoán, chỉ định và kết luận'],
    ['Đơn thuốc', 'Kê đơn, kiểm tra liều và hướng dẫn dùng thuốc'],
    ['Thu ngân', 'Hóa đơn, thanh toán và hoàn tiền có kiểm soát'],
  ]
  return (
    <>
      <header>
        <div>
          <span className="eyebrow">TRUNG TÂM ĐIỀU HÀNH</span>
          <h1>Xin chào, {user?.displayName}</h1>
        </div>
      </header>
      <section className="notice">
        <strong>Phiên đăng nhập an toàn đã hoạt động.</strong>
        <span>Quyền truy cập được áp dụng theo vai trò và chi nhánh của tài khoản.</span>
      </section>
      <section className="module-grid">
        {modules.map(([title, description]) => (
          <article key={title}>
            <div className="module-icon">+</div>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/patient-links" element={<PatientLinksPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/schedules" element={<SchedulingPage />} />
        <Route path="/reception" element={<ReceptionPage />} />
        <Route path="/clinical" element={<ClinicalPage />} />
        <Route path="/pharmacy" element={<PharmacyPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
