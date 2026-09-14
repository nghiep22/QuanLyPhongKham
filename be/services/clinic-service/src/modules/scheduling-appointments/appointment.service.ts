import { HttpError } from '../../shared/http/errors.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type {
  AppointmentRepository, AppointmentStatus, BookAppointmentInput, CreateScheduleInput,
} from './appointment.types.js';

function number(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  return 'originalError' in error ? number(error.originalError) : undefined;
}
function mapError(error: unknown): never {
  const code = number(error);
  if ([51002, 53101, 53109].includes(code ?? 0)) throw new HttpError(403, 'FORBIDDEN', 'Bạn không có quyền thao tác lịch này.');
  if ([53100, 53104, 53108, 53129, 53740, 53741, 53742, 53743, 53744, 53745].includes(code ?? 0)) {
    throw new HttpError(404, 'SCHEDULING_RESOURCE_NOT_FOUND', 'Không tìm thấy dữ liệu lịch được yêu cầu.');
  }
  if ([53102, 53106, 53127, 53128].includes(code ?? 0)) {
    throw new HttpError(409, 'SCHEDULING_RESOURCE_BUSY', 'Tài nguyên lịch đang được cập nhật. Vui lòng thử lại.');
  }
  if ([53110, 53731].includes(code ?? 0)) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key đã dùng với nội dung khác.');
  if ([53111, 53732].includes(code ?? 0)) throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'Yêu cầu trùng đang được xử lý.');
  if ([53112, 53117, 53130, 53133, 53704].includes(code ?? 0)) throw new HttpError(409, 'SLOT_CONFLICT', 'Slot hoặc tài nguyên lịch không còn khả dụng.');
  if ([53113, 53123, 53131, 53733].includes(code ?? 0)) throw new HttpError(409, 'BOOKING_POLICY_CONFLICT', 'Đã ngoài thời hạn cho phép đặt, đổi hoặc hủy lịch.');
  if ([53115, 53116, 53132, 53734].includes(code ?? 0)) throw new HttpError(409, 'AVAILABILITY_CHANGED', 'Bác sĩ hoặc dịch vụ không còn nhận đặt lịch này.');
  if ([53114, 53118, 53119, 53120, 53122, 53125, 53126, 53134, 53135].includes(code ?? 0)) {
    throw new HttpError(409, 'APPOINTMENT_STATE_CONFLICT', 'Trạng thái lịch hẹn không cho phép thao tác này.');
  }
  if ([53103, 53105, 53107, 53121, 53124, 53700, 53701, 53702, 53703, 53705, 53706, 53730].includes(code ?? 0)) {
    throw new HttpError(400, 'SCHEDULE_VALIDATION_ERROR', 'Thông tin ca làm việc không hợp lệ.');
  }
  throw error;
}

function date(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function assertRange(fromDate: string, toDate: string, maximumDays: number) {
  const from = date(fromDate); const to = date(toDate);
  if (to < from || (to.getTime() - from.getTime()) / 86_400_000 > maximumDays) {
    throw new HttpError(400, 'DATE_RANGE_INVALID', `Khoảng ngày không được vượt quá ${maximumDays + 1} ngày.`);
  }
}

export class AppointmentService {
  constructor(private readonly repository: AppointmentRepository) {}

  availability(branchPublicId: string, servicePublicId: string, fromDate: string, toDate: string,
    doctorPublicId?: string) {
    assertRange(fromDate, toDate, 31);
    return this.repository.availability(branchPublicId, servicePublicId, fromDate, toDate, doctorPublicId);
  }
  async scheduling(actor: ClinicPrincipal, branchPublicId: string, requestId: string) {
    try { return await this.repository.scheduling(actor, branchPublicId, requestId); } catch (error) { mapError(error); }
  }
  async createSchedule(actor: ClinicPrincipal, input: CreateScheduleInput, requestId: string) {
    try {
      const publicId = await this.repository.createSchedule(actor, input, requestId);
      return { publicId };
    } catch (error) { mapError(error); }
  }
  async generateSlots(actor: ClinicPrincipal, publicId: string, fromDate: string, toDate: string, requestId: string) {
    assertRange(fromDate, toDate, 366);
    try { return { createdCount: await this.repository.generateSlots(actor, publicId, fromDate, toDate, requestId) }; }
    catch (error) { mapError(error); }
  }
  async listMine(actor: ClinicPrincipal, requestId: string) {
    try { return await this.repository.listMine(actor, requestId); } catch (error) { mapError(error); }
  }
  async listAdmin(actor: ClinicPrincipal, branchPublicId: string, serviceDate: string, requestId: string,
    status?: AppointmentStatus, query?: string) {
    try { return await this.repository.listAdmin(actor, branchPublicId, serviceDate, requestId, status, query); }
    catch (error) { mapError(error); }
  }
  async book(actor: ClinicPrincipal, input: BookAppointmentInput, idempotencyKey: string, requestId: string) {
    try {
      const publicId = await this.repository.book(actor, input, idempotencyKey, requestId);
      return await this.repository.get(actor, publicId, requestId);
    } catch (error) { mapError(error); }
  }
  async reschedule(actor: ClinicPrincipal, publicId: string, slotPublicId: string, reason: string,
    idempotencyKey: string, requestId: string, servicePublicId?: string) {
    try {
      await this.repository.reschedule(actor, publicId, slotPublicId, reason, idempotencyKey, requestId, servicePublicId);
      return await this.repository.get(actor, publicId, requestId);
    } catch (error) { mapError(error); }
  }
  private async mutate(actor: ClinicPrincipal, publicId: string, requestId: string,
    operation: () => Promise<void>) {
    try { await operation(); return await this.repository.get(actor, publicId, requestId); }
    catch (error) { mapError(error); }
  }
  async confirm(actor: ClinicPrincipal, publicId: string, requestId: string) {
    const item = await this.mutate(actor, publicId, requestId,
      () => this.repository.confirm(actor, publicId, requestId));
    if (item.status === 'EXPIRED') {
      throw new HttpError(409, 'APPOINTMENT_STATE_CONFLICT', 'Giữ chỗ đã hết hạn; lịch được chuyển sang hết hạn.');
    }
    return item;
  }
  cancel(actor: ClinicPrincipal, publicId: string, reason: string, requestId: string) {
    return this.mutate(actor, publicId, requestId, () => this.repository.cancel(actor, publicId, reason, requestId));
  }
  noShow(actor: ClinicPrincipal, publicId: string, reason: string | undefined, requestId: string) {
    return this.mutate(actor, publicId, requestId, () => this.repository.noShow(actor, publicId, reason, requestId));
  }
}
