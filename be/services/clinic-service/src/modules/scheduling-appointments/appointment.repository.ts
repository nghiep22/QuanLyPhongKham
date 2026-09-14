import { executeCommand, getSqlPool, sql } from '../../infrastructure/database/sql-database.js';
import type { ClinicPrincipal } from '../identity/index.js';
import type {
  Appointment, AppointmentRepository, AppointmentStatus, AvailabilitySlot, BookAppointmentInput,
  CreateScheduleInput, ScheduleBreakInput, SchedulingData,
} from './appointment.types.js';

type Row = Record<string, unknown>;
const dateOnly = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const utc = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const nullableUtc = (value: unknown) => value == null ? null : utc(value);

function appointment(row: Row): Appointment {
  return {
    publicId: String(row.publicId), code: String(row.code), status: row.status as AppointmentStatus,
    bookingChannel: row.bookingChannel as Appointment['bookingChannel'],
    scheduledStartUtc: utc(row.scheduledStartUtc), scheduledEndUtc: utc(row.scheduledEndUtc),
    serviceDateLocal: dateOnly(row.serviceDateLocal), startTimeLocal: String(row.startTimeLocal).slice(0, 5),
    endTimeLocal: String(row.endTimeLocal).slice(0, 5), holdExpiresAtUtc: nullableUtc(row.holdExpiresAtUtc),
    chiefComplaint: row.chiefComplaint == null ? null : String(row.chiefComplaint),
    patientNote: row.patientNote == null ? null : String(row.patientNote),
    cancellationReason: row.cancellationReason == null ? null : String(row.cancellationReason),
    slotPublicId: String(row.slotPublicId),
    branch: { publicId: String(row.branchPublicId), name: String(row.branchName), timezoneName: String(row.timezoneName) },
    patient: { publicId: String(row.patientPublicId), code: String(row.patientCode), fullName: String(row.patientName) },
    doctor: { publicId: String(row.doctorPublicId), fullName: String(row.doctorName) },
    service: { publicId: String(row.servicePublicId), code: String(row.serviceCode), name: String(row.serviceName) },
    roomName: String(row.roomName), rowVersion: Buffer.from(row.rowVersion as Uint8Array).toString('base64'),
  };
}

function breaks(value: unknown): ScheduleBreakInput[] {
  if (typeof value !== 'string') return [];
  try { return JSON.parse(value) as ScheduleBreakInput[]; } catch { return []; }
}

export class SqlAppointmentRepository implements AppointmentRepository {
  async availability(branchPublicId: string, servicePublicId: string, fromDate: string, toDate: string,
    doctorPublicId?: string) {
    const result = await (await getSqlPool()).request()
      .input('branch_public_id', sql.UniqueIdentifier, branchPublicId)
      .input('service_public_id', sql.UniqueIdentifier, servicePublicId)
      .input('doctor_public_id', sql.UniqueIdentifier, doctorPublicId ?? null)
      .input('from_date', sql.Date, fromDate).input('to_date', sql.Date, toDate)
      .query<Row>(`SELECT slot_public_id,branch_public_id,branch_code,branch_name,timezone_name,doctor_public_id,doctor_name,
        room_public_id,room_code,room_name,service_public_id,service_code,service_name,price_amount,currency_code,
        service_date_local,start_time_local,end_time_local,starts_at_utc,ends_at_utc
        FROM dbo.v_available_appointment_slots
        WHERE branch_public_id=@branch_public_id AND service_public_id=@service_public_id
          AND service_date_local BETWEEN @from_date AND @to_date
          AND (@doctor_public_id IS NULL OR doctor_public_id=@doctor_public_id)
        ORDER BY service_date_local,start_time_local,doctor_name;`);
    return result.recordset.map((row): AvailabilitySlot => ({
      publicId: String(row.slot_public_id),
      branch: { publicId: String(row.branch_public_id), code: String(row.branch_code),
        name: String(row.branch_name), timezoneName: String(row.timezone_name) },
      doctor: { publicId: String(row.doctor_public_id), name: String(row.doctor_name) },
      service: { publicId: String(row.service_public_id), code: String(row.service_code), name: String(row.service_name),
        price: { amount: String(row.price_amount), currency: 'VND' } },
      room: { publicId: String(row.room_public_id), code: String(row.room_code), name: String(row.room_name) },
      serviceDateLocal: dateOnly(row.service_date_local), startTimeLocal: String(row.start_time_local).slice(0, 5),
      endTimeLocal: String(row.end_time_local).slice(0, 5), startsAtUtc: utc(row.starts_at_utc), endsAtUtc: utc(row.ends_at_utc),
    }));
  }

