import { ApiClientError } from '@clinic/generated-api-client'
import type { PatientRegistrationRequest } from '@clinic/generated-api-types'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { api, errorMessage, localDate } from '../api'
import { useAuth } from '../auth'

const passwordSchema = z.string().min(12, 'Mật khẩu cần ít nhất 12 ký tự.').max(200, 'Mật khẩu tối đa 200 ký tự.').regex(/[a-z]/, 'Cần có chữ thường.')
  .regex(/[A-Z]/, 'Cần có chữ hoa.').regex(/[0-9]/, 'Cần có chữ số.')
const registrationSchema = z.object({
  fullName: z.string().trim().min(2, 'Nhập họ tên đầy đủ.').max(200, 'Họ tên tối đa 200 ký tự.'),
  dateOfBirth: z.iso.date(), gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  contactChannel: z.enum(['EMAIL', 'SMS']), contact: z.string().trim().min(3), password: passwordSchema,
  confirmPassword: z.string(),
}).superRefine((value, context) => {
  if (value.dateOfBirth > localDate() || value.dateOfBirth < '1900-01-01')
    context.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Ngày sinh không hợp lệ.' })
  if (value.password !== value.confirmPassword) context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Mật khẩu xác nhận không khớp.' })
  if (value.contactChannel === 'EMAIL' && !z.email().safeParse(value.contact).success)
    context.addIssue({ code: 'custom', path: ['contact'], message: 'Email không hợp lệ.' })
  if (value.contactChannel === 'SMS' && !/^\+?[0-9]{9,15}$/.test(value.contact.replace(/[ .-]/g, '')))
    context.addIssue({ code: 'custom', path: ['contact'], message: 'Số điện thoại không hợp lệ.' })
})
type Registration = z.infer<typeof registrationSchema>
const initial: Registration = { fullName: '', dateOfBirth: '', gender: 'OTHER', contactChannel: 'EMAIL', contact: '', password: '', confirmPassword: '' }

