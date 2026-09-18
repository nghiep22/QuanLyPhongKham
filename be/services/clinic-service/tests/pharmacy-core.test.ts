import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { PharmacyService } from '../src/modules/pharmacy/pharmacy.service.js';
import type { PharmacyRepository, PrescriptionDetail } from '../src/modules/pharmacy/pharmacy.types.js';
import type { ClinicPrincipal, PrincipalAuthenticator } from '../src/modules/identity/index.js';

const branchId = randomUUID(); const encounterId = randomUUID(); const prescriptionId = randomUUID();
const itemId = randomUUID(); const locationId = randomUUID(); const batchId = randomUUID();
const principal: ClinicPrincipal = { userId: 42, publicId: randomUUID(), tokenVersion: 1,
  roles: [{ code: 'PHARMACIST', branchId: 1 }] };
class Auth implements PrincipalAuthenticator {
  authenticate(token: string) {
    return token === 'valid' ? Promise.resolve(principal) : Promise.reject(new Error('invalid token'));
  }
}
const authorization = { authorization: 'Bearer valid' };
function detail(): PrescriptionDetail {
  return { publicId: prescriptionId, code: 'DT-1', status: 'DRAFT', encounterPublicId: encounterId,
    patientPublicId: randomUUID(), patientCode: 'BN-1', patientName: 'Nguyễn An', issuedAtUtc: null,
    validUntil: '2026-09-21', itemCount: 0, clinicalNotes: null, generalInstructions: null,
    branch: { publicId: branchId, code: 'MAIN', name: 'Chi nhánh chính', timezoneName: 'SE Asia Standard Time',
      medicalLicenseNo: 'PK-001', phone: '02812345678', email: 'main@example.test', addressLine: '1 Đường A',
      ward: 'Phường 1', district: 'Quận 1', province: 'TP. Hồ Chí Minh' },
    prescriber: { publicId: randomUUID(), fullName: 'Bác sĩ An', medicalLicenseNo: 'BS-001',
      academicTitle: null },
    patient: { dateOfBirth: '1990-01-01', gender: 'MALE', phone: null, addressLine: null,
      healthInsuranceNo: null },
    items: [], dispensations: [], dispensedItems: [], drugAllergies: [], allergyAlerts: [] };
}
function fixture() {
  const rx = detail();
  const repository = {
    branches: vi.fn().mockResolvedValue([{ publicId: branchId, code: 'MAIN', name: 'Chi nhánh chính',
      timezoneName: 'SE Asia Standard Time' }]),
    workspace: vi.fn().mockResolvedValue({ locations: [], medicines: [], batches: [], prescriptions: [], lowStock: [] }),
    get: vi.fn().mockImplementation(async () => rx),
    createPrescription: vi.fn().mockResolvedValue(prescriptionId),
    addItem: vi.fn().mockImplementation(async () => { rx.itemCount += 1; return itemId; }),
    issue: vi.fn().mockImplementation(async () => { rx.status = 'ISSUED'; }),
    openDispensation: vi.fn().mockResolvedValue(randomUUID()),
    receive: vi.fn().mockResolvedValue(randomUUID()),
    dispense: vi.fn().mockResolvedValue(randomUUID()),
    reverse: vi.fn().mockResolvedValue(randomUUID()),
    reconcile: vi.fn().mockResolvedValue([]),
  } as unknown as PharmacyRepository;
  const app = createApp({ databaseProbe: async () => ({ database: 'test' }),
    principalAuthenticator: new Auth(), pharmacyService: new PharmacyService(repository) });
  return { app, repository };
}

