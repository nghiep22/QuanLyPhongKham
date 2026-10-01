import type { AuthenticatedUser } from '@clinic/generated-api-types'

const staffRoles = new Set(['ADMIN', 'MANAGER', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'PHARMACIST', 'CASHIER', 'LAB_TECH'])

export function hasStaffRole(user: AuthenticatedUser | null): boolean {
  return Boolean(user?.roles.some((role) => staffRoles.has(role.code)))
}

export type AdminAccess = {
  isAdmin: boolean
  canManageStaff: boolean
  canManagePatientLinks: boolean
  canManageCatalog: boolean
  canManagePatients: boolean
  canManageAppointments: boolean
  canManageSchedules: boolean
  canManageReception: boolean
  canCancelEncounters: boolean
  canUseClinical: boolean
  canUsePharmacy: boolean
  canUseBilling: boolean
  canViewReports: boolean
}

export function getAdminAccess(user: AuthenticatedUser | null): AdminAccess {
  const permissions = new Set(user?.permissions ?? [])
  const isAdmin = Boolean(user?.roles.some((role) => role.code === 'ADMIN'))
  const hasAny = (...required: string[]) => required.some((permission) => permissions.has(permission))
  const adminOr = (...required: string[]) => isAdmin || hasAny(...required)
  const hasDoctorAssignment = Boolean(user?.roles.some((role) => role.code === 'DOCTOR' && role.branchId !== null))

  return {
    isAdmin,
    canManageStaff: adminOr('USERS_MANAGE'),
    canManagePatientLinks: adminOr('PATIENT_PORTAL_LINK_MANAGE'),
    canManageCatalog: adminOr('MASTER_DATA_MANAGE'),
    canManagePatients: adminOr('PATIENTS_MANAGE'),
    canManageAppointments: adminOr('APPOINTMENTS_MANAGE'),
    canManageSchedules: adminOr('SCHEDULES_MANAGE'),
    canManageReception: adminOr('QUEUE_MANAGE', 'ENCOUNTERS_CREATE'),
    canCancelEncounters: adminOr('ENCOUNTERS_CREATE'),
    canUseClinical: hasDoctorAssignment && hasAny('ENCOUNTERS_CLINICAL'),
    canUsePharmacy: hasAny('PRESCRIPTIONS_WRITE', 'PHARMACY_DISPENSE', 'INVENTORY_MANAGE'),
    canUseBilling: adminOr('BILLING_MANAGE', 'PAYMENT_COLLECT', 'PAYMENT_REFUND'),
    canViewReports: adminOr('REPORTS_VIEW'),
  }
}

export function canOpenAdminPath(user: AuthenticatedUser | null, path: string): boolean {
  if (!hasStaffRole(user)) return false
  const access = getAdminAccess(user)
  switch (path) {
    case '/staff': return access.canManageStaff
    case '/patient-links': return access.canManagePatientLinks
    case '/catalog': return access.canManageCatalog
    case '/patients': return access.canManagePatients
    case '/appointments': return access.canManageAppointments
    case '/schedules': return access.canManageSchedules
    case '/my-schedules': return Boolean(user?.roles.some((role) => role.code === 'DOCTOR'))
    case '/reception': return access.canManageReception
    case '/clinical': return access.canUseClinical
    case '/pharmacy': return access.canUsePharmacy
    case '/billing': return access.canUseBilling
    case '/reports': return access.canViewReports
    default: return true
  }
}
