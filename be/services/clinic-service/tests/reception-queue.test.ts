import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { ClinicPrincipal, PrincipalAuthenticator } from '../src/modules/identity/index.js';
import { ReceptionService } from '../src/modules/reception-queue/reception.service.js';
import type {
  QueueCommandResult, ReceptionRepository, ReceptionWorkspace, WalkInInput,
} from '../src/modules/reception-queue/reception.types.js';

const branchId = randomUUID(); const appointmentId = randomUUID(); const patientId = randomUUID();
const doctorId = randomUUID(); const roomId = randomUUID(); const serviceId = randomUUID();
const principal: ClinicPrincipal = { userId: 42, publicId: randomUUID(), tokenVersion: 1,
  roles: [{ code: 'RECEPTIONIST', branchId: 1 }] };
class Auth implements PrincipalAuthenticator {
  authenticate(token: string) { return token === 'reception' ? Promise.resolve(principal) : Promise.reject(new Error('bad token')); }
}

const result = (number: string): QueueCommandResult => ({ queueTicketPublicId: randomUUID(),
  encounterPublicId: randomUUID(), displayNumber: number });
const workspace: ReceptionWorkspace = {
  branch: { publicId: branchId, code: 'MAIN', name: 'Chi nhánh chính', timezoneName: 'SE Asia Standard Time',
    medicalLicenseNo: 'GPHĐ-001', phone: '02812345678', email: 'main@clinic.test', addressLine: '1 Nguyễn Huệ',
    ward: 'Bến Nghé', district: 'Quận 1', province: 'TP.HCM',
    businessDate: '2026-09-13', checkInEarlyMinutes: 120, checkInLateMinutes: 180 },
  queue: [{ publicId: randomUUID(), encounterPublicId: randomUUID(), displayNumber: 'A0001',
    priorityLevel: 0, status: 'WAITING',
    issuedAtUtc: '2026-09-13T01:00:00.000Z', calledAtUtc: null, serviceStartedAtUtc: null,
    encounterCode: 'LK-1', encounterSource: 'APPOINTMENT', bookingChannel: 'ONLINE',
    patient: { publicId: patientId, code: 'BN-1', fullName: 'Nguyễn An', dateOfBirth: '1990-01-02',
      gender: 'FEMALE', phone: '0900000000' },
    doctor: { publicId: doctorId, fullName: 'BS Bình' }, room: { publicId: roomId, name: 'Phòng 1' },
    initialService: { code: 'CONSULT', name: 'Khám', quantity: '1.000', unitPrice: '200000.00',
      lineTotal: '200000.00', currencyCode: 'VND' } }],
  appointments: [{ publicId: appointmentId, code: 'LH-1',
    patient: { publicId: patientId, code: 'BN-1', fullName: 'Nguyễn An' },
    doctor: { publicId: doctorId, fullName: 'BS Bình' }, service: { publicId: serviceId, name: 'Khám' },
    room: { publicId: roomId, name: 'Phòng 1' }, scheduledStartUtc: '2026-09-13T02:00:00.000Z',
    scheduledEndUtc: '2026-09-13T02:30:00.000Z', startTimeLocal: '09:00', chiefComplaint: null }],
  doctors: [{ publicId: doctorId, fullName: 'BS Bình' }], rooms: [{ publicId: roomId, code: 'P01', name: 'Phòng 1' }],
  services: [{ publicId: serviceId, code: 'CONSULT', name: 'Khám', priceAmount: '200000.00', currencyCode: 'VND' }],
  doctorServices: [{ doctorPublicId: doctorId, servicePublicId: serviceId }],
};

