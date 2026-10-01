import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { ClinicPrincipal, PrincipalAuthenticator } from '../src/modules/identity/index.js';
import { AppointmentService } from '../src/modules/scheduling-appointments/appointment.service.js';
import type {
  Appointment, AppointmentRepository, AppointmentStatus, AvailabilitySlot, BookAppointmentInput,
  CreateScheduleInput, DoctorTimeOff, DoctorWorkingSchedule, RequestTimeOffInput,
  ScheduleWorkflowStatus, SchedulingData,
} from '../src/modules/scheduling-appointments/appointment.types.js';

const branchId = randomUUID(); const serviceId = randomUUID(); const doctorId = randomUUID();
const slotId = randomUUID(); const patientId = randomUUID(); const appointmentId = randomUUID();
const principals: Record<string, ClinicPrincipal> = {
  patient: { userId: 10, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'PATIENT', branchId: null }] },
  manager: { userId: 20, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'MANAGER', branchId: 1 }] },
  doctor: { userId: 30, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'DOCTOR', branchId: 1 }] },
};
class Auth implements PrincipalAuthenticator {
  authenticate(token: string) { return principals[token] ? Promise.resolve(principals[token]!) : Promise.reject(new Error('bad token')); }
}

const slot: AvailabilitySlot = {
  publicId: slotId, branch: { publicId: branchId, code: 'MAIN', name: 'Chi nhánh chính', timezoneName: 'SE Asia Standard Time' },
  doctor: { publicId: doctorId, name: 'BS An' }, service: { publicId: serviceId, code: 'CONSULT', name: 'Khám',
    price: { amount: '200000.00', currency: 'VND' } }, room: { publicId: randomUUID(), code: 'P01', name: 'Phòng 1' },
  serviceDateLocal: '2026-09-20', startTimeLocal: '08:00', endTimeLocal: '08:30',
  startsAtUtc: '2026-09-20T01:00:00.000Z', endsAtUtc: '2026-09-20T01:30:00.000Z',
};
const appointment: Appointment = {
  publicId: appointmentId, code: 'LH-20260920-0001', status: 'PENDING', bookingChannel: 'ONLINE',
  scheduledStartUtc: slot.startsAtUtc, scheduledEndUtc: slot.endsAtUtc, serviceDateLocal: slot.serviceDateLocal,
  startTimeLocal: slot.startTimeLocal, endTimeLocal: slot.endTimeLocal, holdExpiresAtUtc: '2026-09-13T04:30:00.000Z',
  chiefComplaint: 'Đau đầu', patientNote: null, cancellationReason: null, slotPublicId: slotId,
  branch: { publicId: branchId, name: 'Chi nhánh chính', timezoneName: 'SE Asia Standard Time' },
  patient: { publicId: patientId, code: 'BN-01', fullName: 'Nguyễn An' },
  doctor: { publicId: doctorId, fullName: 'BS An' }, service: { publicId: serviceId, code: 'CONSULT', name: 'Khám' },
  roomName: 'Phòng 1', rowVersion: 'AAAAAAAAAAE=',
};

