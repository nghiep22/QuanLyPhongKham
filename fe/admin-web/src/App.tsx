import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import './App.css'

function LoginPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">PHÒNG KHÁM TƯ NHÂN</span>
        <h1>Đăng nhập nhân viên</h1>
        <p>Khung giao diện đã sẵn sàng để kết nối API xác thực và phân quyền.</p>
        <form onSubmit={(event) => event.preventDefault()}>
          <label>
            Tài khoản
            <input autoComplete="username" placeholder="Nhập tài khoản" />
          </label>
          <label>
            Mật khẩu
            <input autoComplete="current-password" type="password" placeholder="Nhập mật khẩu" />
          </label>
          <button type="submit">Đăng nhập</button>
        </form>
      </section>
    </main>
  )
}

function DashboardPage() {
  const modules = [
    ['Lịch hẹn hôm nay', 'Tiếp nhận lịch online và bệnh nhân đến trực tiếp'],
    ['Danh sách chờ', 'Điều phối bệnh nhân theo phòng và bác sĩ'],
    ['Hồ sơ khám', 'Sinh hiệu, chẩn đoán, chỉ định và kết luận'],
    ['Đơn thuốc', 'Kê đơn, kiểm tra liều và hướng dẫn dùng thuốc'],
    ['Thu ngân', 'Hóa đơn, thanh toán và hoàn tiền có kiểm soát'],
    ['Báo cáo', 'Doanh thu, lượt khám và hiệu suất vận hành'],
  ]

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
            <h1>Chào buổi sáng</h1>
          </div>
          <NavLink className="logout" to="/login">Đăng xuất</NavLink>
        </header>
        <section className="notice">
          <strong>Đã hoàn tất khung dự án.</strong>
          <span>Các màn hình nghiệp vụ sẽ được triển khai theo PROJECT_PLAN.md.</span>
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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