class MemoryReception implements ReceptionRepository {
  denied = false; checkInError?: number; cancelError?: number; calls = [result('A0002'), result('A0003')];
  cancelled: { encounterId: string; reason: string } | null = null;
  idempotency = new Map<string, { payload: string; result: QueueCommandResult }>();
  branches() { return Promise.resolve([{ publicId: branchId, code: 'MAIN', name: 'Chi nhánh chính',
    timezoneName: 'SE Asia Standard Time', medicalLicenseNo: 'GPHĐ-001', phone: '02812345678',
    email: 'main@clinic.test', addressLine: '1 Nguyễn Huệ', ward: 'Bến Nghé', district: 'Quận 1',
    province: 'TP.HCM' }]); }
  workspace() { return this.denied ? Promise.reject({ number: 51002 }) : Promise.resolve(workspace); }
  searchPatients() { return Promise.resolve([{ publicId: patientId, code: 'BN-1', fullName: 'Nguyễn An',
    dateOfBirth: '1990-01-02', gender: 'FEMALE', phone: '0900000000' }]); }
  checkIn(_actor: ClinicPrincipal, publicId: string, priority: number, key: string) {
    if (this.checkInError) return Promise.reject({ number: this.checkInError });
    return this.once(key, JSON.stringify({ publicId, priority }), 'A0004');
  }
  createWalkIn(_actor: ClinicPrincipal, input: WalkInInput, key: string) {
    return this.once(key, JSON.stringify(input), 'A0005');
  }
  callNext() { return Promise.resolve(this.calls.shift() ?? null); }
  cancelEncounter(_actor: ClinicPrincipal, encounterId: string, reason: string) {
    if (this.cancelError) return Promise.reject({ number: this.cancelError });
    this.cancelled = { encounterId, reason }; return Promise.resolve();
  }
  private once(key: string, payload: string, display: string) {
    const previous = this.idempotency.get(key);
    if (previous && previous.payload !== payload) return Promise.reject({ number: 53206 });
    if (previous) return Promise.resolve(previous.result);
    const created = result(display); this.idempotency.set(key, { payload, result: created }); return Promise.resolve(created);
  }
}

function app(repository: MemoryReception) {
  return createApp({ databaseProbe: async () => ({ database: 'test' }), principalAuthenticator: new Auth(),
    receptionService: new ReceptionService(repository) });
}
const auth = { authorization: 'Bearer reception' };

