import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ClinicalService } from '../src/modules/clinical/clinical.service.js';
import type {
  AmendmentInput, ClinicalEncounterDetail, ClinicalNotesInput, ClinicalRepository,
  DiagnosisInput, EncounterStatus, FinalizeResultInput, OrderServiceInput, VitalSignsInput,
} from '../src/modules/clinical/clinical.types.js';
import type { ClinicPrincipal, PrincipalAuthenticator } from '../src/modules/identity/index.js';

const branchId = randomUUID(); const encounterId = randomUUID(); const serviceId = randomUUID();
const principal: ClinicPrincipal = { userId: 42, publicId: randomUUID(), tokenVersion: 1,
  roles: [{ code: 'DOCTOR', branchId: 1 }] };
class Auth implements PrincipalAuthenticator {
  authenticate(token: string) { return token === 'doctor' ? Promise.resolve(principal) : Promise.reject(new Error('bad token')); }
}

function encounter(): ClinicalEncounterDetail {
  return { publicId: encounterId, code: 'LK-1', source: 'WALK_IN', status: 'WAITING',
    arrivedAtUtc: '2026-09-13T02:00:00.000Z', startedAtUtc: null, completedAtUtc: null, signedAtUtc: null,
    signature: null, chiefComplaint: 'Đau đầu',
    patient: { publicId: randomUUID(), code: 'BN-1', fullName: 'Nguyễn An', dateOfBirth: '1990-01-01', gender: 'OTHER' },
    doctor: { publicId: randomUUID(), fullName: 'Bác sĩ Bình' },
    room: { publicId: randomUUID(), name: 'Phòng 1' }, queue: { displayNumber: 'A0001', status: 'CALLED' },
    historyOfPresentIllness: null, physicalExamination: null, clinicalAssessment: null,
    treatmentPlan: null, followUpInstructions: null, followUpDate: null,
    vitalSigns: [], diagnoses: [], services: [{ publicId: serviceId, catalogPublicId: randomUUID(),
      code: 'CONSULT', name: 'Khám', type: 'CONSULTATION', quantity: '1.000', unitPrice: '200000.00',
      status: 'ORDERED', notes: null, result: null }], amendments: [], availableServices: [],
  };
}

class MemoryClinical implements ClinicalRepository {
  item = encounter();
  denied = false;
  branches() { return Promise.resolve([{ publicId: branchId, code: 'MAIN', name: 'Chi nhánh chính',
    timezoneName: 'SE Asia Standard Time' }]); }
  list(_actor: ClinicPrincipal, _branchId: string, statuses: EncounterStatus[]) {
    if (this.denied) return Promise.reject({ number: 51002 });
    return Promise.resolve(statuses.includes(this.item.status) ? [this.item] : []);
  }
  get() { return Promise.resolve(this.item); }
  start() {
    if (this.item.status !== 'WAITING') return Promise.reject({ number: 53220 });
    this.item.status = 'IN_PROGRESS'; this.item.queue = { displayNumber: 'A0001', status: 'SERVING' };
    return Promise.resolve();
  }
  updateNotes(_actor: ClinicPrincipal, _id: string, input: ClinicalNotesInput) {
    if (this.item.status !== 'IN_PROGRESS') return Promise.reject({ number: 53223 });
    Object.assign(this.item, input); return Promise.resolve();
  }
  addVitalSigns(_actor: ClinicPrincipal, _id: string, input: VitalSignsInput) {
    if (this.item.status === 'SIGNED') return Promise.reject({ number: 53225 });
    const publicId = randomUUID(); this.item.vitalSigns.push({ ...input, publicId,
      measuredAtUtc: '2026-09-13T02:10:00.000Z', bmi: null, measuredBy: 'Bác sĩ Bình' });
    return Promise.resolve({ publicId });
  }
  addDiagnosis(_actor: ClinicPrincipal, _id: string, input: DiagnosisInput) {
    const publicId = randomUUID(); this.item.diagnoses.push({ ...input, publicId,
      createdAtUtc: '2026-09-13T02:20:00.000Z', recordedBy: 'Bác sĩ Bình' });
    return Promise.resolve({ publicId });
  }
  orderService(_actor: ClinicPrincipal, _id: string, _input: OrderServiceInput) {
    return Promise.resolve({ publicId: randomUUID() });
  }
  finalizeResult(_actor: ClinicPrincipal, _id: string, _input: FinalizeResultInput) {
    return Promise.resolve({ publicId: randomUUID() });
  }
  complete() {
    if (!this.item.diagnoses.some((diagnosis) => diagnosis.isPrimary)) return Promise.reject({ number: 53238 });
    this.item.status = 'COMPLETED'; return Promise.resolve();
  }
  sign() {
    if (this.item.status !== 'COMPLETED') return Promise.reject({ number: 53244 });
    this.item.status = 'SIGNED'; this.item.signature = { schemaVersion: 'CLINIC_RECORD_V2',
      sha256: 'A'.repeat(64), signedAtUtc: '2026-09-13T03:00:00.000Z' };
    return Promise.resolve({ publicId: encounterId, sha256: 'A'.repeat(64) });
  }
  amend(_actor: ClinicPrincipal, _id: string, input: AmendmentInput) {
    if (this.item.status !== 'SIGNED') return Promise.reject({ number: 53250 });
    const publicId = randomUUID(); this.item.amendments.push({ ...input, publicId, number: 1,
      hash: 'B'.repeat(64), amendedAtUtc: '2026-09-13T04:00:00.000Z', amendedBy: 'Bác sĩ Bình' });
    return Promise.resolve({ publicId, sha256: 'B'.repeat(64) });
  }
}