class MemoryAppointments implements AppointmentRepository {
  item = { ...appointment };
  used = new Map<string, string>();
  denied = false;
  expireOnConfirm = false;
  scheduleStatus: ScheduleWorkflowStatus = 'PROPOSED';
  scheduleId = randomUUID();
  timeOffItem: DoctorTimeOff | null = null;
  timeOffConflicts = false;
  availability() { return Promise.resolve([slot]); }
  adminAvailability(actor: ClinicPrincipal) {
    return actor.userId === principals.manager.userId ? Promise.resolve([slot]) : Promise.reject({ number: 51002 });
  }
  scheduling(): Promise<SchedulingData> {
    if (this.denied) return Promise.reject({ number: 51002 });
    return Promise.resolve({ branch: { publicId: branchId, code: 'MAIN', name: 'Chi nhánh chính',
      timezoneName: 'SE Asia Standard Time', bookingHorizonDays: 60 },
    doctors: [{ publicId: doctorId, fullName: 'BS An', defaultSlotMinutes: 30, acceptsOnlineBooking: true }],
    rooms: [{ publicId: slot.room.publicId, code: 'P01', name: 'Phòng 1', type: 'CONSULTATION' }], schedules: [] });
  }
  createSchedule(_actor: ClinicPrincipal, _input: CreateScheduleInput) {
    this.scheduleStatus = 'PROPOSED'; return Promise.resolve(this.scheduleId);
  }
  listMySchedules(actor: ClinicPrincipal): Promise<DoctorWorkingSchedule[]> {
    if (actor.userId !== principals.doctor.userId) return Promise.reject({ number: 51002 });
    return Promise.resolve([{ publicId: this.scheduleId, branchPublicId: branchId, branchName: 'Chi nhánh chính',
      timezoneName: 'SE Asia Standard Time', roomName: 'Phòng 1', weekdayIso: 1, localStartTime: '08:00',
      localEndTime: '12:00', slotDurationMinutes: 30, effectiveFrom: '2026-09-20', effectiveTo: null,
      workflowStatus: this.scheduleStatus, decisionNote: null, breaks: [] }]);
  }
  decideSchedule(actor: ClinicPrincipal, _id: string, decision: 'CONFIRM' | 'REJECT') {
    if (actor.userId !== principals.doctor.userId) return Promise.reject({ number: 51002 });
    if (this.scheduleStatus !== 'PROPOSED') return Promise.reject({ number: 53750 });
    this.scheduleStatus = decision === 'CONFIRM' ? 'DOCTOR_CONFIRMED' : 'REJECTED';
    return Promise.resolve();
  }
  publishSchedule(actor: ClinicPrincipal) {
    if (actor.userId !== principals.manager.userId) return Promise.reject({ number: 51002 });
    if (this.scheduleStatus !== 'DOCTOR_CONFIRMED') return Promise.reject({ number: 53750 });
    this.scheduleStatus = 'PUBLISHED'; return Promise.resolve();
  }
  generateSlots() {
    return this.scheduleStatus === 'PUBLISHED' ? Promise.resolve(8) : Promise.reject({ number: 53104 });
  }
  requestTimeOff(actor: ClinicPrincipal, input: RequestTimeOffInput) {
    if (actor.userId !== principals.doctor.userId) return Promise.reject({ number: 51002 });
    const id = randomUUID();
    this.timeOffItem = { publicId: id, branchPublicId: input.branchPublicId, branchName: 'Chi nhánh chính',
      doctorName: 'BS An', serviceDate: input.serviceDate, localStartTime: input.localStartTime,
      localEndTime: input.localEndTime, reason: input.reason, decisionNote: null, status: 'PENDING',
      appointmentConflictCount: this.timeOffConflicts ? 1 : 0 };
    return Promise.resolve(id);
  }
  listTimeOff(actor: ClinicPrincipal, branchPublicId: string | null) {
    if (branchPublicId && actor.userId !== principals.manager.userId) return Promise.reject({ number: 51002 });
    if (!branchPublicId && actor.userId !== principals.doctor.userId) return Promise.reject({ number: 51002 });
    return Promise.resolve(this.timeOffItem ? [this.timeOffItem] : []);
  }
  decideTimeOff(actor: ClinicPrincipal, _id: string, decision: 'APPROVE' | 'REJECT' | 'CANCEL') {
    if (!this.timeOffItem || this.timeOffItem.status !== 'PENDING') return Promise.reject({ number: 53750 });
    if (decision === 'CANCEL' ? actor.userId !== principals.doctor.userId : actor.userId !== principals.manager.userId)
      return Promise.reject({ number: 51002 });
    if (decision === 'APPROVE' && this.timeOffConflicts) return Promise.reject({ number: 52009 });
    this.timeOffItem.status = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'CANCELLED';
    return Promise.resolve();
  }
  listMine() { return this.denied ? Promise.reject({ number: 51002 }) : Promise.resolve([this.item]); }
  listAdmin(_actor: ClinicPrincipal, _branch: string, _date: string, _request: string,
    status?: AppointmentStatus) { return Promise.resolve(status && status !== this.item.status ? [] : [this.item]); }
  get() { return Promise.resolve(this.item); }
  book(_actor: ClinicPrincipal, input: BookAppointmentInput, idempotencyKey: string) {
    const payload = JSON.stringify(input); const old = this.used.get(idempotencyKey);
    if (old && old !== payload) return Promise.reject({ number: 53110 });
    this.used.set(idempotencyKey, payload); return Promise.resolve(this.item.publicId);
  }
  reschedule(_actor: ClinicPrincipal, _publicId: string, newSlot: string, _reason: string, key: string) {
    if (this.used.has(key)) return Promise.reject({ number: 53731 });
    this.used.set(key, newSlot); this.item = { ...this.item, slotPublicId: newSlot }; return Promise.resolve();
  }
  confirm() { this.item = { ...this.item, status: this.expireOnConfirm ? 'EXPIRED' : 'CONFIRMED', holdExpiresAtUtc: null };
    return Promise.resolve(); }
  cancel(_actor: ClinicPrincipal, _id: string, reason: string) {
    this.item = { ...this.item, status: 'CANCELLED', cancellationReason: reason, holdExpiresAtUtc: null }; return Promise.resolve();
  }
  noShow() { this.item = { ...this.item, status: 'NO_SHOW' }; return Promise.resolve(); }
}

