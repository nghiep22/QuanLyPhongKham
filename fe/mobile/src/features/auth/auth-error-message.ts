import { ApiClientError, ApiNetworkError } from '@clinic/generated-api-client';

export function authErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiNetworkError) {
    return 'Không thể kết nối đến máy chủ. Kiểm tra kết nối mạng rồi thử lại.';
  }
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.code === 'INVALID_CREDENTIALS') return 'Email, số điện thoại hoặc mật khẩu không đúng.';
  if (error.code === 'ACCOUNT_LOCKED') return 'Tài khoản đang tạm khóa. Vui lòng thử lại sau.';
  if (error.code === 'PATIENT_ACCOUNT_REQUIRED') return 'Ứng dụng này chỉ dành cho tài khoản bệnh nhân.';
  if (error.code === 'IDEMPOTENCY_KEY_REUSED') return 'Yêu cầu đăng ký đã thay đổi. Vui lòng gửi lại.';
  if (error.code === 'INVALID_OR_EXPIRED_OTP') return 'Mã OTP không đúng, đã hết hạn hoặc đã được sử dụng.';
  return fallback;
}