  async scheduling(actor: ClinicPrincipal, branchPublicId: string, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_get_scheduling', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_public_id', type: sql.UniqueIdentifier, value: branchPublicId },
    ], { requestId, actorUserId: actor.userId });
    const sets = result.recordsets as unknown as Row[][];
    const branch = sets[0]?.[0];
    if (!branch) throw new Error('Scheduling procedure returned no branch.');
    return {
      branch: { publicId: String(branch.publicId), code: String(branch.code), name: String(branch.name),
        timezoneName: String(branch.timezoneName), bookingHorizonDays: Number(branch.bookingHorizonDays) },
      doctors: (sets[1] ?? []).map((row) => ({ publicId: String(row.publicId), fullName: String(row.fullName),
        defaultSlotMinutes: Number(row.defaultSlotMinutes), acceptsOnlineBooking: Boolean(row.acceptsOnlineBooking) })),
      rooms: (sets[2] ?? []).map((row) => ({ publicId: String(row.publicId), code: String(row.code),
        name: String(row.name), type: String(row.type) })),
      schedules: (sets[3] ?? []).map((row) => ({ publicId: String(row.publicId), doctorPublicId: String(row.doctorPublicId),
        doctorName: String(row.doctorName), roomPublicId: String(row.roomPublicId), roomName: String(row.roomName),
        weekdayIso: Number(row.weekdayIso), localStartTime: String(row.localStartTime).slice(0, 5),
        localEndTime: String(row.localEndTime).slice(0, 5), slotDurationMinutes: Number(row.slotDurationMinutes),
        bookingHorizonDays: row.bookingHorizonDays == null ? null : Number(row.bookingHorizonDays),
        effectiveFrom: dateOnly(row.effectiveFrom), effectiveTo: row.effectiveTo == null ? null : dateOnly(row.effectiveTo),
        isActive: Boolean(row.isActive), breaks: breaks(row.breaksJson), slotCount: Number(row.slotCount),
        rowVersion: Buffer.from(row.rowVersion as Uint8Array).toString('base64') })),
    } satisfies SchedulingData;
  }

  async createSchedule(actor: ClinicPrincipal, input: CreateScheduleInput, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_create_working_schedule', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_public_id', type: sql.UniqueIdentifier, value: input.branchPublicId },
      { name: 'doctor_public_id', type: sql.UniqueIdentifier, value: input.doctorPublicId },
      { name: 'room_public_id', type: sql.UniqueIdentifier, value: input.roomPublicId },
      { name: 'weekday_iso', type: sql.TinyInt, value: input.weekdayIso },
      { name: 'local_start_time', type: sql.Time(0), value: input.localStartTime },
      { name: 'local_end_time', type: sql.Time(0), value: input.localEndTime },
      { name: 'slot_duration_min', type: sql.SmallInt, value: input.slotDurationMinutes },
      { name: 'effective_from', type: sql.Date, value: input.effectiveFrom },
      { name: 'effective_to', type: sql.Date, value: input.effectiveTo ?? null },
      { name: 'booking_horizon_days', type: sql.SmallInt, value: input.bookingHorizonDays ?? null },
      { name: 'breaks_json', type: sql.NVarChar(sql.MAX), value: JSON.stringify(input.breaks ?? []) },
      { name: 'working_schedule_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
    ], { requestId, actorUserId: actor.userId });
    return String(result.output.working_schedule_public_id);
  }

  async generateSlots(actor: ClinicPrincipal, schedulePublicId: string, fromDate: string, toDate: string, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_generate_slots', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'working_schedule_public_id', type: sql.UniqueIdentifier, value: schedulePublicId },
      { name: 'from_date_local', type: sql.Date, value: fromDate }, { name: 'to_date_local', type: sql.Date, value: toDate },
      { name: 'created_count', type: sql.Int, value: 0, direction: 'output' },
    ], { requestId, actorUserId: actor.userId });
    return Number(result.output.created_count);
  }

  async listMine(actor: ClinicPrincipal, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_list_my_appointments', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
    ], { requestId, actorUserId: actor.userId });
    return result.recordset.map(appointment);
  }

  async listAdmin(actor: ClinicPrincipal, branchPublicId: string, serviceDate: string, requestId: string,
    status?: AppointmentStatus, query?: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_list_admin_appointments', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'branch_public_id', type: sql.UniqueIdentifier, value: branchPublicId },
      { name: 'service_date_local', type: sql.Date, value: serviceDate },
      { name: 'status', type: sql.VarChar(20), value: status ?? null },
      { name: 'query', type: sql.NVarChar(100), value: query ?? null },
    ], { requestId, actorUserId: actor.userId });
    return result.recordset.map(appointment);
  }

  async get(actor: ClinicPrincipal, publicId: string, requestId: string) {
    const result = await executeCommand<Row>('dbo.sp_clinic_get_appointment', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'appointment_public_id', type: sql.UniqueIdentifier, value: publicId },
    ], { requestId, actorUserId: actor.userId });
    const row = result.recordset[0];
    if (!row) throw new Error('Appointment procedure returned no appointment.');
    return appointment(row);
  }

  async book(actor: ClinicPrincipal, input: BookAppointmentInput, idempotencyKey: string, requestId: string) {
    const result = await executeCommand('dbo.sp_clinic_book_appointment', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'patient_public_id', type: sql.UniqueIdentifier, value: input.patientPublicId },
      { name: 'slot_public_id', type: sql.UniqueIdentifier, value: input.slotPublicId },
      { name: 'service_public_id', type: sql.UniqueIdentifier, value: input.servicePublicId },
      { name: 'booking_channel', type: sql.VarChar(20), value: input.bookingChannel },
      { name: 'chief_complaint', type: sql.NVarChar(1000), value: input.chiefComplaint ?? null },
      { name: 'patient_note', type: sql.NVarChar(1000), value: input.patientNote ?? null },
      { name: 'idempotency_key', type: sql.UniqueIdentifier, value: idempotencyKey },
      { name: 'appointment_public_id', type: sql.UniqueIdentifier, value: null, direction: 'output' },
    ], { requestId, actorUserId: actor.userId });
    return String(result.output.appointment_public_id);
  }

  async reschedule(actor: ClinicPrincipal, publicId: string, slotPublicId: string, reason: string,
    idempotencyKey: string, requestId: string, servicePublicId?: string) {
    await executeCommand('dbo.sp_clinic_reschedule_appointment', [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'appointment_public_id', type: sql.UniqueIdentifier, value: publicId },
      { name: 'new_slot_public_id', type: sql.UniqueIdentifier, value: slotPublicId },
      { name: 'new_service_public_id', type: sql.UniqueIdentifier, value: servicePublicId ?? null },
      { name: 'reason', type: sql.NVarChar(500), value: reason },
      { name: 'idempotency_key', type: sql.UniqueIdentifier, value: idempotencyKey },
    ], { requestId, actorUserId: actor.userId });
  }

  private async mutate(procedure: string, actor: ClinicPrincipal, publicId: string, requestId: string,
    reason?: string) {
    await executeCommand(procedure, [
      { name: 'actor_user_id', type: sql.BigInt, value: actor.userId },
      { name: 'appointment_public_id', type: sql.UniqueIdentifier, value: publicId },
      ...(reason === undefined ? [] : [{ name: 'reason', type: sql.NVarChar(500), value: reason }]),
    ], { requestId, actorUserId: actor.userId });
  }
  confirm(actor: ClinicPrincipal, publicId: string, requestId: string) {
    return this.mutate('dbo.sp_clinic_confirm_appointment', actor, publicId, requestId);
  }
  cancel(actor: ClinicPrincipal, publicId: string, reason: string, requestId: string) {
    return this.mutate('dbo.sp_clinic_cancel_appointment', actor, publicId, requestId, reason);
  }
  noShow(actor: ClinicPrincipal, publicId: string, reason: string | undefined, requestId: string) {
    return this.mutate('dbo.sp_clinic_mark_appointment_no_show', actor, publicId, requestId, reason ?? 'Không đến');
  }
}