function FormLayout({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <main className="auth-page">
    <aside className="auth-aside"><Link to="/" className="brand inverse"><span className="brand-mark" aria-hidden="true">✚</span><span><strong>AN TÂM</strong><small>PHÒNG KHÁM TƯ NHÂN</small></span></Link>
      <div className="auth-aside-content"><span className="auth-aside-label">CHĂM SÓC CHỦ ĐỘNG</span><h2>An tâm hơn<br />trong mỗi bước<br /><em>chăm sóc sức khỏe.</em></h2><p>Một tài khoản để đặt lịch khám, theo dõi kết quả và chăm sóc những người bạn yêu thương.</p>
        <div className="auth-illustration" aria-hidden="true"><svg viewBox="0 0 360 176" fill="none"><rect x="18" y="22" width="324" height="132" rx="16" fill="white" fillOpacity=".08" stroke="white" strokeOpacity=".16" /><rect x="37" y="41" width="48" height="48" rx="14" fill="#C4E4D1" /><path d="M61 52v26M48 65h26" stroke="#126C5A" strokeWidth="5" strokeLinecap="round" /><rect x="101" y="44" width="117" height="8" rx="4" fill="white" fillOpacity=".72" /><rect x="101" y="63" width="166" height="6" rx="3" fill="white" fillOpacity=".25" /><rect x="101" y="79" width="93" height="6" rx="3" fill="white" fillOpacity=".25" /><path d="M38 120h57l11-18 16 35 18-29 10 12h47" stroke="#A9D9BD" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><rect x="234" y="109" width="87" height="24" rx="12" fill="#C4E4D1" /><path d="m251 121 4 4 7-8" stroke="#126C5A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><path d="M272 121h32" stroke="#126C5A" strokeWidth="2" strokeLinecap="round" /></svg></div>
        <ul className="auth-benefits"><li><span aria-hidden="true">01</span>Chủ động chọn lịch khám</li><li><span aria-hidden="true">02</span>Theo dõi hồ sơ tại một nơi</li><li><span aria-hidden="true">03</span>Kết nối hồ sơ người thân</li></ul>
      </div><div className="auth-aside-foot"><span className="auth-aside-dot" aria-hidden="true" /><span>Đồng hành cùng bạn mỗi ngày</span></div>
    </aside>
    <section className="auth-form-wrap"><div className="auth-form"><Link to="/" className="back-link"><span aria-hidden="true">←</span> Về trang chủ</Link><div className="auth-form-head"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{children}</div></section>
  </main>
}
function RegistrationProgress({ step }: { step: 'details' | 'otp' | 'done' }) {
  const current = ['details', 'otp', 'done'].indexOf(step)
  return <ol className="auth-progress" aria-label="Tiến trình đăng ký">{['Thông tin', 'Xác minh', 'Hoàn tất'].map((label, index) => <li key={label} className={index < current ? 'is-complete' : index === current ? 'is-current' : ''} aria-current={index === current ? 'step' : undefined}><span aria-hidden="true">{index < current ? '✓' : index + 1}</span><strong>{label}</strong></li>)}</ol>
}
function Alert({ kind, children }: { kind: 'error' | 'success'; children: React.ReactNode }) {
  return <div className={kind} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function AuthPage() {
  const { user, login } = useAuth(); const navigate = useNavigate(); const location = useLocation()
  const state = location.state as { from?: string; identifier?: string } | null
  const destination = state?.from || '/'
  const [identifier, setIdentifier] = useState(state?.identifier ?? ''); const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  if (user) return <Navigate to={destination} replace />
  const submit = async (event: FormEvent) => { event.preventDefault(); setError('')
    if (identifier.trim().length < 3 || password.length < 8) { setError('Nhập tài khoản và mật khẩu hợp lệ.'); return }
    setBusy(true)
    try { await login(identifier.trim(), password); navigate(destination, { replace: true }) }
    catch (cause) { setError(cause instanceof Error && cause.message.includes('chỉ dành') ? cause.message
      : cause instanceof ApiClientError && [400, 401].includes(cause.status) ? 'Tài khoản hoặc mật khẩu không đúng.'
        : errorMessage(cause)) }
    finally { setBusy(false) }
  }
  return <FormLayout eyebrow="CỔNG BỆNH NHÂN" title="Đăng nhập"><p className="auth-lead">Chào mừng bạn trở lại. Đăng nhập để quản lý lịch khám và hồ sơ sức khỏe.</p>
    {new URLSearchParams(location.search).has('passwordReset') && <Alert kind="success">Mật khẩu đã được đặt lại. Vui lòng đăng nhập.</Alert>}
    <form onSubmit={(event) => void submit(event)}><label>Email hoặc số điện thoại<input autoComplete="username" autoFocus placeholder="Nhập email hoặc số điện thoại" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label>
      <label>Mật khẩu<input type="password" autoComplete="current-password" placeholder="Nhập mật khẩu của bạn" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <Link className="forgot-link" to="/forgot-password">Quên mật khẩu?</Link>{error && <Alert kind="error">{error}</Alert>}
      <button className="button full" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'} →</button></form>
    <p className="auth-switch">Chưa có tài khoản? <Link to="/register">Đăng ký bệnh nhân</Link></p></FormLayout>
}

export function RegisterPage() {
  const [form, setForm] = useState<Registration>(initial); const [step, setStep] = useState<'details' | 'otp' | 'done'>('details')
  const [challengeId, setChallengeId] = useState(''); const [otp, setOtp] = useState(''); const [patientCode, setPatientCode] = useState('')
  const [resendSeconds, setResendSeconds] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const retry = useRef<{ payload: string; key: string } | null>(null)
  useEffect(() => { if (resendSeconds <= 0) return; const timer = window.setTimeout(() => setResendSeconds((n) => n - 1), 1000); return () => window.clearTimeout(timer) }, [resendSeconds])
  const requestOtp = async (resend = false) => {
    const parsed = registrationSchema.safeParse(form)
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Thông tin chưa hợp lệ.'); return }
    const body: PatientRegistrationRequest = { contactChannel: form.contactChannel, contact: form.contact.trim(), password: form.password,
      fullName: form.fullName.trim(), dateOfBirth: form.dateOfBirth, gender: form.gender }
    const payload = JSON.stringify(body)
    if (resend || !retry.current || retry.current.payload !== payload) retry.current = { payload, key: crypto.randomUUID() }
    setBusy(true); setError('')
    try { const response = await api.auth.requestPatientRegistration(body, retry.current.key)
      setChallengeId(response.data.challengeId); setResendSeconds(response.data.resendAfter); setStep('otp') }
    catch (cause) { if (cause instanceof ApiClientError && cause.code === 'IDEMPOTENCY_KEY_REUSED') retry.current = null; setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }
  const verify = async (event: FormEvent) => { event.preventDefault()
    if (!/^\d{6}$/.test(otp)) { setError('OTP phải gồm đúng 6 chữ số.'); return }
    setBusy(true); setError('')
    try { const response = await api.auth.verifyPatientRegistration({ challengeId, otp }); setPatientCode(response.data.patient.code); setStep('done'); setForm((value) => ({ ...value, password: '', confirmPassword: '' })) }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) }
  }
  if (step === 'done') return <FormLayout eyebrow="ĐĂNG KÝ THÀNH CÔNG" title="Chào mừng bạn!"><RegistrationProgress step={step} /><Alert kind="success">Hồ sơ bệnh nhân {patientCode} đã được tạo và xác minh.</Alert><Link className="button full" to="/login" state={{ identifier: form.contact.trim() }}>Đăng nhập ngay →</Link></FormLayout>
  if (step === 'otp') return <FormLayout eyebrow="XÁC MINH LIÊN HỆ" title="Nhập mã OTP"><p className="auth-lead">Nếu thông tin có thể đăng ký, mã 6 số đã được gửi đến kênh liên hệ của bạn.</p><RegistrationProgress step={step} /><form onSubmit={(event) => void verify(event)}><label>Mã OTP<input className="auth-otp-input" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))} /></label>{error && <Alert kind="error">{error}</Alert>}<button className="button full" disabled={busy}>{busy ? 'Đang xác minh…' : 'Xác minh và tạo tài khoản →'}</button></form><div className="otp-actions"><button type="button" className="text-button" disabled={busy || resendSeconds > 0} onClick={() => void requestOtp(true)}>{resendSeconds ? `Gửi lại sau ${resendSeconds}s` : 'Gửi lại mã OTP'}</button><button type="button" className="text-button" disabled={busy} onClick={() => { setStep('details'); setError(''); setOtp('') }}>Sửa thông tin đăng ký</button></div></FormLayout>
  return <FormLayout eyebrow="TẠO TÀI KHOẢN" title="Đăng ký bệnh nhân"><p className="auth-lead">Điền thông tin của bạn để bắt đầu sử dụng dịch vụ trực tuyến.</p>
    <RegistrationProgress step={step} />
    <form onSubmit={(event) => { event.preventDefault(); void requestOtp() }}><label>Họ và tên<input autoComplete="name" value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
      <div className="form-row"><label>Ngày sinh<input type="date" max={localDate()} value={form.dateOfBirth} onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })} /></label><label>Giới tính<select value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value as Registration['gender'] })}><option value="OTHER">Khác</option><option value="MALE">Nam</option><option value="FEMALE">Nữ</option></select></label></div>
      <div className="form-row"><label>Nhận OTP qua<select value={form.contactChannel} onChange={(event) => setForm({ ...form, contactChannel: event.target.value as Registration['contactChannel'], contact: '' })}><option value="EMAIL">Email</option><option value="SMS">SMS</option></select></label><label>{form.contactChannel === 'EMAIL' ? 'Email' : 'Số điện thoại'}<input type={form.contactChannel === 'EMAIL' ? 'email' : 'tel'} value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} /></label></div>
      <div className="form-row"><label>Mật khẩu<input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><label>Xác nhận mật khẩu<input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} /></label></div><p className="hint">Tối thiểu 12 ký tự, gồm chữ hoa, chữ thường và số.</p>
      {error && <Alert kind="error">{error}</Alert>}<button className="button full" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi mã OTP →'}</button></form><p className="auth-switch">Đã có tài khoản? <Link to="/login">Đăng nhập</Link></p></FormLayout>
}

