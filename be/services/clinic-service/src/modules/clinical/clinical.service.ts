import { HttpError } from '../../shared/http/errors.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type {
  AmendmentInput, ClinicalNotesInput, ClinicalRepository, DiagnosisInput, EncounterStatus,
  FinalizeResultInput, OrderServiceInput, VitalSignsInput,
} from './clinical.types.js';

function errorNumber(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if ('number' in error && typeof error.number === 'number') return error.number;
  return 'originalError' in error ? errorNumber(error.originalError) : undefined;
}

function mapError(error: unknown): never {
  const code = errorNumber(error);
  if (code === 53256) {
    throw new HttpError(409, 'CLINICAL_QUEUE_NOT_CALLED', 'Số hàng đợi chưa được gọi. Hãy gọi số trước khi bắt đầu khám.');
  }
  if (code === 53265) {
    throw new HttpError(409, 'CLINICAL_QUEUE_BYPASS_REASON_REQUIRED', 'Ngoại lệ bắt đầu khám cần lý do tối thiểu 10 ký tự.');
  }
  if (code === 53266) {
    throw new HttpError(409, 'CLINICAL_QUEUE_ORDER_CONFLICT', 'Còn lượt ưu tiên hoặc FIFO đứng trước trong hàng đợi.');
  }
  if (code === 53267) {
    throw new HttpError(400, 'CLINICAL_RESULT_SCHEMA_MISMATCH', 'Kết quả không khớp schema của dịch vụ khi được chỉ định.');
  }
  if (code === 51002 || [53219, 53222, 53224, 53226, 53230, 53236, 53241, 53249,
    53259, 53260, 53261, 53264].includes(code ?? 0)) {
    throw new HttpError(403, 'CLINICAL_FORBIDDEN', 'Bạn không có quyền thực hiện thao tác lâm sàng này.');
  }
  if ([53801, 53802, 53803, 53804, 53806].includes(code ?? 0)) {
    throw new HttpError(404, 'CLINICAL_RESOURCE_NOT_FOUND', 'Không tìm thấy lượt khám hoặc tài nguyên lâm sàng.');
  }
  if ([2601, 2627, 53220, 53223, 53225, 53227, 53228, 53231, 53234, 53235, 53237,
    53238, 53239, 53240, 53244, 53245, 53246, 53247, 53250, 53251, 53262, 53263,
    52031, 52032, 52033, 52035, 52036, 52037].includes(code ?? 0)) {
    throw new HttpError(409, 'CLINICAL_STATE_CONFLICT', 'Trạng thái hồ sơ vừa thay đổi hoặc chưa đủ điều kiện.');
  }
  if ([53221, 53229, 53232, 53233, 53242, 53243, 53248, 53257, 53258, 53805].includes(code ?? 0)) {
    throw new HttpError(400, 'CLINICAL_VALIDATION_ERROR', 'Dữ liệu lâm sàng không hợp lệ.');
  }
  throw error;
}

export class ClinicalService {
  constructor(private readonly repository: ClinicalRepository) {}

  async branches(actor: ClinicPrincipal, requestId: string) {
    try { return await this.repository.branches(actor, requestId); } catch (error) { mapError(error); }
  }
  async list(actor: ClinicPrincipal, branchPublicId: string, statuses: EncounterStatus[], requestId: string) {
    try { return await this.repository.list(actor, branchPublicId, statuses, requestId); } catch (error) { mapError(error); }
  }
  async get(actor: ClinicPrincipal, encounterPublicId: string, requestId: string) {
    try { return await this.repository.get(actor, encounterPublicId, requestId); } catch (error) { mapError(error); }
  }
  async start(actor: ClinicPrincipal, encounterPublicId: string, roomPublicId: string | null,
    queueBypassReason: string | null, requestId: string) {
    try { await this.repository.start(actor, encounterPublicId, roomPublicId, queueBypassReason, requestId); }
    catch (error) { mapError(error); }
  }
  async updateNotes(actor: ClinicPrincipal, encounterPublicId: string, input: ClinicalNotesInput, requestId: string) {
    try { await this.repository.updateNotes(actor, encounterPublicId, input, requestId); } catch (error) { mapError(error); }
  }
  async addVitalSigns(actor: ClinicPrincipal, encounterPublicId: string, input: VitalSignsInput, requestId: string) {
    try { return await this.repository.addVitalSigns(actor, encounterPublicId, input, requestId); } catch (error) { mapError(error); }
  }
  async addDiagnosis(actor: ClinicPrincipal, encounterPublicId: string, input: DiagnosisInput, requestId: string) {
    try { return await this.repository.addDiagnosis(actor, encounterPublicId, input, requestId); } catch (error) { mapError(error); }
  }
  async orderService(actor: ClinicPrincipal, encounterPublicId: string, input: OrderServiceInput, requestId: string) {
    try { return await this.repository.orderService(actor, encounterPublicId, input, requestId); } catch (error) { mapError(error); }
  }
  async finalizeResult(actor: ClinicPrincipal, servicePublicId: string, input: FinalizeResultInput, requestId: string) {
    try { return await this.repository.finalizeResult(actor, servicePublicId, input, requestId); } catch (error) { mapError(error); }
  }
  async complete(actor: ClinicPrincipal, encounterPublicId: string, requestId: string) {
    try { await this.repository.complete(actor, encounterPublicId, requestId); } catch (error) { mapError(error); }
  }
  async sign(actor: ClinicPrincipal, encounterPublicId: string, requestId: string) {
    try { return await this.repository.sign(actor, encounterPublicId, requestId); } catch (error) { mapError(error); }
  }
  async releaseToPatient(actor: ClinicPrincipal, encounterPublicId: string, requestId: string) {
    try { await this.repository.releaseToPatient(actor, encounterPublicId, requestId); } catch (error) { mapError(error); }
  }
  async amend(actor: ClinicPrincipal, encounterPublicId: string, input: AmendmentInput, requestId: string) {
    try { return await this.repository.amend(actor, encounterPublicId, input, requestId); } catch (error) { mapError(error); }
  }
  async patientHistory(actor: ClinicPrincipal, patientPublicId: string, requestId: string) {
    try { return await this.repository.patientHistory(actor, patientPublicId, requestId); } catch (error) { mapError(error); }
  }
  async patientRecord(actor: ClinicPrincipal, patientPublicId: string, encounterPublicId: string, requestId: string) {
    try { return await this.repository.patientRecord(actor, patientPublicId, encounterPublicId, requestId); }
    catch (error) { mapError(error); }
  }
}