function app(repo: MemoryAppointments) { return createApp({ databaseProbe: async () => ({ database: 'test' }),
  principalAuthenticator: new Auth(), appointmentService: new AppointmentService(repo) }); }
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('scheduling and appointment vertical slice', () => {
  it('scopes staff availability and accepts the branch GUID returned by SQL', async () => {
    const server = app(new MemoryAppointments());
    const query = { branchPublicId: branchId, servicePublicId: serviceId, serviceDate: '2026-09-20' };
    const allowed = await request(server).get('/api/v1/admin/appointments/availability')
      .set(auth('manager')).query(query);
    const denied = await request(server).get('/api/v1/admin/appointments/availability')
      .set(auth('patient')).query(query);
    expect(allowed.status).toBe(200); expect(allowed.body.data[0].publicId).toBe(slotId);
    expect(denied.status).toBe(403);
  });
  let repo: MemoryAppointments;
  beforeEach(() => { repo = new MemoryAppointments(); });

  it('publishes service-scoped available slots without internal IDs', async () => {
    const response = await request(app(repo)).get('/api/v1/public/availability').query({ branchPublicId: branchId,
      servicePublicId: serviceId, fromDate: '2026-09-20', toDate: '2026-09-21' });
    expect(response.status).toBe(200);
    expect(response.body.data[0].publicId).toBe(slotId);
    expect(response.body.data[0]).not.toHaveProperty('id');
  });

  it('rejects invalid or excessive availability ranges', async () => {
    const response = await request(app(repo)).get('/api/v1/public/availability').query({ branchPublicId: branchId,
      servicePublicId: serviceId, fromDate: '2026-09-20', toDate: '2026-11-20' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DATE_RANGE_INVALID');
    const invalidDate = await request(app(repo)).get('/api/v1/public/availability').query({ branchPublicId: branchId,
      servicePublicId: serviceId, fromDate: '2026-02-30', toDate: '2026-03-01' });
    expect(invalidDate.status).toBe(400);
    expect(invalidDate.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication and idempotency for online booking', async () => {
    const body = { patientPublicId: patientId, slotPublicId: slotId, servicePublicId: serviceId };
    const noAuth = await request(app(repo)).post('/api/v1/appointments').set('idempotency-key', randomUUID()).send(body);
    const noKey = await request(app(repo)).post('/api/v1/appointments').set(auth('patient')).send(body);
    expect(noAuth.status).toBe(401);
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('books online and safely returns the same appointment on a retry', async () => {
    const body = { patientPublicId: patientId, slotPublicId: slotId, servicePublicId: serviceId, chiefComplaint: 'Đau đầu' };
    const key = randomUUID();
    const first = await request(app(repo)).post('/api/v1/appointments').set(auth('patient')).set('idempotency-key', key).send(body);
    const retry = await request(app(repo)).post('/api/v1/appointments').set(auth('patient')).set('idempotency-key', key).send(body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.data.publicId).toBe(first.body.data.publicId);
  });

  it('rejects an idempotency key reused with another payload', async () => {
    const key = randomUUID(); const body = { patientPublicId: patientId, slotPublicId: slotId, servicePublicId: serviceId };
    await request(app(repo)).post('/api/v1/appointments').set(auth('patient')).set('idempotency-key', key).send(body);
    const response = await request(app(repo)).post('/api/v1/appointments').set(auth('patient'))
      .set('idempotency-key', key).send({ ...body, patientNote: 'Khác' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('lets patients list and cancel an authorized appointment', async () => {
    const listed = await request(app(repo)).get('/api/v1/appointments').set(auth('patient'));
    const cancelled = await request(app(repo)).post(`/api/v1/appointments/${appointmentId}/cancel`)
      .set(auth('patient')).send({ reason: 'Không thể đến đúng giờ' });
    expect(listed.status).toBe(200);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
  });

  it('supports staff schedule creation, generation and daily appointment views', async () => {
    const schedule = { branchPublicId: branchId, doctorPublicId: doctorId, roomPublicId: slot.room.publicId,
      weekdayIso: 1, localStartTime: '08:00', localEndTime: '12:00', slotDurationMinutes: 30,
      effectiveFrom: '2026-09-20', breaks: [{ localStartTime: '10:00', localEndTime: '10:30', breakName: 'Nghỉ' }] };
    const created = await request(app(repo)).post('/api/v1/schedules').set(auth('manager')).send(schedule);
    const premature = await request(app(repo)).post(`/api/v1/schedules/${created.body.data.publicId}/generate-slots`)
      .set(auth('manager')).send({ fromDate: '2026-09-20', toDate: '2026-09-30' });
    const mySchedules = await request(app(repo)).get('/api/v1/schedules/mine').set(auth('doctor'));
    const confirmed = await request(app(repo)).post(`/api/v1/schedules/${created.body.data.publicId}/confirm`)
      .set(auth('doctor'));
    const published = await request(app(repo)).post(`/api/v1/schedules/${created.body.data.publicId}/publish`)
      .set(auth('manager'));
    const generated = await request(app(repo)).post(`/api/v1/schedules/${created.body.data.publicId}/generate-slots`)
      .set(auth('manager')).send({ fromDate: '2026-09-20', toDate: '2026-09-30' });
    const daily = await request(app(repo)).get('/api/v1/admin/appointments').set(auth('manager'))
      .query({ branchPublicId: branchId, serviceDate: '2026-09-20', status: 'PENDING' });
    expect(created.status).toBe(201);
    expect(premature.status).toBe(404);
    expect(mySchedules.body.data[0].workflowStatus).toBe('PROPOSED');
    expect(confirmed.status).toBe(200);
    expect(published.status).toBe(200);
    expect(generated.body.data.createdCount).toBe(8);
    expect(daily.body.data).toHaveLength(1);
  });

  it('enforces doctor ownership, decision state, and a reason for rejection', async () => {
    const denied = await request(app(repo)).post(`/api/v1/schedules/${repo.scheduleId}/confirm`).set(auth('manager'));
    const invalid = await request(app(repo)).post(`/api/v1/schedules/${repo.scheduleId}/reject`)
      .set(auth('doctor')).send({ reason: 'x' });
    const rejected = await request(app(repo)).post(`/api/v1/schedules/${repo.scheduleId}/reject`)
      .set(auth('doctor')).send({ reason: 'Trùng lịch trực bệnh viện' });
    const publish = await request(app(repo)).post(`/api/v1/schedules/${repo.scheduleId}/publish`).set(auth('manager'));
    expect(denied.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(rejected.status).toBe(200);
    expect(publish.status).toBe(409);
  });

  it('lets a doctor report hospital duty and blocks approval while appointments conflict', async () => {
    const input = { branchPublicId: branchId, serviceDate: '2026-10-01', localStartTime: '08:00',
      localEndTime: '12:00', reason: 'Bệnh viện đổi lịch trực' };
    repo.timeOffConflicts = true;
    const created = await request(app(repo)).post('/api/v1/schedules/time-off').set(auth('doctor')).send(input);
    const listed = await request(app(repo)).get('/api/v1/schedules/time-off').set(auth('manager'))
      .query({ branchPublicId: branchId });
    const denied = await request(app(repo)).post(`/api/v1/schedules/time-off/${created.body.data.publicId}/approve`)
      .set(auth('doctor'));
    const conflict = await request(app(repo)).post(`/api/v1/schedules/time-off/${created.body.data.publicId}/approve`)
      .set(auth('manager'));
    expect(created.status).toBe(201);
    expect(listed.body.data[0].appointmentConflictCount).toBe(1);
    expect(denied.status).toBe(403);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('TIME_OFF_APPOINTMENTS_CONFLICT');
    repo.timeOffConflicts = false;
    const approved = await request(app(repo)).post(`/api/v1/schedules/time-off/${created.body.data.publicId}/approve`)
      .set(auth('manager'));
    expect(approved.status).toBe(200);
  });

  it('reports a hold that expires during confirmation after persisting the transition', async () => {
    repo.expireOnConfirm = true;
    const response = await request(app(repo)).post(`/api/v1/admin/appointments/${appointmentId}/confirm`).set(auth('manager'));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('APPOINTMENT_STATE_CONFLICT');
    expect(repo.item.status).toBe('EXPIRED');
  });

  it('accepts an omitted no-show reason body', async () => {
    const response = await request(app(repo)).post(`/api/v1/admin/appointments/${appointmentId}/no-show`).set(auth('manager'));
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('NO_SHOW');
  });

  it('maps branch-scoped schedule denial to forbidden', async () => {
    repo.denied = true;
    const response = await request(app(repo)).get('/api/v1/schedules').set(auth('manager')).query({ branchPublicId: branchId });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