export function ForgotPage() {
  const [identifier, setIdentifier] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); if (identifier.trim().length < 3) { setError('Nhập email, số điện thoại hoặc tên đăng nhập.'); return }
    setBusy(true); setError(''); try { await api.auth.requestPasswordReset({ identifier: identifier.trim() }); setSent(true) }
    catch { setError('Không thể gửi yêu cầu lúc này. Vui lòng thử lại.') } finally { setBusy(false) } }
  return <FormLayout eyebrow="BẢO MẬT TÀI KHOẢN" title="Quên mật khẩu">{sent ? <Alert kind="success">Nếu thông tin khớp với tài khoản, hệ thống đã gửi liên kết đặt lại mật khẩu.</Alert> : <><p className="auth-lead">Nhập kênh liên hệ đã đăng ký hoặc tên đăng nhập để nhận hướng dẫn đặt lại mật khẩu.</p><form onSubmit={(event) => void submit(event)}><label>Email, số điện thoại hoặc tên đăng nhập<input autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label>{error && <Alert kind="error">{error}</Alert>}<button className="button full" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi liên kết khôi phục →'}</button></form></>}<p className="auth-switch"><Link to="/reset-password">Đã có mã đặt lại? Nhập mã</Link></p><p className="auth-switch"><Link to="/login">← Quay lại đăng nhập</Link></p></FormLayout>
}

