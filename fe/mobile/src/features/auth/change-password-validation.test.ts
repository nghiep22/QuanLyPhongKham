import { describe, expect, it } from 'vitest';
import { firstChangePasswordValidationMessage } from './change-password-validation';

const valid = {
  currentPassword: 'CurrentPassword123',
  newPassword: 'NewPassword456',
  confirmPassword: 'NewPassword456',
};

describe('change password validation', () => {
  it('accepts a valid password change', () => {
    expect(firstChangePasswordValidationMessage(valid)).toBeNull();
  });

  it('requires a strong new password', () => {
    expect(firstChangePasswordValidationMessage({
      ...valid,
      newPassword: 'weak',
      confirmPassword: 'weak',
    })).toContain('12');
  });

  it('rejects the current password as the new password', () => {
    expect(firstChangePasswordValidationMessage({
      ...valid,
      newPassword: valid.currentPassword,
      confirmPassword: valid.currentPassword,
    })).toContain('khác');
  });

  it('rejects a mismatched confirmation', () => {
    expect(firstChangePasswordValidationMessage({ ...valid, confirmPassword: 'DifferentPassword789' })).toContain('khớp');
  });
});
