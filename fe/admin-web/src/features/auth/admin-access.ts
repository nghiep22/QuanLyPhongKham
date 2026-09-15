import type { AuthenticatedUser } from '@clinic/generated-api-types'

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
    canUseClinical: hasAny('ENCOUNTERS_CLINICAL'),
    canUsePharmacy: hasAny('PRESCRIPTIONS_WRITE', 'PHARMACY_DISPENSE', 'INVENTORY_MANAGE'),
    canUseBilling: adminOr('BILLING_MANAGE', 'PAYMENT_COLLECT', 'PAYMENT_REFUND'),
    canViewReports: adminOr('REPORTS_VIEW'),
  }
}
