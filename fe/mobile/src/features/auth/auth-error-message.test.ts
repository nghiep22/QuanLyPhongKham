import { ApiClientError, ApiNetworkError } from '@clinic/generated-api-client';
import { describe, expect, it } from 'vitest';
import { authErrorMessage } from './auth-error-message';

describe('authErrorMessage', () => {
  it('explains connection failures separately from authentication failures', () => {
    expect(authErrorMessage(new ApiNetworkError(new TypeError('Network request failed')), 'fallback'))
      .toContain('kết nối đến máy chủ');
  });

  it('maps structured API errors to patient-facing messages', () => {
    const error = new ApiClientError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    expect(authErrorMessage(error, 'fallback')).toContain('mật khẩu không đúng');
  });

  it('explains password change conflicts', () => {
    const invalidCurrentPassword = new ApiClientError(400, 'CURRENT_PASSWORD_INVALID', 'Invalid current password');
    const reusedPassword = new ApiClientError(409, 'PASSWORD_REUSE_NOT_ALLOWED', 'Password reused');
    expect(authErrorMessage(invalidCurrentPassword, 'fallback')).toContain('hiện tại không đúng');
    expect(authErrorMessage(reusedPassword, 'fallback')).toContain('phải khác');
  });

  it('uses the caller fallback for an unexpected error', () => {
    expect(authErrorMessage(new Error('Unexpected'), 'Không thể đăng nhập lúc này.'))
      .toBe('Không thể đăng nhập lúc này.');
  });
});
