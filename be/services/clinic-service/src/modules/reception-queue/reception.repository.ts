import { executeCommand, sql } from '../../infrastructure/database/sql-database.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type {
  CheckInCandidate, QueueCommandResult, QueueTicket, ReceptionPatient, ReceptionRepository,
  ReceptionWorkspace, WalkInInput,
} from './reception.types.js';

type Row = Record<string, unknown>;
const dateOnly = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const utc = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const nullableUtc = (value: unknown) => value == null ? null : utc(value);

function ticket(row: Row): QueueTicket {
  return {
    publicId: String(row.publicId), encounterPublicId: String(row.encounterPublicId),
    displayNumber: String(row.displayNumber), priorityLevel: Number(row.priorityLevel), status: row.status as QueueTicket['status'],
    issuedAtUtc: utc(row.issuedAtUtc), calledAtUtc: nullableUtc(row.calledAtUtc),
    serviceStartedAtUtc: nullableUtc(row.serviceStartedAtUtc), encounterCode: String(row.encounterCode),
    encounterSource: row.encounterSource as QueueTicket['encounterSource'],
    patient: { publicId: String(row.patientPublicId), code: String(row.patientCode), fullName: String(row.patientName) },
    doctor: { publicId: String(row.doctorPublicId), fullName: String(row.doctorName) },
    room: row.roomPublicId == null ? null : { publicId: String(row.roomPublicId), name: String(row.roomName) },
  };
}

function candidate(row: Row): CheckInCandidate {
  return {
    publicId: String(row.publicId), code: String(row.code),
    patient: { publicId: String(row.patientPublicId), code: String(row.patientCode), fullName: String(row.patientName) },
    doctor: { publicId: String(row.doctorPublicId), fullName: String(row.doctorName) },
    service: { publicId: String(row.servicePublicId), name: String(row.serviceName) },
    room: { publicId: String(row.roomPublicId), name: String(row.roomName) },
    scheduledStartUtc: utc(row.scheduledStartUtc), scheduledEndUtc: utc(row.scheduledEndUtc),
    startTimeLocal: String(row.startTimeLocal).slice(0, 5),
    chiefComplaint: row.chiefComplaint == null ? null : String(row.chiefComplaint),
  };
}

function command(result: Awaited<ReturnType<typeof executeCommand>>): QueueCommandResult {
  return {
    queueTicketPublicId: String(result.output.queue_ticket_public_id),
    encounterPublicId: String(result.output.encounter_public_id),
    displayNumber: String(result.output.display_number),
  };
}

