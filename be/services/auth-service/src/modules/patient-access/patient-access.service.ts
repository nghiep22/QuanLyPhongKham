import { env } from '../../config.js';
import { HttpError } from '../../shared/http/errors.js';
import { TokenService } from '../auth/token.service.js';
import type {
  Actor,
  CreatePatientLinkRequestInput,
  PatientAccessRepository,
  StaffPatientLinkRequestQuery,
} from './patient-access.types.js';

function databaseErrorNumber(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  if ('originalError' in error) return databaseErrorNumber(error.originalError);
  return undefined;
}

function mapDatabaseError(error: unknown): never {
  const number = databaseErrorNumber(error);
  if (number === 51002) {
    throw new HttpError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này.');
  }
  if (number === 53506) {
    throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã được dùng cho nội dung khác.');
  }
  if (number === 53507) {
    throw new HttpError(429, 'PATIENT_LINK_RATE_LIMITED', 'Bạn đã gửi quá nhiều yêu cầu liên kết. Vui lòng thử lại sau.');
  }
  if ([53508, 53512, 53515, 53519].includes(number ?? 0)) {
    throw new HttpError(404, 'PATIENT_LINK_NOT_FOUND', 'Không tìm thấy yêu cầu hoặc liên kết phù hợp.');
  }
  if (number === 53513) {
    throw new HttpError(409, 'PATIENT_LINK_VERSION_CONFLICT', 'Yêu cầu đã được người khác cập nhật. Hãy tải lại danh sách.');
  }
  if ([53505, 53509, 53514, 53516, 53517, 53520].includes(number ?? 0)) {
    throw new HttpError(409, 'PATIENT_LINK_STATE_CONFLICT', 'Yêu cầu hoặc liên kết không còn ở trạng thái cho phép.');
  }
  if ([53500, 53501, 53502, 53503, 53504, 53510, 53511, 53518, 53521, 53522, 53523].includes(number ?? 0)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu liên kết hồ sơ không hợp lệ.');
  }
  throw error;
}

export class PatientAccessService {
  constructor(
    private readonly repository: PatientAccessRepository,
    private readonly tokens = new TokenService(),
  ) {}

  private assertPatient(actor: Actor) {
    if (!actor.roles.some((role) => role.code === 'PATIENT')) {
      throw new HttpError(403, 'PATIENT_ACCOUNT_REQUIRED', 'Chức năng chỉ dành cho tài khoản bệnh nhân.');
    }
  }

  private async assertPermission(actor: Actor, permission: string, branchId: number | null) {
    if (!await this.repository.hasPermission(actor.userId, permission, branchId)) {
      throw new HttpError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác trong phạm vi này.');
    }
  }

  async patientReferences(actor: Actor) {
    this.assertPatient(actor);
    return { branches: (await this.repository.listPatientBranches()).map(({ id: _id, ...branch }) => branch) };
  }

  async staffReferences(actor: Actor) {
    const branches = await this.repository.listManagedBranches(actor.userId);
    if (branches.length === 0) {
      throw new HttpError(403, 'FORBIDDEN', 'Bạn không có chi nhánh được phép duyệt liên kết hồ sơ.');
    }
    return { branches: branches.map(({ id: _id, ...branch }) => branch) };
  }

  async request(actor: Actor, input: CreatePatientLinkRequestInput, idempotencyKey: string, requestId: string) {
    this.assertPatient(actor);
    const branch = await this.repository.resolveBranch(input.branchPublicId);
    if (!branch) throw new HttpError(404, 'BRANCH_NOT_FOUND', 'Không tìm thấy chi nhánh tiếp nhận.');
    const normalized = {
      branchPublicId: branch.publicId.toLowerCase(),
      patientCode: input.patientCode.trim().toUpperCase(),
      dateOfBirth: input.dateOfBirth,
      relationshipType: input.relationshipType,
      requestNote: input.requestNote?.trim() || null,
    };
    const requestHash = this.tokens.hashPatientLinkRequest(JSON.stringify(normalized));
    try {
      const result = await this.repository.requestLink({
        actorUserId: actor.userId,
        branchId: branch.id,
        patientCode: normalized.patientCode,
        dateOfBirth: normalized.dateOfBirth,
        relationshipType: normalized.relationshipType,
        requestNote: normalized.requestNote,
        idempotencyKey,
        requestHash,
        expiresAtUtc: new Date(Date.now() + env.PATIENT_LINK_REQUEST_TTL_DAYS * 86_400_000),
        maxRequestsPerDay: env.PATIENT_LINK_MAX_REQUESTS_PER_DAY,
      }, requestId);
      return { requestId: result.requestPublicId, status: 'PENDING' as const };
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async getPatientAccess(actor: Actor, requestId: string) {
    this.assertPatient(actor);
    try {
      return await this.repository.getPatientAccess(actor.userId, requestId);
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async cancel(actor: Actor, requestPublicId: string, requestId: string) {
    this.assertPatient(actor);
    try {
      await this.repository.cancelRequest(actor.userId, requestPublicId, requestId);
      return { cancelled: true as const };
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async listRequests(actor: Actor, query: StaffPatientLinkRequestQuery, requestId: string) {
    const branch = await this.repository.resolveBranch(query.branchPublicId);
    if (!branch) throw new HttpError(404, 'BRANCH_NOT_FOUND', 'Không tìm thấy chi nhánh tiếp nhận.');
    await this.assertPermission(actor, 'PATIENT_PORTAL_LINK_MANAGE', branch.id);
    try {
      return await this.repository.listRequests(actor.userId, branch.id, query, requestId);
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async decide(actor: Actor, requestPublicId: string, decision: 'APPROVE' | 'REJECT', reason: string,
    expectedRowVersion: string, requestId: string) {
    try {
      const linkPublicId = await this.repository.decideRequest(
        actor.userId, requestPublicId, decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reason.trim(), expectedRowVersion, requestId,
      );
      return { requestId: requestPublicId, status: decision === 'APPROVE' ? 'APPROVED' as const : 'REJECTED' as const, linkPublicId };
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async revoke(actor: Actor, linkPublicId: string, reason: string, requestId: string) {
    try {
      await this.repository.revokeLink(actor.userId, linkPublicId, reason.trim(), requestId);
      return { revoked: true as const };
    } catch (error) {
      mapDatabaseError(error);
    }
  }
}
