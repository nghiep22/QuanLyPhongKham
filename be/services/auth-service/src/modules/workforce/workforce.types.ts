import type { AuthPrincipal } from '../auth/auth.types.js';

export const employeeTypes = [
  'DOCTOR', 'NURSE', 'RECEPTIONIST', 'PHARMACIST', 'CASHIER',
  'LAB_TECH', 'TECHNICIAN', 'MANAGER', 'OTHER',
] as const;
export type EmployeeType = typeof employeeTypes[number];
export type EmploymentStatus = 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED';
export type AccountStatus = 'ACTIVE' | 'LOCKED' | 'DISABLED' | 'PENDING';

export type BranchReference = { publicId: string; code: string; name: string };
export type RoleReference = { code: string; name: string; scope: 'GLOBAL' | 'BRANCH' };
export type SpecialtyReference = { publicId: string; code: string; name: string };
export type RoleAssignmentView = {
  publicId: string;
  code: string;
  name: string;
  branch: BranchReference | null;
  validFromUtc: string;
  validToUtc: string | null;
};

export type DoctorProfile = {
  publicId: string;
  medicalLicenseNo: string;
  licenseIssuedDate: string | null;
  licenseExpiryDate: string | null;
  academicTitle: string | null;
  biography: string | null;
  defaultSlotMinutes: number;
  acceptsOnlineBooking: boolean;
  rowVersion: string;
};

export type StaffView = {
  publicId: string;
  userPublicId: string;
  username: string;
  email: string | null;
  phone: string | null;
  accountStatus: AccountStatus;
  lockedUntilUtc: string | null;
  employeeCode: string;
  employeeType: EmployeeType;
  fullName: string;
  dateOfBirth: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  addressLine: string | null;
  hireDate: string;
  employmentStatus: EmploymentStatus;
  branch: BranchReference;
  doctor: DoctorProfile | null;
  roles: RoleAssignmentView[];
  rowVersion: string;
};

export type StaffListQuery = {
  query?: string;
  branchPublicId?: string;
  employeeType?: EmployeeType;
  accountStatus?: AccountStatus;
  page: number;
  pageSize: number;
};

export type CreateStaffInput = {
  branchPublicId: string;
  username: string;
  email?: string;
  phone?: string;
  temporaryPassword: string;
  employeeCode: string;
  employeeType: EmployeeType;
  fullName: string;
  dateOfBirth?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  addressLine?: string;
  hireDate: string;
  medicalLicenseNo?: string;
  licenseIssuedDate?: string;
  licenseExpiryDate?: string;
  academicTitle?: string;
  biography?: string;
  defaultSlotMinutes?: number;
  acceptsOnlineBooking?: boolean;
  specialtyPublicId?: string;
};

export type UpdateStaffInput = Omit<CreateStaffInput,
  'branchPublicId' | 'username' | 'temporaryPassword' | 'employeeCode' | 'employeeType' | 'specialtyPublicId'> & {
    employmentStatus: EmploymentStatus;
    terminationDate?: string;
  };

export type StaffVersion = {
  employeeRowVersion: string;
  doctorRowVersion?: string;
};

export type StaffReferences = {
  branches: BranchReference[];
  roles: RoleReference[];
  specialties: SpecialtyReference[];
};

export type Actor = Pick<AuthPrincipal, 'userId' | 'roles'>;

export interface WorkforceRepository {
  resolveBranch(publicId: string): Promise<(BranchReference & { id: number }) | null>;
  resolveSpecialty(publicId: string): Promise<{ id: number } | null>;
  hasPermission(actorUserId: number, permission: string, branchId: number | null): Promise<boolean>;
  getReferences(actorUserId: number): Promise<StaffReferences>;
  list(query: StaffListQuery, branchId: number | null): Promise<{ items: StaffView[]; total: number }>;
  getStaff(publicId: string): Promise<(StaffView & { userId: number; branchId: number }) | null>;
  getStaffByUser(publicId: string): Promise<(StaffView & { userId: number; branchId: number }) | null>;
  create(actorUserId: number, branchId: number, specialtyId: number | null, input: CreateStaffInput, passwordHash: string, requestId: string): Promise<string>;
  update(actorUserId: number, targetUserId: number, input: UpdateStaffInput & StaffVersion, requestId: string): Promise<void>;
  setAccountStatus(actorUserId: number, targetUserId: number, status: 'ACTIVE' | 'DISABLED', reason: string, requestId: string): Promise<void>;
  unlock(actorUserId: number, targetUserId: number, reason: string, requestId: string): Promise<void>;
  grantRole(actorUserId: number, targetUserId: number, roleCode: string, branchId: number | null, validToUtc: Date | null, requestId: string): Promise<void>;
  resolveAssignment(assignmentPublicId: string, targetUserId: number): Promise<{ id: number; branchId: number | null } | null>;
  revokeRole(actorUserId: number, assignmentId: number, reason: string, requestId: string): Promise<void>;
}
