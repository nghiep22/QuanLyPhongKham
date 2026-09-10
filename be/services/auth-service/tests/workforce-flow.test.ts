import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';
import type { AuthPrincipal } from '../src/modules/auth/auth.types.js';
import { WorkforceService } from '../src/modules/workforce/workforce.service.js';
import type {
  BranchReference,
  CreateStaffInput,
  StaffListQuery,
  StaffReferences,
  StaffVersion,
  StaffView,
  UpdateStaffInput,
  WorkforceRepository,
} from '../src/modules/workforce/workforce.types.js';

const branchA = { id: 10, publicId: randomUUID(), code: 'MAIN', name: 'Chi nhánh chính' };
const branchB = { id: 20, publicId: randomUUID(), code: 'WEST', name: 'Chi nhánh Tây' };
const specialty = { id: 30, publicId: randomUUID(), code: 'GENERAL', name: 'Đa khoa' };

function staff(branch: BranchReference = branchA): StaffView & { userId: number; branchId: number } {
  return {
    publicId: randomUUID(),
    userPublicId: randomUUID(),
    userId: 2,
    username: 'doctor01',
    email: 'doctor@example.com',
    phone: '0900000000',
    accountStatus: 'ACTIVE',
    lockedUntilUtc: null,
    employeeCode: 'DR001',
    employeeType: 'DOCTOR',
    fullName: 'Bác sĩ kiểm thử',
    dateOfBirth: '1990-01-01',
    gender: 'OTHER',
    addressLine: null,
    hireDate: '2026-01-01',
    employmentStatus: 'ACTIVE',
    branchId: branch === branchA ? branchA.id : branchB.id,
    branch,
    doctor: {
      publicId: randomUUID(),
      medicalLicenseNo: 'LIC-001',
      licenseIssuedDate: '2020-01-01',
      licenseExpiryDate: '2030-01-01',
      academicTitle: 'BS',
      biography: null,
      defaultSlotMinutes: 30,
      acceptsOnlineBooking: true,
      rowVersion: 'AAAAAAAAAAE=',
    },
    roles: [],
    rowVersion: 'AAAAAAAAAAE=',
  };
}

class MemoryWorkforceRepository implements WorkforceRepository {
  item = staff();
  passwordHash = '';
  updateErrorNumber: number | null = null;
  branches = [branchA, branchB];

  resolveBranch(publicId: string) {
    return Promise.resolve(this.branches.find((branch) => branch.publicId === publicId) ?? null);
  }
  resolveSpecialty(publicId: string) {
    return Promise.resolve(publicId === specialty.publicId ? { id: specialty.id } : null);
  }
  hasPermission(actorUserId: number, permission: string, branchId: number | null) {
    if (actorUserId === 1) return Promise.resolve(true);
    return Promise.resolve(actorUserId === 3 && permission === 'USERS_MANAGE' && branchId === branchA.id);
  }
  getReferences(actorUserId: number): Promise<StaffReferences> {
    return Promise.resolve({
      branches: actorUserId === 1 ? this.branches : [branchA],
      roles: [{ code: 'DOCTOR', name: 'Bác sĩ', scope: 'BRANCH' }],
      specialties: [specialty],
    });
  }
  list(_query: StaffListQuery, branchId: number | null) {
    const items = branchId === null || branchId === this.item.branchId ? [this.item] : [];
    return Promise.resolve({ items, total: items.length });
  }
  getStaff(publicId: string) {
    return Promise.resolve(publicId === this.item.publicId ? this.item : null);
  }
  getStaffByUser(publicId: string) {
    return Promise.resolve(publicId === this.item.userPublicId ? this.item : null);
  }
  create(_actor: number, _branch: number, _specialty: number | null, input: CreateStaffInput, passwordHash: string) {
    this.passwordHash = passwordHash;
    this.item = { ...this.item, username: input.username, employeeCode: input.employeeCode, fullName: input.fullName };
    return Promise.resolve(this.item.publicId);
  }
  update(_actor: number, _target: number, input: UpdateStaffInput & StaffVersion) {
    if (this.updateErrorNumber) return Promise.reject({ number: this.updateErrorNumber });
    this.item = { ...this.item, fullName: input.fullName, rowVersion: 'AAAAAAAAAAI=' };
    return Promise.resolve();
  }
  setAccountStatus(_actor: number, _target: number, status: 'ACTIVE' | 'DISABLED') {
    this.item = { ...this.item, accountStatus: status };
    return Promise.resolve();
  }
  unlock() {
    this.item = { ...this.item, lockedUntilUtc: null };
    return Promise.resolve();
  }
  grantRole(_actor: number, _target: number, roleCode: string) {
    this.item.roles.push({
      publicId: randomUUID(), code: roleCode, name: roleCode, branch: branchA,
      validFromUtc: new Date().toISOString(), validToUtc: null,
    });
    return Promise.resolve();
  }
  resolveAssignment(assignmentPublicId: string, targetUserId: number) {
    const exists = targetUserId === this.item.userId && this.item.roles.some((role) => role.publicId === assignmentPublicId);
    return Promise.resolve(exists ? { id: 99, branchId: branchA.id } : null);
  }
  revokeRole() {
    this.item = { ...this.item, roles: [] };
    return Promise.resolve();
  }
}

const principals: Record<string, AuthPrincipal> = {
  admin: {
    userId: 1, publicId: randomUUID(), displayName: 'Admin', tokenVersion: 1,
    roles: [{ code: 'ADMIN', branchId: null }], permissions: [],
  },
  manager: {
    userId: 3, publicId: randomUUID(), displayName: 'Manager', tokenVersion: 1,
    roles: [{ code: 'MANAGER', branchId: String(branchA.id) }], permissions: ['USERS_MANAGE'],
  },
  receptionist: {
    userId: 4, publicId: randomUUID(), displayName: 'Receptionist', tokenVersion: 1,
    roles: [{ code: 'RECEPTIONIST', branchId: String(branchA.id) }], permissions: [],
  },
};