describe('pharmacy API', () => {
  it('requires authentication and returns public identifiers only', async () => {
    const { app } = fixture();
    expect((await request(app).get('/api/v1/pharmacy/branches')).status).toBe(401);
    const result = await request(app).get('/api/v1/pharmacy/branches').set(authorization);
    expect(result.status).toBe(200);
    expect(result.body.data[0].publicId).toBe(branchId);
    expect(result.body.data[0]).not.toHaveProperty('branchId');
  });
  it('creates, adds an item and issues a draft with validated UUIDs', async () => {
    const { app } = fixture();
    const created = await request(app).post(`/api/v1/encounters/${encounterId}/prescriptions`)
      .set(authorization).send({ validDays: 7 });
    const invalid = await request(app).post('/api/v1/prescriptions/not-a-uuid/items')
      .set(authorization).send({});
    const item = await request(app).post(`/api/v1/prescriptions/${prescriptionId}/items`).set(authorization)
      .send({ medicinePublicId: randomUUID(), prescribedQuantity: 5, dose: '1 viên',
        frequency: 'Ngày hai lần', usageInstruction: 'Uống sau ăn' });
    const issued = await request(app).post(`/api/v1/prescriptions/${prescriptionId}/issue`).set(authorization);
    expect(created.status).toBe(201);
    expect(invalid.status).toBe(400);
    expect(item.body.data.itemCount).toBe(1);
    expect(issued.body.data.status).toBe('ISSUED');
  });
  it('requires and forwards an idempotency key for stock-affecting commands', async () => {
    const { app, repository } = fixture(); const key = randomUUID();
    const body = { locationPublicId: locationId, batchPublicId: batchId, quantity: 2 };
    const missing = await request(app).post('/api/v1/pharmacy/receipts').set(authorization).send(body);
    const received = await request(app).post('/api/v1/pharmacy/receipts')
      .set(authorization).set('Idempotency-Key', key).send(body);
    const dispensed = await request(app).post(`/api/v1/dispensations/${randomUUID()}/items`)
      .set(authorization).set('Idempotency-Key', key)
      .send({ prescriptionItemPublicId: itemId, batchPublicId: batchId, quantity: 1 });
    expect(missing.status).toBe(400);
    expect(received.status).toBe(201);
    expect(dispensed.status).toBe(201);
    expect(vi.mocked(repository.receive).mock.calls[0]?.[5]).toBe(key);
    expect(vi.mocked(repository.dispense).mock.calls[0]?.[6]).toBe(key);
  });
  it('maps FEFO/stock conflict to a safe 409 response', async () => {
    const { app, repository } = fixture();
    vi.mocked(repository.dispense).mockRejectedValueOnce({ number: 53333, message: 'internal batch details' });
    const result = await request(app).post(`/api/v1/dispensations/${randomUUID()}/items`)
      .set(authorization).set('Idempotency-Key', randomUUID())
      .send({ prescriptionItemPublicId: itemId, batchPublicId: batchId, quantity: 1 });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('PHARMACY_CONFLICT');
    expect(JSON.stringify(result.body)).not.toContain('internal batch details');
  });
  it('maps post-invoice dispensing to a safe conflict', async () => {
    const { app, repository } = fixture();
    vi.mocked(repository.openDispensation).mockRejectedValueOnce({ number: 53354, message: 'invoice details' });
    const result = await request(app).post(`/api/v1/prescriptions/${prescriptionId}/dispensations`)
      .set(authorization).send({ locationPublicId: locationId });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('PHARMACY_CONFLICT');
    expect(JSON.stringify(result.body)).not.toContain('invoice details');
  });
  it('returns a specific safe conflict when dispensing needs an allergy acknowledgement', async () => {
    const { app, repository } = fixture();
    vi.mocked(repository.dispense).mockRejectedValueOnce({ number: 53923, message: 'amoxicillin' });
    const result = await request(app).post(`/api/v1/dispensations/${randomUUID()}/items`)
      .set(authorization).set('Idempotency-Key', randomUUID())
      .send({ prescriptionItemPublicId: itemId, batchPublicId: batchId, quantity: 1 });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('PHARMACY_ALLERGY_CONFLICT');
    expect(result.body.error.message).toContain('Dược sĩ');
    expect(JSON.stringify(result.body)).not.toContain('amoxicillin');
  });
  it('returns a specific safe conflict when prescribing needs an allergy override', async () => {
    const { app, repository } = fixture();
    vi.mocked(repository.addItem).mockRejectedValueOnce({ number: 53910, message: 'amoxicillin' });
    const result = await request(app).post(`/api/v1/prescriptions/${prescriptionId}/items`).set(authorization)
      .send({ medicinePublicId: randomUUID(), prescribedQuantity: 1, dose: '1 viên',
        frequency: 'Ngày một lần', usageInstruction: 'Uống sau ăn' });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('PHARMACY_ALLERGY_CONFLICT');
    expect(result.body.error.message).toContain('Bác sĩ');
    expect(JSON.stringify(result.body)).not.toContain('amoxicillin');
  });
  it('requires a quality inspection acknowledgement before returning medicine to sellable stock', async () => {
    const { app, repository } = fixture();
    const endpoint = `/api/v1/pharmacy/dispensation-items/${randomUUID()}/reverse`;
    const rejected = await request(app).post(endpoint).set(authorization)
      .send({ returnLocationPublicId: locationId, disposition: 'SELLABLE', reason: 'Bao bì còn nguyên vẹn' });
    const accepted = await request(app).post(endpoint).set(authorization)
      .send({ returnLocationPublicId: locationId, disposition: 'SELLABLE', reason: 'Bao bì còn nguyên vẹn',
        sellableInspectionConfirmed: true });
    const quarantined = await request(app).post(endpoint).set(authorization)
      .send({ returnLocationPublicId: locationId, disposition: 'QUARANTINE', reason: 'Cần kiểm tra thêm' });
    expect(rejected.status).toBe(400);
    expect(accepted.status).toBe(200);
    expect(quarantined.status).toBe(200);
    expect(vi.mocked(repository.reverse).mock.calls[0]?.[5]).toBe(true);
    expect(vi.mocked(repository.reverse).mock.calls[1]?.[5]).toBe(false);
  });
});
