import type { ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ApiClientError } from '@clinic/generated-api-client'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import './App.css'
import { useAuth } from './features/auth/auth-context'

const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Nhập tài khoản, email hoặc số điện thoại.'),
  password: z.string().min(8, 'Mật khẩu phải có ít nhất 8 ký tự.'),
})
type LoginValues = z.infer<typeof loginSchema>

function LoginPage() {
  const { user, isRestoring, login } = useAuth()
  const navigate = useNavigate()
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
        <form onSubmit={submit} noValidate>
          <label>
            Tài khoản
            <input
              {...register('identifier')}
              aria-invalid={Boolean(errors.identifier)}
              autoComplete="username"
              autoFocus
              placeholder="Username, email hoặc số điện thoại"
            />
            {errors.identifier && <span className="field-error">{errors.identifier.message}</span>}
          </label>
          <label>
            Mật khẩu
            <input
              {...register('password')}
              aria-invalid={Boolean(errors.password)}
              autoComplete="current-password"
              type="password"
              placeholder="Nhập mật khẩu"
            />
            {errors.password && <span className="field-error">{errors.password.message}</span>}
          </label>
          {serverError && <div className="form-error" role="alert">{serverError}</div>}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
        </form>
      </section>
    </main>
  )
}

function DashboardPage() {
  const { user, logout } = useAuth()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const modules = [
    ['Lịch hẹn hôm nay', 'Tiếp nhận lịch online và bệnh nhân đến trực tiếp'],
    ['Danh sách chờ', 'Điều phối bệnh nhân theo phòng và bác sĩ'],
    ['Hồ sơ khám', 'Sinh hiệu, chẩn đoán, chỉ định và kết luận'],
    ['Đơn thuốc', 'Kê đơn, kiểm tra liều và hướng dẫn dùng thuốc'],
    ['Thu ngân', 'Hóa đơn, thanh toán và hoàn tiền có kiểm soát'],
    ['Báo cáo', 'Doanh thu, lượt khám và hiệu suất vận hành'],
  ]

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
          <a href="#appointments">Lịch hẹn</a>
          <a href="#patients">Bệnh nhân</a>
          <a href="#medical-records">Khám bệnh</a>
          <a href="#billing">Thu ngân</a>
        </nav>
      </aside>
      <main className="dashboard">
        <header>
          <div>
            <span className="eyebrow">TRUNG TÂM ĐIỀU HÀNH</span>
            <h1>Xin chào, {user?.displayName}</h1>
            <p className="role-summary">
              {user?.roles.map((role) => role.code).join(' · ') || 'Chưa được gán vai trò'}
            </p>
          </div>
          <button className="logout" type="button" disabled={isLoggingOut} onClick={() => void onLogout()}>
            {isLoggingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}
          </button>
        </header>
        <section className="notice">
          <strong>Phiên đăng nhập an toàn đã hoạt động.</strong>
          <span>Quyền truy cập sẽ được áp dụng theo vai trò và chi nhánh của tài khoản.</span>
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
      </main>
    </div>
  )
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isRestoring } = useAuth()
  const location = useLocation()
  if (isRestoring) return <main className="loading-screen">Đang khôi phục phiên đăng nhập…</main>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
