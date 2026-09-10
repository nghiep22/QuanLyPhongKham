import { describe, expect, it } from 'vitest';
import { firstValidationMessage, type PatientRegistrationForm } from './registration-validation';

const valid: PatientRegistrationForm = {
  contactChannel: 'EMAIL',
  contact: 'patient@example.com',
  password: 'PatientPassword123',
  confirmPassword: 'PatientPassword123',
  fullName: 'Nguyễn Văn An',
  dateOfBirth: '1990-01-01',
  gender: 'MALE',
};

describe('patient registration validation', () => {
  it('accepts valid email and phone registrations', () => {
    expect(firstValidationMessage(valid)).toBeNull();
    expect(firstValidationMessage({ ...valid, contactChannel: 'SMS', contact: '+84 901-234-567' })).toBeNull();
  });

  it('rejects weak or mismatched passwords', () => {
    expect(firstValidationMessage({ ...valid, password: 'weak', confirmPassword: 'weak' })).toContain('12');
    expect(firstValidationMessage({ ...valid, confirmPassword: 'DifferentPassword123' })).toContain('khớp');
  });

  it('rejects invalid contacts and dates', () => {
    expect(firstValidationMessage({ ...valid, contact: 'not-an-email' })).toContain('Email');
    expect(firstValidationMessage({ ...valid, dateOfBirth: '2026-02-30' })).toContain('Ngày sinh');
  });
});
