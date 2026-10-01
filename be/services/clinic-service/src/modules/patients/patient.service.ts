import { HttpError } from '../../shared/http/errors.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type { CreatePatientInput, EmergencyContact, PatientAllergyInput, PatientConditionInput, PatientInput, PatientRepository } from './patient.types.js';

function errorNumber(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  if ('originalError' in error) return errorNumber(error.originalError);
  return undefined;
}
function mapError(error: unknown): never {
  const number = errorNumber(error);
  if (number === 51002 || number === 53650) {
    throw new HttpError(403, 'FORBIDDEN', 'Bạn không có quyền xem hồ sơ trong phạm vi này.');
  }
  if (number === 53635) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Không tìm thấy hồ sơ bệnh nhân.');
  if (number === 53636) throw new HttpError(409, 'PATIENT_VERSION_CONFLICT', 'Hồ sơ đã thay đổi. Vui lòng tải lại.');
  if (number === 53630) throw new HttpError(409, 'POSSIBLE_DUPLICATE', 'Có hồ sơ có thể trùng. Hãy kiểm tra trước khi xác nhận tạo.');
  if (number === 2601 || number === 2627) {
    throw new HttpError(409, 'PATIENT_ID_CONFLICT', 'Mã định danh đã được sử dụng.');
  }
  if (number === 53637) throw new HttpError(400, 'EMERGENCY_CONTACTS_INVALID', 'Danh sách liên hệ khẩn cấp không hợp lệ.');
  if (number === 53638) throw new HttpError(400, 'PATIENT_HEALTH_INVALID', 'Dữ liệu sức khỏe hoặc lý do không hợp lệ.');
  if (number === 53639 || number === 53640)
    throw new HttpError(409, 'PATIENT_HEALTH_DUPLICATE', 'Mục sức khỏe này đã được ghi nhận và còn hiệu lực.');
  if (number === 53641) throw new HttpError(404, 'PATIENT_HEALTH_NOT_FOUND', 'Không tìm thấy mục đang hiệu lực.');
  if (number === 53660 || number === 53661)
    throw new HttpError(400, 'PATIENT_MERGE_INVALID', 'Hồ sơ hoặc lý do gộp không hợp lệ.');
  if (number === 53662) throw new HttpError(503, 'PATIENT_MERGE_BUSY', 'Hệ thống đang xử lý gộp hồ sơ khác.');
  if (number === 53663) throw new HttpError(409, 'PATIENT_MERGE_IDENTITY_CONFLICT', 'Ngày sinh, giới tính hoặc định danh không khớp.');
  if (number === 53664 || number === 53665 || number === 53666 || number === 53667)
    throw new HttpError(409, 'PATIENT_MERGE_BLOCKED', 'Hồ sơ còn công việc mở hoặc liên kết tài khoản cần xử lý.');
  if (number === 53013 || number === 53631) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Ngày sinh hoặc lý do xác nhận hồ sơ trùng không hợp lệ.');
  }
  throw error;
}

export class PatientService {
  constructor(private readonly repository: PatientRepository) {}

  async branches(actor: ClinicPrincipal) {
    const branches = await this.repository.branches(actor.userId);
    if (!branches.length) throw new HttpError(403, 'FORBIDDEN', 'Bạn không có chi nhánh quản lý bệnh nhân.');
    return branches.map(({ id: _id, ...branch }) => branch);
  }

  private async branch(publicId: string) {
    const branch = await this.repository.resolveBranch(publicId);
    if (!branch) throw new HttpError(404, 'BRANCH_NOT_FOUND', 'Không tìm thấy chi nhánh đang hoạt động.');
    return branch;
  }

  async search(actor: ClinicPrincipal, branchPublicId: string, requestId: string, query?: string, dateOfBirth?: string) {
    const branch = await this.branch(branchPublicId);
    try { return await this.repository.search(actor.userId, branch.id, requestId, query, dateOfBirth); }
    catch (error) { mapError(error); }
  }

  async duplicates(actor: ClinicPrincipal, branchPublicId: string, requestId: string, input: PatientInput) {
    const branch = await this.branch(branchPublicId);
    try { return await this.repository.duplicates(actor.userId, branch.id, requestId, input); }
    catch (error) { mapError(error); }
  }

  async get(actor: ClinicPrincipal, branchPublicId: string, publicId: string, requestId: string) {
    const branch = await this.branch(branchPublicId);
    try {
      const patient = await this.repository.get(actor.userId, branch.id, publicId, requestId);
      if (!patient) throw new HttpError(404, 'PATIENT_NOT_FOUND', 'Không tìm thấy hồ sơ bệnh nhân.');
      return patient;
    } catch (error) { mapError(error); }
  }

