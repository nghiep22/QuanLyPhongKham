import { describe, expect, it } from 'vitest'
import type { AuthenticatedUser } from '@clinic/generated-api-types'
import { canOpenAdminPath, getAdminAccess, hasStaffRole } from './admin-access'

function user(permissions: string[] = [], roleCodes: string[] = []): AuthenticatedUser {
  return {
    userId: 1,
    publicId: 'user-1',
    displayName: 'Nhân viên kiểm thử',
    tokenVersion: 1,
    permissions,
    roles: roleCodes.map((code) => ({ code, branchId: null })),
  }
}

describe('getAdminAccess', () => {
  it('grants administrator-managed modules to ADMIN accounts', () => {
    const access = getAdminAccess(user([], ['ADMIN']))

    expect(access.canManageStaff).toBe(true)
    expect(access.canManageCatalog).toBe(true)
    expect(access.canViewReports).toBe(true)
  })

  it('keeps clinical and pharmacy modules permission-bound', () => {
    const access = getAdminAccess(user([], ['ADMIN']))

    expect(access.canUseClinical).toBe(false)
    expect(access.canUsePharmacy).toBe(false)
  })

  it('shows clinical only for a doctor assigned to a branch', () => {
    expect(getAdminAccess(user(['ENCOUNTERS_CLINICAL'], ['ADMIN'])).canUseClinical).toBe(false)
    const doctor = user(['ENCOUNTERS_CLINICAL'], ['DOCTOR'])
    doctor.roles[0]!.branchId = '1'
    expect(getAdminAccess(doctor).canUseClinical).toBe(true)
  })

  it('enables a module when any accepted permission is present', () => {
    const access = getAdminAccess(user(['ENCOUNTERS_CREATE', 'PAYMENT_COLLECT']))

    expect(access.canManageReception).toBe(true)
    expect(access.canCancelEncounters).toBe(true)
    expect(access.canUseBilling).toBe(true)
    expect(access.canManageAppointments).toBe(false)
  })

  it('does not expose encounter cancellation from queue-only access', () => {
    const access = getAdminAccess(user(['QUEUE_MANAGE']))

    expect(access.canManageReception).toBe(true)
    expect(access.canCancelEncounters).toBe(false)
  })

  it('returns no access for a missing session', () => {
    expect(Object.values(getAdminAccess(null)).every((value) => value === false)).toBe(true)
  })
})

describe('hasStaffRole', () => {
  it('keeps patient-only accounts out of the staff workspace', () => {
    expect(hasStaffRole(user(['APPOINTMENTS_SELF'], ['PATIENT']))).toBe(false)
    expect(hasStaffRole(user())).toBe(false)
  })

  it('allows staff accounts even when they also have a patient role', () => {
    expect(hasStaffRole(user([], ['PATIENT', 'DOCTOR']))).toBe(true)
    expect(hasStaffRole(user([], ['RECEPTIONIST']))).toBe(true)
  })
})

describe('canOpenAdminPath', () => {
  it('does not show modules outside the signed-in staff member’s permissions', () => {
    const receptionist = user(['QUEUE_MANAGE'], ['RECEPTIONIST'])
    expect(canOpenAdminPath(receptionist, '/reception')).toBe(true)
    expect(canOpenAdminPath(receptionist, '/reports')).toBe(false)
    expect(canOpenAdminPath(receptionist, '/dashboard')).toBe(true)
  })

  it('does not expose the staff workspace to patient-only accounts', () => {
    expect(canOpenAdminPath(user([], ['PATIENT']), '/dashboard')).toBe(false)
  })
})
