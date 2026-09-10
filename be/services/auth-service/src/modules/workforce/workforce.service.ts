import argon2 from 'argon2';
import { HttpError } from '../../shared/http/errors.js';
import type {
  Actor,
  CreateStaffInput,
  StaffVersion,
  StaffListQuery,
  UpdateStaffInput,
  WorkforceRepository,
} from './workforce.types.js';

function databaseErrorNumber(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  if ('originalError' in error) return databaseErrorNumber(error.originalError);
  return undefined;
}

function mapDatabaseError(error: unknown): never {
  const number = databaseErrorNumber(error);
  if (number === 2601 || number === 2627) {
    throw new HttpError(409, 'STAFF_IDENTITY_CONFLICT', 'Username, email, số điện thoại, mã nhân viên hoặc chứng chỉ đã tồn tại.');
  }
  if ([53005, 53006, 53007, 53008].includes(number ?? 0)) {
    throw new HttpError(404, 'REFERENCE_NOT_FOUND', 'Dữ liệu tham chiếu hoặc tài khoản đích không còn tồn tại.');
  }
  if (number === 53012) {
    throw new HttpError(404, 'ROLE_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy vai trò đang hoạt động.');
  }
  if ([53009, 53011, 53036, 53037, 53038, 53039, 53040, 53041, 53043, 53046, 53047, 53051].includes(number ?? 0)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu không còn hợp lệ tại thời điểm xử lý.');
  }
  if (number === 53044 || number === 53045) {
    throw new HttpError(409, 'STAFF_VERSION_CONFLICT', 'Hồ sơ đã thay đổi. Vui lòng tải lại trước khi lưu.');
  }
  if ([53010, 53048, 53049, 53050, 53053, 53054, 53055, 53056, 53057, 53058, 53059].includes(number ?? 0)) {
    throw new HttpError(409, 'SECURITY_POLICY_CONFLICT', 'Thao tác bị từ chối bởi chính sách bảo vệ tài khoản và phân quyền.');
  }
  if (number === 51002) {
    throw new HttpError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác trong phạm vi này.');
  }
  if (number === 53042) {
    throw new HttpError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy tài khoản nhân viên.');
  }
  if (number === 53052) {
    throw new HttpError(409, 'ACCOUNT_NOT_LOCKED', 'Tài khoản không bị khóa hoặc đang bị vô hiệu hóa.');
  }
  throw error;
}

export class WorkforceService {
  constructor(private readonly repository: WorkforceRepository) {}

  private async assertPermission(actor: Actor, permission: string, branchId: number | null) {
    if (!await this.repository.hasPermission(actor.userId, permission, branchId)) {
      throw new HttpError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác trong phạm vi này.');
    }
  }

  private async branch(publicId: string) {
    const branch = await this.repository.resolveBranch(publicId);
    if (!branch) throw new HttpError(404, 'BRANCH_NOT_FOUND', 'Không tìm thấy chi nhánh đang hoạt động.');
    return branch;
  }

  async references(actor: Actor) {
    const references = await this.repository.getReferences(actor.userId);
    if (references.branches.length === 0) {
      throw new HttpError(403, 'FORBIDDEN', 'Bạn không có phạm vi quản lý nhân sự.');
    }
    const canManageRoles = await this.repository.hasPermission(actor.userId, 'ROLES_MANAGE', null);
    return { ...references, roles: canManageRoles ? references.roles : [] };
  }

  async list(actor: Actor, query: StaffListQuery) {
    const globalAdmin = actor.roles.some((role) => role.code === 'ADMIN' && role.branchId === null);
    if (!query.branchPublicId && !globalAdmin) {
      throw new HttpError(400, 'BRANCH_REQUIRED', 'Hãy chọn chi nhánh cần quản lý.');
    }
    const branch = query.branchPublicId ? await this.branch(query.branchPublicId) : null;
    await this.assertPermission(actor, 'USERS_MANAGE', branch?.id ?? null);
    return this.repository.list(query, branch?.id ?? null);
  }