  async create(actor: ClinicPrincipal, input: CreatePatientInput, requestId: string) {
    const branch = await this.branch(input.branchPublicId);
    try {
      const publicId = await this.repository.create(actor, branch.id, input, requestId);
      return await this.get(actor, input.branchPublicId, publicId, requestId);
    } catch (error) { mapError(error); }
  }

  async update(actor: ClinicPrincipal, branchPublicId: string, publicId: string, input: PatientInput,
    expectedVersion: string, requestId: string) {
    const branch = await this.branch(branchPublicId);
    try {
      await this.repository.update(actor, branch.id, publicId, input, expectedVersion, requestId);
      return await this.get(actor, branchPublicId, publicId, requestId);
    } catch (error) { mapError(error); }
  }

  async replaceEmergencyContacts(actor: ClinicPrincipal, branchPublicId: string, publicId: string,
    contacts: EmergencyContact[], expectedVersion: string, requestId: string) {
    const branch = await this.branch(branchPublicId);
    try {
      await this.repository.replaceEmergencyContacts(actor, branch.id, publicId, contacts, expectedVersion, requestId);
      return await this.get(actor, branchPublicId, publicId, requestId);
    } catch (error) { mapError(error); }
  }

  async myEmergencyContacts(actor: ClinicPrincipal, publicId: string, requestId: string) {
    try { return await this.repository.myEmergencyContacts(actor, publicId, requestId); }
    catch (error) { mapError(error); }
  }

  async replaceMyEmergencyContacts(actor: ClinicPrincipal, publicId: string, contacts: EmergencyContact[],
    expectedVersion: string, requestId: string) {
    try {
      await this.repository.replaceMyEmergencyContacts(actor, publicId, contacts, expectedVersion, requestId);
      return await this.repository.myEmergencyContacts(actor, publicId, requestId);
    } catch (error) { mapError(error); }
  }

  async previewMerge(actor: ClinicPrincipal, sourcePublicId: string, targetPublicId: string, requestId: string) {
    try { return await this.repository.previewMerge(actor, sourcePublicId, targetPublicId, requestId); }
    catch (error) { mapError(error); }
  }

  async merge(actor: ClinicPrincipal, sourcePublicId: string, targetPublicId: string,
    sourceVersion: string, targetVersion: string, reason: string, requestId: string) {
    try { return await this.repository.merge(actor, sourcePublicId, targetPublicId,
      sourceVersion, targetVersion, reason, requestId); }
    catch (error) { mapError(error); }
  }

  async mergeHistory(actor: ClinicPrincipal, targetPublicId: string, requestId: string) {
    try { return await this.repository.mergeHistory(actor, targetPublicId, requestId); }
    catch (error) { mapError(error); }
  }

  async clinicalSummary(actor: ClinicPrincipal, branchPublicId: string, publicId: string, requestId: string) {
    const branch = await this.branch(branchPublicId);
    try { return await this.repository.clinicalSummary(actor, branch.id, publicId, requestId); }
    catch (error) { mapError(error); }
  }

  async addAllergy(actor: ClinicPrincipal, branchPublicId: string, publicId: string,
    input: PatientAllergyInput, requestId: string) {
    const branch = await this.branch(branchPublicId);
    try { return { publicId: await this.repository.addAllergy(actor, branch.id, publicId, input, requestId) }; }
    catch (error) { mapError(error); }
  }

  async deactivateAllergy(actor: ClinicPrincipal, branchPublicId: string, publicId: string,
    allergyId: string, reason: string, requestId: string) {
    const branch = await this.branch(branchPublicId);
    try { await this.repository.deactivateAllergy(actor, branch.id, publicId, allergyId, reason, requestId);
      return { publicId: allergyId }; }
    catch (error) { mapError(error); }
  }

  async addCondition(actor: ClinicPrincipal, branchPublicId: string, publicId: string,
    input: PatientConditionInput, requestId: string) {
    const branch = await this.branch(branchPublicId);
    try { return { publicId: await this.repository.addCondition(actor, branch.id, publicId, input, requestId) }; }
    catch (error) { mapError(error); }
  }

  async resolveCondition(actor: ClinicPrincipal, branchPublicId: string, publicId: string,
    conditionId: string, reason: string, requestId: string) {
    const branch = await this.branch(branchPublicId);
    try { await this.repository.resolveCondition(actor, branch.id, publicId, conditionId, reason, requestId);
      return { publicId: conditionId }; }
    catch (error) { mapError(error); }
  }
}