const auth = { authorization: 'Bearer doctor' };
function app(repository: MemoryClinical) {
  return createApp({ databaseProbe: async () => ({ database: 'test' }), principalAuthenticator: new Auth(),
    clinicalService: new ClinicalService(repository) });
}

describe('clinical core API', () => {
  let repository: MemoryClinical;
  beforeEach(() => { repository = new MemoryClinical(); });

  it('requires a token and lists only the actor-scoped branch and encounters', async () => {
    const server = app(repository);
    expect((await request(server).get('/api/v1/clinical/branches')).status).toBe(401);
    const branches = await request(server).get('/api/v1/clinical/branches').set(auth);
    const list = await request(server).get('/api/v1/encounters').set(auth).query({ branchPublicId: branchId });
    expect(branches.body.data[0].publicId).toBe(branchId);
    expect(list.body.data[0].publicId).toBe(encounterId);
    expect(list.body.data[0]).not.toHaveProperty('encounterId');
  });

  it('rejects invalid status filters and branch-scoped permission denial', async () => {
    const invalid = await request(app(repository)).get('/api/v1/encounters').set(auth)
      .query({ branchPublicId: branchId, status: 'NOT_REAL' });
    repository.denied = true;
    const denied = await request(app(repository)).get('/api/v1/encounters').set(auth)
      .query({ branchPublicId: branchId });
    expect(invalid.status).toBe(400); expect(denied.status).toBe(403);
  });

  it('starts, records notes and signs only after a primary diagnosis and completion', async () => {
    const server = app(repository); const base = `/api/v1/encounters/${encounterId}`;
    const started = await request(server).post(`${base}/start`).set(auth).send({});
    expect(started.body.data.status).toBe('IN_PROGRESS');
    const notes = await request(server).patch(`${base}/clinical-notes`).set(auth)
      .send({ historyOfPresentIllness: 'Đau đầu hai ngày', treatmentPlan: 'Theo dõi' });
    expect(notes.body.data.historyOfPresentIllness).toBe('Đau đầu hai ngày');
    const blocked = await request(server).post(`${base}/complete`).set(auth);
    expect(blocked.status).toBe(409);
    await request(server).post(`${base}/diagnoses`).set(auth)
      .send({ code: 'R51', name: 'Đau đầu', isPrimary: true });
    const completed = await request(server).post(`${base}/complete`).set(auth);
    const signed = await request(server).post(`${base}/sign`).set(auth);
    expect(completed.body.data.status).toBe('COMPLETED');
    expect(signed.body.data.sha256).toHaveLength(64);
  });

  it('validates vital signs and FINAL result content before writing', async () => {
    const server = app(repository); const base = `/api/v1/encounters/${encounterId}`;
    const invalidVitals = await request(server).post(`${base}/vital-signs`).set(auth)
      .send({ systolicBpMmhg: 80, diastolicBpMmhg: 100 });
    const emptyResult = await request(server).post(`/api/v1/clinical/services/${serviceId}/results/finalize`).set(auth)
      .send({ summary: ' ', result: {} });
    const valid = await request(server).post(`${base}/vital-signs`).set(auth).send({ pulseBpm: 82 });
    expect(invalidVitals.status).toBe(400); expect(emptyResult.status).toBe(400);
    expect(valid.status).toBe(201); expect(repository.item.vitalSigns[0]?.pulseBpm).toBe(82);
  });

  it('rejects updates after signing and allows an append-only amendment', async () => {
    const server = app(repository); const base = `/api/v1/encounters/${encounterId}`;
    repository.item.status = 'SIGNED';
    const changed = await request(server).patch(`${base}/clinical-notes`).set(auth).send({ treatmentPlan: 'overwrite' });
    const amendment = await request(server).post(`${base}/amendments`).set(auth)
      .send({ reason: 'Bổ sung sau ký', content: 'Đã tư vấn thêm.' });
    expect(changed.status).toBe(409); expect(amendment.status).toBe(201);
    expect(repository.item.amendments).toHaveLength(1);
  });
});
