import { z } from 'zod';

const strongPassword = z.string()
  .min(12, 'Mật khẩu phải có ít nhất 12 ký tự.')
  .regex(/[a-z]/, 'Mật khẩu cần ít nhất một chữ thường.')
  .regex(/[A-Z]/, 'Mật khẩu cần ít nhất một chữ hoa.')
  .regex(/[0-9]/, 'Mật khẩu cần ít nhất một chữ số.');

const validDateOfBirth = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dùng định dạng YYYY-MM-DD.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === value
      && value >= '1900-01-01'
      && value <= new Date().toISOString().slice(0, 10);
  }, 'Ngày sinh không hợp lệ.');

export const patientRegistrationSchema = z.object({
  contactChannel: z.enum(['EMAIL', 'SMS']),
  contact: z.string().trim().min(3, 'Nhập email hoặc số điện thoại.'),
  password: strongPassword,
  confirmPassword: z.string(),
  fullName: z.string().trim().min(2, 'Nhập họ tên đầy đủ.').max(200),
  dateOfBirth: validDateOfBirth,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
}).superRefine((value, context) => {
  if (value.password !== value.confirmPassword) {
    context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Mật khẩu xác nhận không khớp.' });
  }
  if (value.contactChannel === 'EMAIL' && !z.email().safeParse(value.contact).success) {
    context.addIssue({ code: 'custom', path: ['contact'], message: 'Email không hợp lệ.' });
  }
  if (value.contactChannel === 'SMS' && !/^\+?[0-9]{9,15}$/.test(value.contact.replace(/[ .-]/g, ''))) {
    context.addIssue({ code: 'custom', path: ['contact'], message: 'Số điện thoại không hợp lệ.' });
  }
});

export type PatientRegistrationForm = z.infer<typeof patientRegistrationSchema>;

export function firstValidationMessage(value: PatientRegistrationForm) {
  const result = patientRegistrationSchema.safeParse(value);
  return result.success ? null : result.error.issues[0]?.message ?? 'Thông tin chưa hợp lệ.';
}