  async get(actor: Actor, publicId: string) {
    const staff = await this.repository.getStaff(publicId);
    if (!staff) throw new HttpError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy nhân viên.');
    await this.assertPermission(actor, 'USERS_MANAGE', staff.branchId);
    const { userId: _userId, branchId: _branchId, ...view } = staff;
    return view;
  }

  async create(actor: Actor, input: CreateStaffInput, requestId: string) {
    const branch = await this.branch(input.branchPublicId);
    await this.assertPermission(actor, 'USERS_MANAGE', branch.id);
    let specialtyId: number | null = null;
    if (input.specialtyPublicId) {
      const specialty = await this.repository.resolveSpecialty(input.specialtyPublicId);
      if (!specialty) throw new HttpError(404, 'SPECIALTY_NOT_FOUND', 'Không tìm thấy chuyên khoa.');
      specialtyId = specialty.id;
    }
    const passwordHash = await argon2.hash(input.temporaryPassword, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    try {
      const publicId = await this.repository.create(
        actor.userId, branch.id, specialtyId, input, passwordHash, requestId,
      );
      return await this.get(actor, publicId);
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async update(actor: Actor, publicId: string, input: UpdateStaffInput, version: StaffVersion, requestId: string) {
    const staff = await this.repository.getStaff(publicId);
    if (!staff) throw new HttpError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy nhân viên.');
    await this.assertPermission(actor, 'USERS_MANAGE', staff.branchId);
    try {
      await this.repository.update(actor.userId, staff.userId, { ...input, ...version }, requestId);
      return await this.get(actor, publicId);
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  private async target(actor: Actor, userPublicId: string, permission: string) {
    const staff = await this.repository.getStaffByUser(userPublicId);
    if (!staff) throw new HttpError(404, 'STAFF_NOT_FOUND', 'Không tìm thấy tài khoản nhân viên.');
    await this.assertPermission(actor, permission, staff.branchId);
    return staff;
  }

  async setAccountStatus(actor: Actor, userPublicId: string, status: 'ACTIVE' | 'DISABLED', reason: string, requestId: string) {
    const staff = await this.target(actor, userPublicId, 'USERS_MANAGE');
    try {
      await this.repository.setAccountStatus(actor.userId, staff.userId, status, reason, requestId);
      return await this.get(actor, staff.publicId);
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async unlock(actor: Actor, userPublicId: string, reason: string, requestId: string) {
    const staff = await this.target(actor, userPublicId, 'USERS_MANAGE');
    try {
      await this.repository.unlock(actor.userId, staff.userId, reason, requestId);
      return await this.get(actor, staff.publicId);
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async grantRole(actor: Actor, userPublicId: string, roleCode: string, branchPublicId: string | undefined, validToUtc: string | undefined, requestId: string) {
    const staff = await this.target(actor, userPublicId, 'ROLES_MANAGE');
    const branch = branchPublicId ? await this.branch(branchPublicId) : null;
    await this.assertPermission(actor, 'ROLES_MANAGE', branch?.id ?? null);
    try {
      await this.repository.grantRole(
        actor.userId, staff.userId, roleCode, branch?.id ?? null,
        validToUtc ? new Date(validToUtc) : null, requestId,
      );
      return await this.get(actor, staff.publicId);
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async revokeRole(actor: Actor, userPublicId: string, assignmentPublicId: string, reason: string, requestId: string) {
    const staff = await this.target(actor, userPublicId, 'ROLES_MANAGE');
    const assignment = await this.repository.resolveAssignment(assignmentPublicId, staff.userId);
    if (!assignment) throw new HttpError(404, 'ROLE_ASSIGNMENT_NOT_FOUND', 'Không tìm thấy vai trò đang hoạt động.');
    await this.assertPermission(actor, 'ROLES_MANAGE', assignment.branchId);
    try {
      await this.repository.revokeRole(actor.userId, assignment.id, reason, requestId);
      return await this.get(actor, staff.publicId);
    } catch (error) {
      mapDatabaseError(error);
    }
  }
}
