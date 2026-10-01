import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { ClinicPrincipal, PrincipalAuthenticator } from '../src/modules/identity/index.js';
import { PatientService } from '../src/modules/patients/patient.service.js';
import type { Branch, ClinicalSummary, CreatePatientInput, EmergencyContact, MyEmergencyContacts, PatientAllergyInput, PatientConditionInput, PatientDetail, PatientInput, PatientMergeHistoryItem, PatientMergePreview, PatientMergeResult, PatientRepository } from '../src/modules/patients/patient.types.js';

const main: Branch = { id: 1, publicId: randomUUID(), name: 'Chi nhánh chính' };
const other: Branch = { id: 2, publicId: randomUUID(), name: 'Chi nhánh khác' };
const principals: Record<string, ClinicPrincipal> = {
  admin: { userId: 1, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'ADMIN', branchId: null }] },
  receptionist: { userId: 10, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'RECEPTIONIST', branchId: 1 }] },
  doctor: { userId: 20, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'DOCTOR', branchId: 1 }] },
  patient: { userId: 30, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'PATIENT', branchId: null }] },
  guardian: { userId: 31, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'PATIENT', branchId: null }] },
};
class FakeAuthenticator implements PrincipalAuthenticator {
  authenticate(token: string) {
    const principal = principals[token];
    return principal ? Promise.resolve(principal) : Promise.reject(new Error('Invalid token'));
  }
}
class MemoryPatients implements PatientRepository {
  hasCare = false;
  selfLinkActive = true;
  merged = false;
  target = { publicId: randomUUID(), code: 'BN-02', fullName: 'Nguyễn Minh Anh chuẩn',
    rowVersion: 'AAAAAAAAAAM=' };
  allergies: ClinicalSummary['allergies'] = [];
  conditions: ClinicalSummary['conditions'] = [];
  patient: PatientDetail = {
    publicId: randomUUID(), code: 'BN-01', fullName: 'Nguyễn Minh Anh', dateOfBirth: '1990-05-14',
    gender: 'FEMALE', phone: '0901234567', status: 'ACTIVE', nationalIdLast4: '1234',
    rowVersion: 'AAAAAAAAAAE=', branch: { publicId: main.publicId, name: main.name },
    nationalId: '0012341234', healthInsuranceNo: null, email: null, addressLine: null, province: null,
    emergencyContacts: [],
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
  replaceEmergencyContacts(actor: ClinicPrincipal, branchId: number, _publicId: string,
    contacts: EmergencyContact[], expectedVersion: string) {
    this.assert(actor.userId, branchId);
    if (expectedVersion !== this.patient.rowVersion) return Promise.reject({ number: 53636 });
    this.patient = { ...this.patient, emergencyContacts: contacts, rowVersion: 'AAAAAAAAAAI=' };
    return Promise.resolve();
  }
  myEmergencyContacts(actor: ClinicPrincipal, publicId: string): Promise<MyEmergencyContacts> {
    if (actor.userId !== 30 || !this.selfLinkActive) return Promise.reject({ number: 51002 });
    if (publicId !== this.patient.publicId) return Promise.reject({ number: 53635 });
    return Promise.resolve({ patientPublicId: publicId, rowVersion: this.patient.rowVersion,
      contacts: this.patient.emergencyContacts });
  }
  replaceMyEmergencyContacts(actor: ClinicPrincipal, publicId: string, contacts: EmergencyContact[],
    expectedVersion: string) {
    if (actor.userId !== 30 || !this.selfLinkActive) return Promise.reject({ number: 51002 });
    if (publicId !== this.patient.publicId) return Promise.reject({ number: 53635 });
    if (expectedVersion !== this.patient.rowVersion) return Promise.reject({ number: 53636 });
    this.patient = { ...this.patient, emergencyContacts: contacts, rowVersion: 'AAAAAAAAAAI=' };
    return Promise.resolve();
  }
  previewMerge(actor: ClinicPrincipal, sourcePublicId: string, targetPublicId: string): Promise<PatientMergePreview> {
    if (actor.userId !== 1) return Promise.reject({ number: 51002 });
    if (sourcePublicId !== this.patient.publicId || targetPublicId !== this.target.publicId || this.merged)
      return Promise.reject({ number: 53635 });
    return Promise.resolve({ sourcePublicId, sourceCode: this.patient.code, sourceName: this.patient.fullName,
      sourceDateOfBirth: this.patient.dateOfBirth, sourceGender: this.patient.gender, sourceBranchPublicId: main.publicId,
      sourceBranchName: main.name, sourceNationalIdLast4: this.patient.nationalIdLast4,
      sourceRowVersion: this.patient.rowVersion, targetPublicId, targetCode: this.target.code,
      targetName: this.target.fullName, targetDateOfBirth: this.patient.dateOfBirth,
      targetGender: this.patient.gender,
      targetBranchPublicId: main.publicId, targetBranchName: main.name, targetNationalIdLast4: null,
      targetRowVersion: this.target.rowVersion, sourceAppointments: 0, sourceSignedEncounters: 1,
      sourceInvoices: 1, sourceActiveLinks: 1, sourceActiveAllergies: 0, sourceOpenConditions: 0,
      sourceActiveContacts: 0, identityCompatible: true, hasOpenWork: false,
      hasInboundMerge: false, hasLinkConflict: false, hasContactConflict: false });
  }
  merge(actor: ClinicPrincipal, sourcePublicId: string, targetPublicId: string,
    sourceVersion: string, targetVersion: string, reason: string): Promise<PatientMergeResult> {
    if (actor.userId !== 1) return Promise.reject({ number: 51002 });
    if (sourceVersion !== this.patient.rowVersion || targetVersion !== this.target.rowVersion)
      return Promise.reject({ number: 53636 });
    if (sourcePublicId !== this.patient.publicId || targetPublicId !== this.target.publicId)
      return Promise.reject({ number: 53635 });
    if (reason.length < 20) return Promise.reject({ number: 53661 });
    this.merged = true;
    return Promise.resolve({ sourcePublicId, sourceCode: this.patient.code,
      targetPublicId, targetCode: this.target.code, mergedAtUtc: new Date().toISOString() });
  }
  mergeHistory(actor: ClinicPrincipal, targetPublicId: string): Promise<PatientMergeHistoryItem[]> {
    if (actor.userId !== 1) return Promise.reject({ number: 51002 });
    if (targetPublicId !== this.target.publicId) return Promise.reject({ number: 53635 });
    return Promise.resolve(this.merged ? [{ sourcePublicId: this.patient.publicId,
      sourceCode: this.patient.code, sourceName: this.patient.fullName,
      targetPublicId, targetCode: this.target.code, mergedAtUtc: new Date().toISOString(),
      reason: 'Đã đối chiếu giấy tờ và xác nhận hai hồ sơ cùng một người.',
      performedByPublicId: principals.admin!.publicId, performedByName: 'Admin' }] : []);
  }
  clinicalSummary(actor: ClinicPrincipal, branchId: number) {
    if (actor.userId !== 20 || branchId !== 1) return Promise.reject({ number: 51002 });
    if (!this.hasCare) return Promise.reject({ number: 53650 }) as Promise<ClinicalSummary>;
    return Promise.resolve({ patient: this.patient, allergies: this.allergies,
      conditions: this.conditions } as ClinicalSummary);
  }
  addAllergy(actor: ClinicPrincipal, branchId: number, _publicId: string, input: PatientAllergyInput) {
    if (actor.userId !== 20 || branchId !== 1 || !this.hasCare) return Promise.reject({ number: 53650 });
    if (this.allergies.some((item) => item.allergenName === input.allergenName)) return Promise.reject({ number: 53639 });
    const publicId = randomUUID();
    this.allergies.push({ publicId, allergenName: input.allergenName, type: input.type,
      severity: input.severity, reaction: input.reaction ?? null, notedAt: input.notedAt ?? null });
    return Promise.resolve(publicId);
  }
  deactivateAllergy(actor: ClinicPrincipal, branchId: number, _publicId: string, allergyId: string) {
    if (actor.userId !== 20 || branchId !== 1 || !this.hasCare) return Promise.reject({ number: 53650 });
    this.allergies = this.allergies.filter((item) => item.publicId !== allergyId);
    return Promise.resolve();
  }
  addCondition(actor: ClinicPrincipal, branchId: number, _publicId: string, input: PatientConditionInput) {
    if (actor.userId !== 20 || branchId !== 1 || !this.hasCare) return Promise.reject({ number: 53650 });
    const publicId = randomUUID();
    this.conditions.push({ publicId, code: input.code ?? null, name: input.name,
      diagnosedDate: input.diagnosedDate ?? null, status: input.status, notes: input.notes ?? null });
    return Promise.resolve(publicId);
  }
  resolveCondition(actor: ClinicPrincipal, branchId: number, _publicId: string, conditionId: string) {
    if (actor.userId !== 20 || branchId !== 1 || !this.hasCare) return Promise.reject({ number: 53650 });
    this.conditions = this.conditions.filter((item) => item.publicId !== conditionId);
    return Promise.resolve();
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

  it('replaces emergency contacts with validation, branch scope and If-Match', async () => {
    const repository = new MemoryPatients();
    const url = `/api/v1/admin/patients/${repository.patient.publicId}/emergency-contacts?branchPublicId=${main.publicId}`;
    const contacts = [{ fullName: 'Nguyễn Văn B', relationshipName: 'Cha', phone: '0901234567', isPrimary: true }];
    const missing = await request(app(repository)).put(url).set(auth('receptionist')).send({ contacts });
    const invalid = await request(app(repository)).put(url).set(auth('receptionist'))
      .set('if-match', '"AAAAAAAAAAE="').send({ contacts: [{ ...contacts[0], isPrimary: false }] });
    const forbidden = await request(app(repository)).put(url.replace(main.publicId, other.publicId))
      .set(auth('receptionist')).set('if-match', '"AAAAAAAAAAE="').send({ contacts });
    const saved = await request(app(repository)).put(url).set(auth('receptionist'))
      .set('if-match', '"AAAAAAAAAAE="').send({ contacts });
    const stale = await request(app(repository)).put(url).set(auth('receptionist'))
      .set('if-match', '"AAAAAAAAAAE="').send({ contacts: [] });
    expect(missing.status).toBe(428);
    expect(invalid.status).toBe(400);
    expect(forbidden.status).toBe(403);
    expect(saved.status).toBe(200);
    expect(saved.body.data.emergencyContacts).toEqual(contacts);
    expect(stale.status).toBe(409);
  });

  it('lets only the active self-linked patient edit contacts with If-Match', async () => {
    const repository = new MemoryPatients();
    const url = `/api/v1/patients/${repository.patient.publicId}/my-emergency-contacts`;
    const contacts = [{ fullName: 'Nguyễn Văn B', relationshipName: 'Cha', phone: '0901234567', isPrimary: true }];
    const guardian = await request(app(repository)).get(url).set(auth('guardian'));
    const staff = await request(app(repository)).get(url).set(auth('receptionist'));
    const read = await request(app(repository)).get(url).set(auth('patient'));
    const missing = await request(app(repository)).put(url).set(auth('patient')).send({ contacts });
    const saved = await request(app(repository)).put(url).set(auth('patient'))
      .set('if-match', '"AAAAAAAAAAE="').send({ contacts });
    const stale = await request(app(repository)).put(url).set(auth('patient'))
      .set('if-match', '"AAAAAAAAAAE="').send({ contacts: [] });
    repository.selfLinkActive = false;
    const revoked = await request(app(repository)).get(url).set(auth('patient'));
    expect(guardian.status).toBe(403);
    expect(staff.status).toBe(403);
    expect(read.status).toBe(200);
    expect(read.body.data.contacts).toEqual([]);
    expect(missing.status).toBe(428);
    expect(saved.status).toBe(200);
    expect(saved.body.data.contacts).toEqual(contacts);
    expect(stale.status).toBe(409);
    expect(revoked.status).toBe(403);
  });

  it('previews and merges only as administrator with both fresh versions', async () => {
    const repository = new MemoryPatients();
    const previewUrl = `/api/v1/admin/patients/${repository.patient.publicId}/merge-preview`;
    const mergeUrl = `/api/v1/admin/patients/${repository.patient.publicId}/merge`;
    const previewDenied = await request(app(repository)).post(previewUrl).set(auth('receptionist'))
      .send({ targetPatientId: repository.target.publicId });
    const preview = await request(app(repository)).post(previewUrl).set(auth('admin'))
      .send({ targetPatientId: repository.target.publicId });
    const body = { targetPatientId: repository.target.publicId,
      targetRowVersion: repository.target.rowVersion,
      reason: 'Đã đối chiếu giấy tờ và xác nhận hai hồ sơ cùng một người.' };
    const missing = await request(app(repository)).post(mergeUrl).set(auth('admin')).send(body);
    const stale = await request(app(repository)).post(mergeUrl).set(auth('admin'))
      .set('if-match', '"AAAAAAAAAAI="').send(body);
    const denied = await request(app(repository)).post(mergeUrl).set(auth('receptionist'))
      .set('if-match', '"AAAAAAAAAAE="').send(body);
    const merged = await request(app(repository)).post(mergeUrl).set(auth('admin'))
      .set('if-match', '"AAAAAAAAAAE="').send(body);
    const history = await request(app(repository)).get(
      `/api/v1/admin/patients/${repository.target.publicId}/merge-history`).set(auth('admin'));
    expect(previewDenied.status).toBe(403);
    expect(preview.status).toBe(200);
    expect(preview.body.data.sourceSignedEncounters).toBe(1);
    expect(missing.status).toBe(428);
    expect(stale.status).toBe(409);
    expect(denied.status).toBe(403);
    expect(merged.status).toBe(200);
    expect(merged.body.data.targetPublicId).toBe(repository.target.publicId);
    expect(repository.merged).toBe(true);
    expect(history.status).toBe(200);
    expect(history.body.data[0].sourcePublicId).toBe(repository.patient.publicId);
  });

  it('records and closes clinical safety data only during assigned care', async () => {
    const repository = new MemoryPatients();
    const prefix = `/api/v1/patients/${repository.patient.publicId}`;
    const query = `?branchPublicId=${main.publicId}`;
    const allergy = { allergenName: 'Penicillin', type: 'DRUG', severity: 'SEVERE' };
    const denied = await request(app(repository)).post(`${prefix}/allergies${query}`)
      .set(auth('doctor')).send(allergy);
    repository.hasCare = true;
    const invalid = await request(app(repository)).post(`${prefix}/allergies${query}`)
      .set(auth('doctor')).send({ ...allergy, allergenName: '' });
    const added = await request(app(repository)).post(`${prefix}/allergies${query}`)
      .set(auth('doctor')).send(allergy);
    const duplicate = await request(app(repository)).post(`${prefix}/allergies${query}`)
      .set(auth('doctor')).send(allergy);
    const condition = await request(app(repository)).post(`${prefix}/conditions${query}`)
      .set(auth('doctor')).send({ name: 'Tăng huyết áp', status: 'ACTIVE' });
    const summary = await request(app(repository)).get(`${prefix}/clinical-summary${query}`)
      .set(auth('doctor'));
    const closed = await request(app(repository)).post(`${prefix}/allergies/${added.body.data.publicId}/deactivate${query}`)
      .set(auth('doctor')).send({ reason: 'Đã đối chiếu hồ sơ và loại trừ dị ứng' });
    const resolved = await request(app(repository)).post(`${prefix}/conditions/${condition.body.data.publicId}/resolve${query}`)
      .set(auth('doctor')).send({ reason: 'Đã tái khám và xác nhận khỏi bệnh' });
    expect(denied.status).toBe(403);
    expect(invalid.status).toBe(400);
    expect(added.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(condition.status).toBe(201);
    expect(summary.body.data.allergies).toHaveLength(1);
    expect(summary.body.data.conditions).toHaveLength(1);
    expect(closed.status).toBe(200);
    expect(resolved.status).toBe(200);
  });
});