function fakeAuth(): AuthService {
  return {
    authenticate: async (token: string) => {
      const principal = principals[token];
      if (!principal) throw new Error('invalid');
      return principal;
    },
    getJwks: async () => ({ keys: [] }),
  } as unknown as AuthService;
}

function app(repository: MemoryWorkforceRepository) {
  return createApp({
    authService: fakeAuth(),
    workforceService: new WorkforceService(repository),
    databaseProbe: async () => ({ database: 'test' }),
  });
}

const authorization = (token: keyof typeof principals) => ({ authorization: `Bearer ${token}` });

describe('workforce and RBAC vertical slice', () => {
  let repository: MemoryWorkforceRepository;
  beforeEach(() => { repository = new MemoryWorkforceRepository(); });

  it('creates doctor identity atomically and hashes the temporary password', async () => {
    const response = await request(app(repository)).post('/api/v1/admin/staff')
      .set(authorization('admin')).send({
        branchPublicId: branchA.publicId,
        username: 'new-doctor',
        temporaryPassword: 'Temporary123!',
        employeeCode: 'DR002',
        employeeType: 'DOCTOR',
        fullName: 'Bác sĩ mới',
        hireDate: '2026-09-10',
        medicalLicenseNo: 'LIC-002',
        specialtyPublicId: specialty.publicId,
      });
    expect(response.status).toBe(201);
    expect(response.body.data.username).toBe('new-doctor');
    expect(repository.passwordHash).toMatch(/^\$argon2id\$/);
    expect(repository.passwordHash).not.toContain('Temporary123!');
  });

  it('requires a branch for managers and rejects access outside their branch', async () => {
    const missing = await request(app(repository)).get('/api/v1/admin/staff').set(authorization('manager'));
    const outside = await request(app(repository)).get('/api/v1/admin/staff')
      .query({ branchPublicId: branchB.publicId }).set(authorization('manager'));
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('BRANCH_REQUIRED');
    expect(outside.status).toBe(403);
  });

  it('rejects staff management without USERS_MANAGE', async () => {
    const response = await request(app(repository)).get('/api/v1/admin/staff')
      .query({ branchPublicId: branchA.publicId }).set(authorization('receptionist'));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('maps optimistic concurrency failures to HTTP 409', async () => {
    repository.updateErrorNumber = 53044;
    const response = await request(app(repository)).put(`/api/v1/admin/staff/${repository.item.publicId}`)
      .set(authorization('admin')).set('If-Match', '"AAAAAAAAAAE=:AAAAAAAAAAE="').send({
        fullName: 'Tên cập nhật', hireDate: '2026-01-01', employmentStatus: 'ACTIVE',
        medicalLicenseNo: 'LIC-001', defaultSlotMinutes: 30,
      });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STAFF_VERSION_CONFLICT');
  });

  it('returns strong ETags and accepts If-Match for a successful update', async () => {
    const detail = await request(app(repository)).get(`/api/v1/admin/staff/${repository.item.publicId}`)
      .set(authorization('admin'));
    expect(detail.status).toBe(200);
    expect(detail.headers.etag).toBe('"AAAAAAAAAAE=:AAAAAAAAAAE="');

    const updated = await request(app(repository)).put(`/api/v1/admin/staff/${repository.item.publicId}`)
      .set(authorization('admin')).set('If-Match', detail.headers.etag).send({
        fullName: 'Tên cập nhật', hireDate: '2026-01-01', employmentStatus: 'ACTIVE',
        medicalLicenseNo: 'LIC-001', defaultSlotMinutes: 30,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.data.fullName).toBe('Tên cập nhật');
    expect(updated.headers.etag).toBe('"AAAAAAAAAAI=:AAAAAAAAAAE="');
  });

  it('maps an attempted rehire through ordinary editing to a policy conflict', async () => {
    repository.updateErrorNumber = 53058;
    const response = await request(app(repository)).put(`/api/v1/admin/staff/${repository.item.publicId}`)
      .set(authorization('admin')).set('If-Match', '"AAAAAAAAAAE=:AAAAAAAAAAE="').send({
        fullName: 'Tên cập nhật', hireDate: '2026-01-01', employmentStatus: 'ACTIVE',
        medicalLicenseNo: 'LIC-001', defaultSlotMinutes: 30,
      });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SECURITY_POLICY_CONFLICT');
  });

  it('requires If-Match for profile updates', async () => {
    const response = await request(app(repository)).put(`/api/v1/admin/staff/${repository.item.publicId}`)
      .set(authorization('admin')).send({
        fullName: 'Tên cập nhật', hireDate: '2026-01-01', employmentStatus: 'ACTIVE',
        medicalLicenseNo: 'LIC-001', defaultSlotMinutes: 30,
      });
    expect(response.status).toBe(428);
    expect(response.body.error.code).toBe('PRECONDITION_REQUIRED');
  });

  it('grants and revokes a branch role using public identifiers only', async () => {
    const granted = await request(app(repository))
      .post(`/api/v1/admin/users/${repository.item.userPublicId}/roles`)
      .set(authorization('admin')).send({ roleCode: 'NURSE', branchPublicId: branchA.publicId });
    expect(granted.status).toBe(200);
    const assignmentId = granted.body.data.roles[0].publicId as string;
    const revoked = await request(app(repository))
      .delete(`/api/v1/admin/users/${repository.item.userPublicId}/roles/${assignmentId}`)
      .set(authorization('admin')).send({ reason: 'Kết thúc phân công' });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.roles).toEqual([]);
  });
});
