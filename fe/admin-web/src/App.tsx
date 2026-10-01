import type { ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ApiClientError } from '@clinic/generated-api-client'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate, useSearchParams,
} from 'react-router-dom'
import { z } from 'zod'
import './App.css'
import { useAuth } from './features/auth/auth-context'
import { canOpenAdminPath, getAdminAccess, hasStaffRole } from './features/auth/admin-access'
import { ChangePasswordPage, ForgotPasswordPage, ResetPasswordPage } from './features/auth/password-pages'
import { DashboardPage } from './features/dashboard/dashboard-page'

const StaffPage = lazy(() => import('./features/staff/staff-page').then(({ StaffPage }) => ({ default: StaffPage })))
const PatientLinksPage = lazy(() => import('./features/patient-links/patient-links-page').then(({ PatientLinksPage }) => ({ default: PatientLinksPage })))
const CatalogPage = lazy(() => import('./features/catalog/catalog-page').then(({ CatalogPage }) => ({ default: CatalogPage })))
const PatientsPage = lazy(() => import('./features/patients/patients-page').then(({ PatientsPage }) => ({ default: PatientsPage })))
const AppointmentsPage = lazy(() => import('./features/appointments/appointments-page').then(({ AppointmentsPage }) => ({ default: AppointmentsPage })))
const SchedulingPage = lazy(() => import('./features/appointments/scheduling-page').then(({ SchedulingPage }) => ({ default: SchedulingPage })))
const DoctorSchedulesPage = lazy(() => import('./features/appointments/doctor-schedules-page').then(({ DoctorSchedulesPage }) => ({ default: DoctorSchedulesPage })))
const ReceptionPage = lazy(() => import('./features/reception/reception-page').then(({ ReceptionPage }) => ({ default: ReceptionPage })))
const ClinicalPage = lazy(() => import('./features/clinical/clinical-page').then(({ ClinicalPage }) => ({ default: ClinicalPage })))
const PharmacyPage = lazy(() => import('./features/pharmacy/pharmacy-page').then(({ PharmacyPage }) => ({ default: PharmacyPage })))
const BillingPage = lazy(() => import('./features/billing/billing-page').then(({ BillingPage }) => ({ default: BillingPage })))
const ReportsPage = lazy(() => import('./features/reports/reports-page').then(({ ReportsPage }) => ({ default: ReportsPage })))

const pageTitles: Record<string, string> = {
  '/dashboard': 'Tổng quan', '/staff': 'Nhân sự', '/patient-links': 'Liên kết hồ sơ',
  '/catalog': 'Danh mục', '/patients': 'Bệnh nhân', '/appointments': 'Lịch hẹn',
  '/schedules': 'Ca và khung giờ', '/my-schedules': 'Lịch của tôi', '/reception': 'Tiếp nhận',
  '/clinical': 'Khám bệnh', '/pharmacy': 'Nhà thuốc', '/billing': 'Thu ngân',
  '/reports': 'Báo cáo', '/change-password': 'Đổi mật khẩu',
  '/login': 'Đăng nhập nhân viên', '/forgot-password': 'Quên mật khẩu', '/reset-password': 'Đặt lại mật khẩu',
}

function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = `${pageTitles[pathname] ?? 'Quản trị'} | Phòng khám AN TÂM`
  }, [pathname])
  return null
}

type NavItem = { to: string; label: string; code: string; allowed: boolean }

function NavGroup({ title, items, onNavigate }: { title: string; items: NavItem[]; onNavigate: () => void }) {
  const available = items.filter((item) => item.allowed)
  if (!available.length) return null
  return <div className="sidebar-group">
    <span className="sidebar-group-title">{title}</span>
    {available.map((item) => <NavLink key={item.to} to={item.to} onClick={onNavigate}>
      <span className="nav-code" aria-hidden="true">{item.code}</span><span>{item.label}</span>
    </NavLink>)}
  </div>
}