export class SqlReceptionRepository implements ReceptionRepository {
  async branches(actor: ClinicPrincipal, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_reception_branches', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
    ], { requestId, actorUserId: actor.userId });
    return result.recordset.map((row) => ({ publicId: String(row.publicId), code: String(row.code),
      name: String(row.name), timezoneName: String(row.timezoneName) }));
  }

  async workspace(actor: ClinicPrincipal, branchPublicId: string, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_get_reception', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_public_id', type: sql.UniqueIdentifier, value: branchPublicId },
    ], { requestId, actorUserId: actor.userId });
    const sets = result.recordsets as unknown as Row[][];
    const branch = sets[0]?.[0];
    if (!branch) throw new Error('Reception procedure returned no branch.');
    return {
      branch: { publicId: String(branch.publicId), code: String(branch.code), name: String(branch.name),
        timezoneName: String(branch.timezoneName), businessDate: dateOnly(branch.businessDate),
        checkInEarlyMinutes: Number(branch.checkInEarlyMinutes), checkInLateMinutes: Number(branch.checkInLateMinutes) },
      queue: (sets[1] ?? []).map(ticket), appointments: (sets[2] ?? []).map(candidate),
      doctors: (sets[3] ?? []).map((row) => ({ publicId: String(row.publicId), fullName: String(row.fullName) })),
      rooms: (sets[4] ?? []).map((row) => ({ publicId: String(row.publicId), code: String(row.code), name: String(row.name) })),
      services: (sets[5] ?? []).map((row) => ({ publicId: String(row.publicId), code: String(row.code),
        name: String(row.name), priceAmount: String(row.priceAmount), currencyCode: 'VND' as const })),
      doctorServices: (sets[6] ?? []).map((row) => ({ doctorPublicId: String(row.doctorPublicId),
        servicePublicId: String(row.servicePublicId) })),
    } satisfies ReceptionWorkspace;
  }

  async searchPatients(actor: ClinicPrincipal, branchPublicId: string, query: string, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_search_reception_patients', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_public_id', type: sql.UniqueIdentifier, value: branchPublicId },
      { name: 'query', type: sql.NVarChar(100), value: query },
    ], { requestId, actorUserId: actor.userId });
    return result.recordset.map((row): ReceptionPatient => ({ publicId: String(row.publicId), code: String(row.code),
      fullName: String(row.fullName), dateOfBirth: dateOnly(row.dateOfBirth), gender: String(row.gender),
      phone: row.phone == null ? null : String(row.phone) }));
  }

  async checkIn(actor: ClinicPrincipal, appointmentPublicId: string, priorityLevel: number,
    idempotencyKey: string, requestId: string) {
    return command(await executeCommand('dbo.sp_clinic_check_in_appointment', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'appointment_public_id', type: sql.UniqueIdentifier, value: appointmentPublicId },
      { name: 'priority_level', type: sql.TinyInt, value: priorityLevel },
      { name: 'idempotency_key', type: sql.UniqueIdentifier, value: idempotencyKey },
      { name: 'encounter_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'queue_ticket_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'display_number', type: sql.VarChar(20), value: null, direction: 'output' },
    ], { requestId, actorUserId: actor.userId }));
  }

  async createWalkIn(actor: ClinicPrincipal, input: WalkInInput, idempotencyKey: string, requestId: string) {
    return command(await executeCommand('dbo.sp_clinic_create_walk_in_encounter', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_public_id', type: sql.UniqueIdentifier, value: input.branchPublicId },
      { name: 'patient_public_id', type: sql.UniqueIdentifier, value: input.patientPublicId },
      { name: 'doctor_public_id', type: sql.UniqueIdentifier, value: input.doctorPublicId },
      { name: 'room_public_id', type: sql.UniqueIdentifier, value: input.roomPublicId },
      { name: 'service_public_id', type: sql.UniqueIdentifier, value: input.servicePublicId },
      { name: 'chief_complaint', type: sql.NVarChar(1000), value: input.chiefComplaint ?? null },
      { name: 'priority_level', type: sql.TinyInt, value: input.priorityLevel },
      { name: 'idempotency_key', type: sql.UniqueIdentifier, value: idempotencyKey },
      { name: 'encounter_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'queue_ticket_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'display_number', type: sql.VarChar(20), value: null, direction: 'output' },
    ], { requestId, actorUserId: actor.userId }));
  }

  async callNext(actor: ClinicPrincipal, branchPublicId: string, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_call_next_queue_ticket', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_public_id', type: sql.UniqueIdentifier, value: branchPublicId },
      { name: 'queue_type', type: sql.VarChar(20), value: 'GENERAL' },
      { name: 'queue_ticket_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'encounter_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
      { name: 'display_number', type: sql.VarChar(20), value: null, direction: 'output' },
    ], { requestId, actorUserId: actor.userId });
    return result.output.queue_ticket_public_id == null ? null : command(result);
  }

  async cancelEncounter(actor: ClinicPrincipal, encounterPublicId: string, reason: string, requestId: string) {
    await executeCommand('dbo.sp_clinic_cancel_encounter', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'encounter_public_id', type: sql.UniqueIdentifier, value: encounterPublicId },
      { name: 'reason', type: sql.NVarChar(500), value: reason },
    ], { requestId, actorUserId: actor.userId });
  }
}