describe('reception and queue vertical slice', () => {
  let repository: MemoryReception;
  beforeEach(() => { repository = new MemoryReception(); });

  it('lists only the receptionist branch scope', async () => {
    const response = await request(app(repository)).get('/api/v1/reception/branches').set(auth);
    expect(response.status).toBe(200); expect(response.body.data[0].publicId).toBe(branchId);
  });

  it('returns the live workspace with branch policy and public identifiers', async () => {
    const response = await request(app(repository)).get('/api/v1/reception').set(auth).query({ branchPublicId: branchId });
    expect(response.status).toBe(200); expect(response.body.data.branch.checkInEarlyMinutes).toBe(120);
    expect(response.body.data.branch).toMatchObject({ medicalLicenseNo: 'GPHĐ-001', addressLine: '1 Nguyễn Huệ' });
    expect(response.body.data.queue[0].displayNumber).toBe('A0001');
    expect(response.body.data.queue[0].bookingChannel).toBe('ONLINE');
    expect(response.body.data.queue[0].patient.dateOfBirth).toBe('1990-01-02');
    expect(response.body.data.queue[0].initialService).toMatchObject({ code: 'CONSULT', lineTotal: '200000.00' });
    expect(response.body.data.queue[0]).not.toHaveProperty('queueTicketId');
  });

  it('requires authentication and idempotency for appointment check-in', async () => {
    const noAuth = await request(app(repository)).post(`/api/v1/check-ins/appointments/${appointmentId}`).send({});
    const noKey = await request(app(repository)).post(`/api/v1/check-ins/appointments/${appointmentId}`).set(auth).send({});
    expect(noAuth.status).toBe(401); expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('returns the same ticket when appointment check-in is retried', async () => {
    const key = randomUUID(); const path = `/api/v1/check-ins/appointments/${appointmentId}`;
    const first = await request(app(repository)).post(path).set(auth).set('idempotency-key', key).send({ priorityLevel: 2 });
    const retry = await request(app(repository)).post(path).set(auth).set('idempotency-key', key).send({ priorityLevel: 2 });
    expect(first.status).toBe(201); expect(retry.body.data).toEqual(first.body.data);
  });

  it('maps the configured check-in window conflict', async () => {
    repository.checkInError = 53209;
    const response = await request(app(repository)).post(`/api/v1/check-ins/appointments/${appointmentId}`)
      .set(auth).set('idempotency-key', randomUUID()).send({});
    expect(response.status).toBe(409); expect(response.body.error.code).toBe('CHECK_IN_WINDOW_CLOSED');
  });

  it('searches patients and creates a walk-in without an appointment', async () => {
    const searched = await request(app(repository)).get('/api/v1/reception/patients').set(auth)
      .query({ branchPublicId: branchId, query: 'An' });
    const created = await request(app(repository)).post('/api/v1/check-ins/walk-ins').set(auth)
      .set('idempotency-key', randomUUID()).send({ branchPublicId: branchId, patientPublicId: patientId,
        doctorPublicId: doctorId, roomPublicId: roomId, servicePublicId: serviceId, priorityLevel: 0 });
    expect(searched.body.data[0].publicId).toBe(patientId); expect(created.status).toBe(201);
    expect(created.body.data.displayNumber).toBe('A0005');
  });

  it('rejects an invalid priority before issuing a ticket', async () => {
    const response = await request(app(repository)).post('/api/v1/check-ins/walk-ins').set(auth)
      .set('idempotency-key', randomUUID()).send({ branchPublicId: branchId, patientPublicId: patientId,
        doctorPublicId: doctorId, roomPublicId: roomId, servicePublicId: serviceId, priorityLevel: 10 });
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns distinct patients to two concurrent call-next requests', async () => {
    const server = app(repository);
    const [first, second] = await Promise.all([
      request(server).post('/api/v1/queues/call-next').set(auth).send({ branchPublicId: branchId }),
      request(server).post('/api/v1/queues/call-next').set(auth).send({ branchPublicId: branchId }),
    ]);
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(new Set([first.body.data.queueTicketPublicId, second.body.data.queueTicketPublicId]).size).toBe(2);
  });

  it('cancels an encounter by public id with a mandatory reason', async () => {
    const encounterId = workspace.queue[0]!.encounterPublicId;
    const response = await request(app(repository)).post(`/api/v1/encounters/${encounterId}/cancel`).set(auth)
      .send({ reason: 'Bệnh nhân xin dừng lượt khám.' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ publicId: encounterId, status: 'CANCELLED' });
    expect(repository.cancelled).toEqual({ encounterId, reason: 'Bệnh nhân xin dừng lượt khám.' });
  });

  it('validates cancellation and reports downstream safety blockers', async () => {
    const encounterId = workspace.queue[0]!.encounterPublicId;
    const invalid = await request(app(repository)).post(`/api/v1/encounters/${encounterId}/cancel`).set(auth)
      .send({ reason: 'Ngắn' });
    repository.cancelError = 53254;
    const blocked = await request(app(repository)).post(`/api/v1/encounters/${encounterId}/cancel`).set(auth)
      .send({ reason: 'Bệnh nhân xin dừng lượt khám.' });
    expect(invalid.status).toBe(400);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ENCOUNTER_MEDICATION_NOT_REVERSED');
  });

  it('maps branch-scoped queue denial to forbidden', async () => {
    repository.denied = true;
    const response = await request(app(repository)).get('/api/v1/reception').set(auth).query({ branchPublicId: branchId });
    expect(response.status).toBe(403); expect(response.body.error.code).toBe('FORBIDDEN');
  });
});
