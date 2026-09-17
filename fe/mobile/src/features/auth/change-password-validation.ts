import { z } from 'zod';

export type ChangePasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const changePasswordSchema = z.object({
  currentPassword: z.string()
    .min(8, 'Mật khẩu hiện tại phải có ít nhất 8 ký tự.')
    .max(200, 'Mật khẩu hiện tại không được quá 200 ký tự.'),
  newPassword: z.string()
    .min(12, 'Mật khẩu mới phải có ít nhất 12 ký tự.')
    .max(200, 'Mật khẩu mới không được quá 200 ký tự.')
    .regex(/[a-z]/, 'Mật khẩu mới phải có chữ thường.')
    .regex(/[A-Z]/, 'Mật khẩu mới phải có chữ hoa.')
    .regex(/[0-9]/, 'Mật khẩu mới phải có chữ số.'),
  confirmPassword: z.string(),
}).superRefine((value, context) => {
  if (value.newPassword === value.currentPassword) {
    context.addIssue({
      code: 'custom',
      path: ['newPassword'],
      message: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
    });
  }
  if (value.confirmPassword !== value.newPassword) {
    context.addIssue({
      code: 'custom',
      path: ['confirmPassword'],
      message: 'Mật khẩu xác nhận không khớp.',
    });
  }
});

export function firstChangePasswordValidationMessage(form: ChangePasswordForm) {
  const result = changePasswordSchema.safeParse(form);
  return result.success ? null : result.error.issues[0]?.message ?? 'Thông tin chưa hợp lệ.';
}