const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Nhập tài khoản, email hoặc số điện thoại.'),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự.'),
})
type LoginValues = z.infer<typeof loginSchema>

function LoginPage() {
  const { user, isRestoring, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [serverError, setServerError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  })

  if (isRestoring) return <main className="loading-screen">Đang khôi phục phiên đăng nhập…</main>
  const requestedPath = (location.state as { from?: string } | null)?.from
  const destination = requestedPath?.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/dashboard'
  if (user) return hasStaffRole(user) ? <Navigate to={destination} replace /> : <StaffAccessMessage />

  const submit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      await login(values)
      navigate(destination, { replace: true })
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
        <div className="auth-brand"><span className="brand-mark" aria-hidden="true">✚</span><span>Phòng khám <strong>AN TÂM</strong></span></div>
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

function StaffAccessMessage() {
  const { logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const onLogout = async () => {
    setIsLoggingOut(true)
    try { await logout() } finally { setIsLoggingOut(false) }
  }
  return <main className="auth-shell"><section className="auth-card" role="status">
    <div className="auth-brand"><span className="brand-mark" aria-hidden="true">✚</span><span>Phòng khám <strong>AN TÂM</strong></span></div>
    <span className="eyebrow">CỔNG NHÂN VIÊN</span>
    <h1>Tài khoản chưa có quyền truy cập</h1>
    <p>Đây là khu vực làm việc của nhân viên phòng khám. Tài khoản bệnh nhân vui lòng sử dụng cổng bệnh nhân.</p>
    <button type="button" disabled={isLoggingOut} onClick={() => void onLogout()}>
      {isLoggingOut ? 'Đang đăng xuất…' : 'Đăng xuất và dùng tài khoản nhân viên'}
    </button>
  </section></main>
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isRestoring } = useAuth()
  const location = useLocation()
  if (isRestoring) return <main className="loading-screen">Đang khôi phục phiên đăng nhập…</main>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!hasStaffRole(user)) return <StaffAccessMessage />
  if (!canOpenAdminPath(user, location.pathname)) return <main className="restricted-page">
    <section className="panel restricted-card">
      <span className="eyebrow">PHÂN QUYỀN</span>
      <h1>Chưa có quyền mở phân hệ này</h1>
      <p>Tài khoản của bạn chưa được cấp quyền cho chức năng đang truy cập.</p>
      <Link to="/dashboard">Về bảng điều hành</Link>
    </section>
  </main>
  return children
}

function AdminLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [mobileNavPath, setMobileNavPath] = useState<string | null>(null)
  const isMobileNavOpen = mobileNavPath === location.pathname
  const {
    canManageStaff, canManagePatientLinks, canManageCatalog, canManagePatients,
    canManageAppointments, canManageSchedules, canManageReception, canUseClinical,
    canUsePharmacy, canUseBilling, canViewReports,
  } = getAdminAccess(user)

  useEffect(() => {
    if (!isMobileNavOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavPath(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isMobileNavOpen])

  const onLogout = async () => {
    setIsLoggingOut(true)
    await logout()
  }

  const navGroups = [
    { title: 'Tổng quan', items: [
      { to: '/dashboard', label: 'Bảng điều hành', code: '01', allowed: true },
    ] },
    { title: 'Vận hành', items: [
      { to: '/appointments', label: 'Lịch hẹn', code: 'LH', allowed: canManageAppointments },
      { to: '/reception', label: 'Tiếp nhận', code: 'TN', allowed: canManageReception },
      { to: '/clinical', label: 'Khám bệnh', code: 'KB', allowed: canUseClinical },
      { to: '/schedules', label: 'Ca và khung giờ', code: 'CA', allowed: canManageSchedules },
      { to: '/my-schedules', label: 'Lịch của tôi', code: 'BS', allowed: Boolean(user?.roles.some((role) => role.code === 'DOCTOR')) },
    ] },
    { title: 'Hồ sơ và dịch vụ', items: [
      { to: '/patients', label: 'Bệnh nhân', code: 'BN', allowed: canManagePatients },
      { to: '/patient-links', label: 'Liên kết hồ sơ', code: 'LK', allowed: canManagePatientLinks },
      { to: '/pharmacy', label: 'Nhà thuốc', code: 'NT', allowed: canUsePharmacy },
      { to: '/billing', label: 'Thu ngân', code: 'TH', allowed: canUseBilling },
    ] },
    { title: 'Quản lý', items: [
      { to: '/staff', label: 'Nhân sự', code: 'NS', allowed: canManageStaff },
      { to: '/catalog', label: 'Danh mục', code: 'DM', allowed: canManageCatalog },
      { to: '/reports', label: 'Báo cáo', code: 'BC', allowed: canViewReports },
    ] },
  ]

  return (
    <div className={`app-shell${isMobileNavOpen ? ' mobile-nav-open' : ''}`}>
      <a className="skip-link" href="#main-content">Bỏ qua điều hướng</a>
      {isMobileNavOpen && <button className="mobile-nav-backdrop" type="button" aria-label="Đóng menu điều hướng"
        onClick={() => setMobileNavPath(null)} />}
      <aside id="admin-navigation" className="admin-sidebar" aria-label="Điều hướng quản trị">
        <div className="sidebar-head">
          <Link className="brand" to="/dashboard" onClick={() => setMobileNavPath(null)}>
            <span className="brand-mark" aria-hidden="true">✚</span>
            <span><strong>AN TÂM</strong><small>QUẢN LÝ PHÒNG KHÁM</small></span>
          </Link>
          <button className="sidebar-close" type="button" aria-label="Đóng menu" onClick={() => setMobileNavPath(null)}>×</button>
        </div>
        <nav className="sidebar-nav" aria-label="Các phân hệ">
          {navGroups.map((group) => <NavGroup key={group.title} {...group} onNavigate={() => setMobileNavPath(null)} />)}
        </nav>
        <div className="sidebar-user">
          <span className="user-avatar" aria-hidden="true">{user?.displayName?.slice(0, 1).toLocaleUpperCase('vi-VN')}</span>
          <div><strong>{user?.displayName}</strong><span>{user?.roles.map((role) => role.code).join(' · ')}</span></div>
          <NavLink to="/change-password" onClick={() => setMobileNavPath(null)}>Đổi mật khẩu</NavLink>
          <button className="logout" type="button" disabled={isLoggingOut} onClick={() => void onLogout()}>
            {isLoggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </button>
        </div>
      </aside>
      <main className="dashboard" id="main-content">
        <div className="workspace-topbar">
          <div className="workspace-topbar-left">
            <button className="mobile-nav-toggle" type="button" aria-controls="admin-navigation"
              aria-expanded={isMobileNavOpen} aria-label={isMobileNavOpen ? 'Đóng menu' : 'Mở menu'}
              onClick={() => setMobileNavPath(isMobileNavOpen ? null : location.pathname)}><span /><span /><span /></button>
            <div className="workspace-breadcrumb"><span>Không gian làm việc</span><b aria-hidden="true">/</b><strong>{pageTitles[location.pathname] ?? 'Quản trị'}</strong></div>
          </div>
          <div className="workspace-topbar-right"><span className="workspace-date">{new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date())}</span><span className="topbar-avatar" title={user?.displayName}>{user?.displayName?.slice(0, 1).toLocaleUpperCase('vi-VN')}</span></div>
        </div>
        <Suspense fallback={<div className="page-state panel" role="status">Đang mở phân hệ…</div>}><Outlet /></Suspense>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <>
    <DocumentTitle />
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
        <Route path="/my-schedules" element={<DoctorSchedulesPage />} />
        <Route path="/reception" element={<ReceptionPage />} />
        <Route path="/clinical" element={<ClinicalPage />} />
        <Route path="/pharmacy" element={<PharmacyPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </>
  )
}
