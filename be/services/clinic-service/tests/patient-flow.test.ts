import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { ClinicPrincipal, PrincipalAuthenticator } from '../src/modules/identity/index.js';
import { PatientService } from '../src/modules/patients/patient.service.js';
import type { Branch, ClinicalSummary, CreatePatientInput, PatientDetail, PatientInput, PatientRepository } from '../src/modules/patients/patient.types.js';

const main: Branch = { id: 1, publicId: randomUUID(), name: 'Chi nhánh chính' };
const other: Branch = { id: 2, publicId: randomUUID(), name: 'Chi nhánh khác' };
const principals: Record<string, ClinicPrincipal> = {
  receptionist: { userId: 10, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'RECEPTIONIST', branchId: 1 }] },
  doctor: { userId: 20, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'DOCTOR', branchId: 1 }] },
};
class FakeAuthenticator implements PrincipalAuthenticator {
  authenticate(token: string) {
    const principal = principals[token];
    return principal ? Promise.resolve(principal) : Promise.reject(new Error('Invalid token'));
  }
}
class MemoryPatients implements PatientRepository {
  patient: PatientDetail = {
    publicId: randomUUID(), code: 'BN-01', fullName: 'Nguyễn Minh Anh', dateOfBirth: '1990-05-14',
    gender: 'FEMALE', phone: '0901234567', status: 'ACTIVE', nationalIdLast4: '1234',
    rowVersion: 'AAAAAAAAAAE=', branch: { publicId: main.publicId, name: main.name },
    nationalId: '0012341234', healthInsuranceNo: null, email: null, addressLine: null, province: null,
  };
  branches(actorUserId: number) { return Promise.resolve(actorUserId === 10 ? [main] : []); }
  resolveBranch(publicId: string) { return Promise.resolve([main, other].find((item) => item.publicId === publicId) ?? null); }
  private assert(actorUserId: number, branchId: number) {
    if (actorUserId !== 10 || branchId !== 1) throw { number: 51002 };
  }
  search(actorUserId: number, branchId: number) {
    this.assert(actorUserId, branchId);
    return Promise.resolve([this.patient]);
  }
  duplicates(actorUserId: number, branchId: number, _requestId: string, input: PatientInput) {
    this.assert(actorUserId, branchId);
    return Promise.resolve(input.phone === this.patient.phone ? [this.patient] : []);
  }
  get(actorUserId: number, branchId: number, publicId: string) {
    this.assert(actorUserId, branchId);
    return Promise.resolve(publicId === this.patient.publicId ? this.patient : null);
  }
  create(actor: ClinicPrincipal, branchId: number, input: CreatePatientInput) {
    this.assert(actor.userId, branchId);
    if (input.phone === this.patient.phone && !input.duplicateOverride) return Promise.reject({ number: 53630 });
    this.patient = { ...this.patient, publicId: randomUUID(), fullName: input.fullName,
      dateOfBirth: input.dateOfBirth, gender: input.gender, phone: input.phone ?? null };
    return Promise.resolve(this.patient.publicId);
  }
  update(actor: ClinicPrincipal, branchId: number, _publicId: string, input: PatientInput, expectedVersion: string) {
    this.assert(actor.userId, branchId);
    if (expectedVersion !== this.patient.rowVersion) return Promise.reject({ number: 53636 });
    this.patient = { ...this.patient, fullName: input.fullName, rowVersion: 'AAAAAAAAAAI=' };
    return Promise.resolve();
  }
  clinicalSummary(actor: ClinicPrincipal, branchId: number) {
    if (actor.userId !== 20 || branchId !== 1) return Promise.reject({ number: 51002 });
    return Promise.reject({ number: 53650 }) as Promise<ClinicalSummary>;
  }
}
const body = { fullName: 'Nguyễn Minh Anh', dateOfBirth: '1990-05-14', gender: 'FEMALE' as const,
  phone: '0901234567' };
function app(repository: MemoryPatients) {
  return createApp({ databaseProbe: async () => ({ database: 'test' }),
    principalAuthenticator: new FakeAuthenticator(), patientService: new PatientService(repository) });
}
function auth(token: string) { return { authorization: `Bearer ${token}` }; }

describe('patient registry API', () => {
  it('requires a token and restricts branch reads at the database contract', async () => {
    const repository = new MemoryPatients();
    const noToken = await request(app(repository)).post('/api/v1/admin/patients/search')
      .send({ branchPublicId: main.publicId });
    const forbidden = await request(app(repository)).post('/api/v1/admin/patients/search')
      .set(auth('receptionist')).send({ branchPublicId: other.publicId });
    expect(noToken.status).toBe(401);
    expect(forbidden.status).toBe(403);
  });

  it('searches and warns before creating a likely duplicate', async () => {
    const repository = new MemoryPatients();
    const search = await request(app(repository)).post('/api/v1/admin/patients/search')
      .set(auth('receptionist')).send({ branchPublicId: main.publicId, query: '0901234567' });
    const duplicates = await request(app(repository)).post('/api/v1/admin/patients/duplicates')
      .set(auth('receptionist')).send({ ...body, branchPublicId: main.publicId });
    const conflict = await request(app(repository)).post('/api/v1/admin/patients')
      .set(auth('receptionist')).send({ ...body, branchPublicId: main.publicId });
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(1);
    expect(duplicates.status, JSON.stringify(duplicates.body)).toBe(200);
    expect(duplicates.body.data[0].code).toBe('BN-01');
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('POSSIBLE_DUPLICATE');
  });

  it('requires If-Match and reports a stale version', async () => {
    const repository = new MemoryPatients();
    const url = `/api/v1/admin/patients/${repository.patient.publicId}?branchPublicId=${main.publicId}`;
    const missing = await request(app(repository)).put(url).set(auth('receptionist')).send(body);
    const stale = await request(app(repository)).put(url).set(auth('receptionist'))
      .set('if-match', '"AAAAAAAAAAI="').send(body);
    const saved = await request(app(repository)).put(url).set(auth('receptionist'))
      .set('if-match', '"AAAAAAAAAAE="').send({ ...body, fullName: 'Nguyễn An' });
    expect(missing.status).toBe(428);
    expect(stale.status).toBe(409);
    expect(saved.status).toBe(200);
    expect(saved.headers.etag).toBe('"AAAAAAAAAAI="');
  });

  it('accepts public GUIDs produced by SQL Server NEWSEQUENTIALID', async () => {
    const repository = new MemoryPatients();
    repository.patient.publicId = '45066C98-1CAD-F111-9781-387A0E5C4A9E';
    const response = await request(app(repository))
      .get(`/api/v1/admin/patients/${repository.patient.publicId}?branchPublicId=${main.publicId}`)
      .set(auth('receptionist'));
    expect(response.status).toBe(200);
    expect(response.body.data.publicId).toBe(repository.patient.publicId);
  });

  it('blocks clinical reads without care relationship and from reception', async () => {
    const repository = new MemoryPatients();
    const url = `/api/v1/patients/${repository.patient.publicId}/clinical-summary?branchPublicId=${main.publicId}`;
    const doctor = await request(app(repository)).get(url).set(auth('doctor'));
    const reception = await request(app(repository)).get(url).set(auth('receptionist'));
    expect(doctor.status).toBe(403);
    expect(reception.status).toBe(403);
  });
});