export function ResetPage() {
  const { clear } = useAuth(); const navigate = useNavigate()
  const [token, setToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '')
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  useEffect(() => { if (window.location.hash) window.history.replaceState(null, '', '/reset-password') }, [])
  const submit = async (event: FormEvent) => { event.preventDefault(); const checked = passwordSchema.safeParse(password)
    if (!token.trim()) { setError('Nhập mã đặt lại mật khẩu.'); return }
    if (!checked.success) { setError(checked.error.issues[0]?.message ?? 'Mật khẩu chưa hợp lệ.'); return }
    if (password !== confirm) { setError('Mật khẩu xác nhận không khớp.'); return }
    setBusy(true); setError(''); try { await api.auth.resetPassword({ token: token.trim(), newPassword: password }); clear(); navigate('/login?passwordReset=1', { replace: true }) }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) } }
  return <FormLayout eyebrow="BẢO MẬT TÀI KHOẢN" title="Đặt lại mật khẩu"><p className="auth-lead">Mã đặt lại chỉ dùng một lần và có thời hạn. Mật khẩu mới sẽ vô hiệu hóa các phiên cũ.</p><form onSubmit={(event) => void submit(event)}><label>Mã đặt lại<input autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Mã trong liên kết khôi phục" /></label><label>Mật khẩu mới<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Xác nhận mật khẩu<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label><p className="hint">Tối thiểu 12 ký tự, gồm chữ hoa, chữ thường và số.</p>{error && <Alert kind="error">{error}</Alert>}<button className="button full" disabled={busy}>{busy ? 'Đang cập nhật…' : 'Đặt lại mật khẩu →'}</button></form><p className="auth-switch"><Link to="/forgot-password">Yêu cầu mã mới</Link></p></FormLayout>
}

export function SecurityPage() {
  const { user, clear } = useAuth(); const navigate = useNavigate()
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (event: FormEvent) => { event.preventDefault(); const checked = passwordSchema.safeParse(next)
    if (current.length < 8 || current.length > 200) { setError('Mật khẩu hiện tại cần từ 8 đến 200 ký tự.'); return }
    if (!checked.success) { setError(checked.error.issues[0]?.message ?? 'Mật khẩu chưa hợp lệ.'); return }
    if (next === current) { setError('Mật khẩu mới phải khác mật khẩu hiện tại.'); return }
    if (next !== confirm) { setError('Mật khẩu xác nhận không khớp.'); return }
    setBusy(true); setError(''); try { await api.auth.changePassword({ currentPassword: current, newPassword: next }); clear(); navigate('/login', { replace: true }) }
    catch (cause) { setError(errorMessage(cause)) } finally { setBusy(false) } }
  return <main className="container page security-page"><div className="page-intro"><span className="eyebrow">TÀI KHOẢN BỆNH NHÂN</span><h1>Bảo mật tài khoản</h1><p>Xin chào {user?.displayName}. Sau khi đổi mật khẩu, bạn cần đăng nhập lại.</p></div><div className="security-layout"><section className="panel security-panel"><div className="security-panel-head"><span className="security-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg></span><div><h2>Đổi mật khẩu</h2><p>Cập nhật mật khẩu cho tài khoản của bạn.</p></div></div><form onSubmit={(event) => void submit(event)}><label>Mật khẩu hiện tại<input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /></label><label>Mật khẩu mới<input type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} /></label><label>Xác nhận mật khẩu<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>{error && <Alert kind="error">{error}</Alert>}<div className="security-actions"><Link to="/account" className="text-button">Về tài khoản</Link><button className="button" disabled={busy}>{busy ? 'Đang cập nhật…' : 'Đổi mật khẩu'}</button></div></form></section><aside className="security-guidance"><span className="eyebrow">MẬT KHẨU MỚI</span><h2>Thêm một bước an tâm</h2><p>Chọn mật khẩu riêng cho tài khoản phòng khám của bạn.</p><ul><li>Ít nhất 12 ký tự</li><li>Có chữ hoa và chữ thường</li><li>Có ít nhất một chữ số</li><li>Khác với mật khẩu hiện tại</li></ul><div className="security-session-note">Sau khi cập nhật, các phiên đăng nhập cũ sẽ kết thúc. Hãy đăng nhập lại bằng mật khẩu mới.</div></aside></div></main>
}
