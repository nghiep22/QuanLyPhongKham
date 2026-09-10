import { zodResolver } from '@hookform/resolvers/zod'
import { ApiClientError } from '@clinic/generated-api-client'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { apiClient } from '../../shared/api/client'
import { useAuth } from './auth-context'

const strongPassword = z.string()
  .min(12, 'Mật khẩu phải có ít nhất 12 ký tự.')
  .regex(/[a-z]/, 'Cần ít nhất một chữ thường.')
  .regex(/[A-Z]/, 'Cần ít nhất một chữ hoa.')
  .regex(/[0-9]/, 'Cần ít nhất một chữ số.')

const forgotSchema = z.object({
  identifier: z.string().trim().min(3, 'Nhập tài khoản, email hoặc số điện thoại.'),
})
type ForgotValues = z.infer<typeof forgotSchema>

const newPasswordSchema = z.object({
  newPassword: strongPassword,
  confirmPassword: z.string(),
}).refine((value) => value.newPassword === value.confirmPassword, {
  path: ['confirmPassword'], message: 'Mật khẩu xác nhận không khớp.',
})
type NewPasswordValues = z.infer<typeof newPasswordSchema>

const changeSchema = newPasswordSchema.and(z.object({
  currentPassword: z.string().min(8, 'Nhập mật khẩu hiện tại.'),
}))
type ChangeValues = z.infer<typeof changeSchema>

function PasswordFields({ register, errors }: {
  register: ReturnType<typeof useForm<NewPasswordValues>>['register']
  errors: ReturnType<typeof useForm<NewPasswordValues>>['formState']['errors']
}) {
  return <>
    <label>Mật khẩu mới
      <input type="password" autoComplete="new-password" {...register('newPassword')} />
      {errors.newPassword && <span className="field-error">{errors.newPassword.message}</span>}
    </label>
    <label>Xác nhận mật khẩu mới
      <input type="password" autoComplete="new-password" {...register('confirmPassword')} />
      {errors.confirmPassword && <span className="field-error">{errors.confirmPassword.message}</span>}
    </label>
  </>
}

export function ForgotPasswordPage() {
  const [accepted, setAccepted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema), defaultValues: { identifier: '' },
  })
  const submit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      await apiClient.auth.requestPasswordReset(values)
      setAccepted(true)
    } catch {
      setServerError('Không thể gửi yêu cầu lúc này. Vui lòng thử lại sau.')
    }
  })
  return <main className="auth-shell"><section className="auth-card">
    <span className="eyebrow">KHÔI PHỤC TÀI KHOẢN</span>
    <h1>Quên mật khẩu</h1>
    {accepted ? <div className="form-success" role="status">
      Nếu thông tin khớp với tài khoản có kênh liên hệ, hệ thống đã gửi liên kết đặt lại mật khẩu.
    </div> : <>
      <p>Nhập username, email hoặc số điện thoại. Phản hồi sẽ không tiết lộ tài khoản có tồn tại hay không.</p>
      <form onSubmit={submit} noValidate>
        <label>Tài khoản
          <input autoComplete="username" autoFocus {...register('identifier')} />
          {errors.identifier && <span className="field-error">{errors.identifier.message}</span>}
        </label>
        {serverError && <div className="form-error" role="alert">{serverError}</div>}
        <button disabled={isSubmitting}>{isSubmitting ? 'Đang gửi…' : 'Gửi liên kết khôi phục'}</button>
      </form>
    </>}
    <div className="auth-links"><Link to="/login">Quay lại đăng nhập</Link></div>
  </section></main>
}

export function ResetPasswordPage() {
  const { resetPassword } = useAuth()
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token'))
  const [completed, setCompleted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<NewPasswordValues>({ resolver: zodResolver(newPasswordSchema) })
  useEffect(() => {
    if (token) window.history.replaceState(null, '', '/reset-password')
  }, [token])
  if (!token) return <main className="auth-shell"><section className="auth-card">
    <h1>Liên kết không hợp lệ</h1><p>Liên kết đặt lại mật khẩu bị thiếu mã xác nhận.</p>
    <div className="auth-links"><Link to="/forgot-password">Yêu cầu liên kết mới</Link></div>
  </section></main>
  const submit = form.handleSubmit(async ({ newPassword }) => {
    setServerError(null)
    try {
      await resetPassword(token, newPassword)
      setCompleted(true)
    } catch (error) {
      setServerError(error instanceof ApiClientError
        ? error.code === 'INVALID_OR_EXPIRED_RESET_TOKEN'
          ? 'Liên kết không hợp lệ, đã hết hạn hoặc đã được sử dụng.'
          : error.code === 'PASSWORD_REUSE_NOT_ALLOWED'
            ? 'Mật khẩu mới phải khác mật khẩu hiện tại.'
            : 'Không thể đặt lại mật khẩu. Vui lòng thử lại.'
        : 'Không thể đặt lại mật khẩu. Vui lòng thử lại.')
    }
  })
  if (completed) return <Navigate to="/login?passwordReset=1" replace />
  return <main className="auth-shell"><section className="auth-card">
    <span className="eyebrow">BẢO MẬT TÀI KHOẢN</span><h1>Đặt lại mật khẩu</h1>
    <p>Mật khẩu mới sẽ vô hiệu hóa mọi phiên đang đăng nhập trên các thiết bị.</p>
    <form onSubmit={submit} noValidate>
      <PasswordFields register={form.register} errors={form.formState.errors} />
      {serverError && <div className="form-error" role="alert">{serverError}</div>}
      <button disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Đang cập nhật…' : 'Đặt lại mật khẩu'}</button>
    </form>
  </section></main>
}

export function ChangePasswordPage() {
  const { user, changePassword } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<ChangeValues>({ resolver: zodResolver(changeSchema) })
  if (!user) return null
  const submit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setServerError(null)
    try {
      await changePassword(currentPassword, newPassword)
      navigate('/login?passwordChanged=1', { replace: true })
    } catch (error) {
      if (error instanceof ApiClientError) {
        setServerError(error.code === 'CURRENT_PASSWORD_INVALID'
          ? 'Mật khẩu hiện tại không đúng.'
          : error.code === 'PASSWORD_REUSE_NOT_ALLOWED'
            ? 'Mật khẩu mới phải khác mật khẩu hiện tại.'
            : 'Mật khẩu đã thay đổi ở phiên khác. Vui lòng đăng nhập lại.')
        return
      }
      setServerError('Không thể đổi mật khẩu. Vui lòng thử lại.')
    }
  })
  return <section className="panel password-panel">
    <span className="eyebrow">BẢO MẬT CÁ NHÂN</span><h1>Đổi mật khẩu</h1>
    <p>Sau khi đổi thành công, mọi thiết bị sẽ bị đăng xuất và bạn cần đăng nhập lại.</p>
    <form onSubmit={submit} noValidate>
      <label>Mật khẩu hiện tại
        <input type="password" autoComplete="current-password" {...form.register('currentPassword')} />
        {form.formState.errors.currentPassword && <span className="field-error">{form.formState.errors.currentPassword.message}</span>}
      </label>
      <PasswordFields register={form.register} errors={form.formState.errors} />
      {serverError && <div className="form-error" role="alert">{serverError}</div>}
      <button disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Đang cập nhật…' : 'Đổi mật khẩu và đăng xuất'}</button>
    </form>
  </section>
}
