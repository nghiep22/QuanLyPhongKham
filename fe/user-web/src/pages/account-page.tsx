import { Link } from 'react-router-dom'
import { useAuth } from '../auth'

export function AccountPage() {
  const { user, logout } = useAuth()
  if (!user) return null
  return <main className="container page patient-page account-page">
    <div className="page-intro patient-intro"><div className="patient-intro-copy"><span className="eyebrow">TÀI KHOẢN</span>
      <h1>Thông tin của bạn</h1><p>Quản lý quyền truy cập hồ sơ và bảo mật tài khoản bệnh nhân.</p></div><div className="patient-intro-note"><span className="patient-note-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg></span><div><strong>Không gian sức khỏe cá nhân</strong><small>Truy cập hồ sơ, lịch hẹn và kết quả khám.</small></div></div></div>
    <div className="account-layout"><div className="account-identity">
    <section className="panel account-profile"><span className="avatar large">{user.displayName.charAt(0)}</span>
      <div><h2>{user.displayName}</h2><span className="eyebrow">TÀI KHOẢN BỆNH NHÂN</span></div></section>
    <button className="button button-danger account-logout" onClick={() => void logout()}>Đăng xuất khỏi thiết bị</button></div>
    <section className="panel account-settings">
      <Link to="/profiles"><span className="detail-row-icon">♡</span><span><strong>Hồ sơ được ủy quyền</strong>
        <small>Quản lý hồ sơ của bạn và người thân</small></span><b>↗</b></Link>
      <Link to="/security"><span className="detail-row-icon">♢</span><span><strong>Đổi mật khẩu</strong>
        <small>Thu hồi các phiên cũ để bảo vệ tài khoản</small></span><b>↗</b></Link>
      <Link to="/booking"><span className="detail-row-icon">▦</span><span><strong>Lịch khám của bạn</strong>
        <small>Xem lịch sắp tới, đổi hoặc hủy lịch</small></span><b>↗</b></Link>
      <Link to="/records"><span className="detail-row-icon">◇</span><span><strong>Kết quả khám</strong>
        <small>Tra cứu các hồ sơ đã được công bố</small></span><b>↗</b></Link>
    </section>
    </div>
  </main>
}
