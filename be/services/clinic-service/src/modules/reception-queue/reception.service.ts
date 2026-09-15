import { HttpError } from '../../shared/http/errors.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type { ReceptionRepository, WalkInInput } from './reception.types.js';

function errorNumber(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  return 'originalError' in error ? errorNumber(error.originalError) : undefined;
}

function mapError(error: unknown): never {
  const code = errorNumber(error);
  if (code === 51002) throw new HttpError(403, 'FORBIDDEN', 'Bạn không có quyền tiếp nhận hoặc điều phối tại chi nhánh này.');
  if ([53750, 53752, 53753, 53802].includes(code ?? 0)) throw new HttpError(404, 'RECEPTION_RESOURCE_NOT_FOUND', 'Không tìm thấy dữ liệu tiếp nhận được yêu cầu.');
  if ([53206, 53212].includes(code ?? 0)) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã dùng với nội dung khác.');
  if ([53207, 53213].includes(code ?? 0)) throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'Yêu cầu trùng đang được xử lý.');
  if ([53209, 53210].includes(code ?? 0)) throw new HttpError(409, 'CHECK_IN_WINDOW_CLOSED', 'Lịch hẹn nằm ngoài cửa sổ check-in của chi nhánh.');
  if ([53208, 53211, 53214, 53215, 53216, 53217, 53218].includes(code ?? 0)) {
    throw new HttpError(409, 'RECEPTION_STATE_CONFLICT', 'Dữ liệu lịch, bệnh nhân hoặc tài nguyên tiếp nhận đã thay đổi.');
  }
  if (code === 53253) throw new HttpError(409, 'ENCOUNTER_CANCELLATION_NOT_ALLOWED', 'Chỉ có thể hủy lượt đang chờ hoặc đang khám.');
  if (code === 53254) throw new HttpError(409, 'ENCOUNTER_MEDICATION_NOT_REVERSED', 'Cần đảo toàn bộ thuốc đã cấp trước khi hủy lượt khám.');
  if (code === 53255) throw new HttpError(409, 'ENCOUNTER_HAS_PAYMENT', 'Không thể hủy lượt khám đã phát sinh thanh toán.');
  if ([53201, 53252, 53751].includes(code ?? 0)) throw new HttpError(400, 'RECEPTION_VALIDATION_ERROR', 'Thông tin tiếp nhận không hợp lệ.');
  throw error;
}

export class ReceptionService {
  constructor(private readonly repository: ReceptionRepository) {}

  async branches(actor: ClinicPrincipal, requestId: string) {
    try { return await this.repository.branches(actor, requestId); } catch (error) { mapError(error); }
  }
  async workspace(actor: ClinicPrincipal, branchPublicId: string, requestId: string) {
    try { return await this.repository.workspace(actor, branchPublicId, requestId); } catch (error) { mapError(error); }
  }
  async searchPatients(actor: ClinicPrincipal, branchPublicId: string, query: string, requestId: string) {
    try { return await this.repository.searchPatients(actor, branchPublicId, query, requestId); } catch (error) { mapError(error); }
  }
  async checkIn(actor: ClinicPrincipal, appointmentPublicId: string, priorityLevel: number,
    idempotencyKey: string, requestId: string) {
    try { return await this.repository.checkIn(actor, appointmentPublicId, priorityLevel, idempotencyKey, requestId); }
    catch (error) { mapError(error); }
  }
  async createWalkIn(actor: ClinicPrincipal, input: WalkInInput, idempotencyKey: string, requestId: string) {
    try { return await this.repository.createWalkIn(actor, input, idempotencyKey, requestId); }
    catch (error) { mapError(error); }
  }
  async callNext(actor: ClinicPrincipal, branchPublicId: string, requestId: string) {
    try { return await this.repository.callNext(actor, branchPublicId, requestId); } catch (error) { mapError(error); }
  }
  async cancelEncounter(actor: ClinicPrincipal, encounterPublicId: string, reason: string, requestId: string) {
    try {
      await this.repository.cancelEncounter(actor, encounterPublicId, reason, requestId);
      return { publicId: encounterPublicId, status: 'CANCELLED' as const };
    } catch (error) { mapError(error); }
  }
}
