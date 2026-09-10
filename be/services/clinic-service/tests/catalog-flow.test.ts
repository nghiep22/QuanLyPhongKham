import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { ClinicPrincipal, PrincipalAuthenticator } from '../src/modules/identity/index.js';
import { CatalogService } from '../src/modules/organization-catalog/catalog.service.js';
import type {
  BranchReference, CatalogRepository, CatalogService as CatalogServiceView,
  CategoryReference, CreateRoomInput, CreateServiceInput, PublicBranch, PublicDoctor,
  PublicService, PublicSpecialty, Room, SetBranchPriceInput, SpecialtyReference,
  UpdateRoomInput, UpdateServiceInput,
} from '../src/modules/organization-catalog/catalog.types.js';

const branchA: BranchReference = { id: 10, publicId: randomUUID(), code: 'MAIN', name: 'Chi nhánh chính' };
const branchB: BranchReference = { id: 20, publicId: randomUUID(), code: 'WEST', name: 'Chi nhánh Tây' };
const category: CategoryReference = { id: 30, publicId: randomUUID(), code: 'CONSULTATION', name: 'Khám bệnh' };
const specialty: SpecialtyReference = { id: 40, publicId: randomUUID(), code: 'GENERAL', name: 'Đa khoa' };

const principals: Record<string, ClinicPrincipal> = {
  admin: { userId: 1, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'ADMIN', branchId: null }] },
  manager: { userId: 2, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'MANAGER', branchId: branchA.id }] },
  receptionist: { userId: 3, publicId: randomUUID(), tokenVersion: 1, roles: [{ code: 'RECEPTIONIST', branchId: branchA.id }] },
};

class FakeAuthenticator implements PrincipalAuthenticator {
  authenticate(token: string) {
    const principal = principals[token];
    if (!principal) return Promise.reject(new Error('invalid'));
    return Promise.resolve(principal);
  }
}

class MemoryCatalogRepository implements CatalogRepository {
  room: Room = {
    id: 50, publicId: randomUUID(), branchId: branchA.id,
    branch: { publicId: branchA.publicId, code: branchA.code, name: branchA.name },
    code: 'CONSULT-01', name: 'Phòng khám 01', type: 'CONSULTATION', floorNo: 1,
    capacity: 1, isActive: true, rowVersion: 'AAAAAAAAAAE=',
  };
  service: CatalogServiceView = {
    id: 60, publicId: randomUUID(), code: 'CONSULT_GENERAL', name: 'Khám đa khoa',
    type: 'CONSULTATION', category, specialty, durationMinutes: 30, basePrice: '200000.00',
    requiresDoctor: true, isActive: true, branchPrices: [], rowVersion: 'AAAAAAAAAAE=',
  };
  duplicatePrice = false;

  listPublicBranches(): Promise<PublicBranch[]> {
    return Promise.resolve([{ ...branchA, phone: null, email: null, addressLine: 'Quận 1', ward: null,
      district: null, province: 'TP.HCM', timezoneName: 'SE Asia Standard Time', bookingHorizonDays: 60,
      onlineHoldMinutes: 15, cancellationDeadlineMinutes: 120 }].map(({ id: _id, ...item }) => item));
  }
  listPublicSpecialties(): Promise<PublicSpecialty[]> {
    return Promise.resolve([{ publicId: specialty.publicId, code: specialty.code, name: specialty.name, description: null }]);
  }
  listPublicServices(_branchId: string, specialtyId?: string): Promise<PublicService[]> {
    if (specialtyId && specialtyId !== specialty.publicId) return Promise.resolve([]);
    return Promise.resolve([{
      publicId: this.service.publicId, code: this.service.code, name: this.service.name,
      type: this.service.type, category: { publicId: category.publicId, code: category.code, name: category.name },
      specialty: { publicId: specialty.publicId, code: specialty.code, name: specialty.name },
      durationMinutes: 30, requiresDoctor: true,
      price: { amount: '200000.00', currency: 'VND', effectiveFrom: '2026-01-01' },
    }]);
  }
  listPublicDoctors(): Promise<PublicDoctor[]> {
    return Promise.resolve([{ publicId: randomUUID(), fullName: 'Bác sĩ An', academicTitle: 'BS',
      biography: null, defaultSlotMinutes: 30,
      branches: [{ publicId: branchA.publicId, name: branchA.name }],
      specialties: [{ publicId: specialty.publicId, name: specialty.name }],
      servicePublicIds: [this.service.publicId] }]);
  }
  hasPermission(actorUserId: number, branchId: number | null) {
    return Promise.resolve(actorUserId === 1 || (actorUserId === 2 && branchId === branchA.id));
  }
  listManageableBranches(actorUserId: number) {
    return Promise.resolve(actorUserId === 1 ? [branchA, branchB] : actorUserId === 2 ? [branchA] : []);
  }
  listCategories() { return Promise.resolve([category]); }
  listSpecialties() { return Promise.resolve([specialty]); }
  resolveBranch(publicId: string) { return Promise.resolve([branchA, branchB].find((item) => item.publicId === publicId) ?? null); }
  resolveCategory(publicId: string) { return Promise.resolve(publicId === category.publicId ? category : null); }
  resolveSpecialty(publicId: string) { return Promise.resolve(publicId === specialty.publicId ? specialty : null); }
  listRooms(branchId: number) { return Promise.resolve(branchId === this.room.branchId ? [this.room] : []); }
  getRoom(publicId: string) { return Promise.resolve(publicId === this.room.publicId ? this.room : null); }
  createRoom(_actor: ClinicPrincipal, branchId: number, input: CreateRoomInput) {
    this.room = { ...this.room, publicId: randomUUID(), branchId, code: input.code, name: input.name,
      type: input.type, floorNo: input.floorNo ?? null, capacity: input.capacity };
    return Promise.resolve(this.room.publicId);
  }
  updateRoom(_actor: ClinicPrincipal, _room: Room, input: UpdateRoomInput, expectedVersion: string) {
    if (expectedVersion !== this.room.rowVersion) return Promise.reject({ number: 53601 });
    this.room = { ...this.room, ...input, floorNo: input.floorNo ?? null, rowVersion: 'AAAAAAAAAAI=' };
    return Promise.resolve();
  }
  listServices() { return Promise.resolve([this.service]); }
  getService(publicId: string) { return Promise.resolve(publicId === this.service.publicId ? this.service : null); }
  createService(_actor: ClinicPrincipal, _categoryId: number, _specialtyId: number | null, input: CreateServiceInput) {
    this.service = { ...this.service, publicId: randomUUID(), code: input.code, name: input.name,
      type: input.type, durationMinutes: input.durationMinutes, basePrice: input.basePrice,
      requiresDoctor: input.requiresDoctor };
    return Promise.resolve(this.service.publicId);
  }
  updateService(_actor: ClinicPrincipal, _serviceId: number, _categoryId: number, _specialtyId: number | null,
    input: UpdateServiceInput, expectedVersion: string) {
    if (expectedVersion !== this.service.rowVersion) return Promise.reject({ number: 53605 });
    this.service = { ...this.service, ...input, rowVersion: 'AAAAAAAAAAI=' };
    return Promise.resolve();
  }
  setBranchPrice(_actor: ClinicPrincipal, _branchId: number, _serviceId: number, input: SetBranchPriceInput) {
    if (this.duplicatePrice) return Promise.reject({ number: 53611 });
    this.service.branchPrices.unshift({ publicId: randomUUID(), amount: input.amount, currency: 'VND',
      effectiveFrom: input.effectiveFrom, effectiveTo: null, isAvailable: input.isAvailable });
    return Promise.resolve();
  }
}

function app(repository: MemoryCatalogRepository) {
  return createApp({
    databaseProbe: async () => ({ database: 'test' }),
    principalAuthenticator: new FakeAuthenticator(),
    catalogService: new CatalogService(repository),
  });
}
const authorization = (token: keyof typeof principals) => ({ authorization: `Bearer ${token}` });

describe('organization catalog and public directory vertical slice', () => {
  let repository: MemoryCatalogRepository;
  beforeEach(() => { repository = new MemoryCatalogRepository(); });

  it('publishes active branches and branch-priced services without authentication', async () => {
    const branches = await request(app(repository)).get('/api/v1/public/branches');
    const services = await request(app(repository)).get('/api/v1/public/services').query({ branchPublicId: branchA.publicId });
    expect(branches.status).toBe(200);
    expect(branches.body.data[0]).not.toHaveProperty('id');
    expect(services.status).toBe(200);
    expect(services.body.data[0].price).toEqual({ amount: '200000.00', currency: 'VND', effectiveFrom: '2026-01-01' });
  });

  it('requires a branch for the public service directory', async () => {
    const response = await request(app(repository)).get('/api/v1/public/services');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('publishes only booking-facing doctor fields', async () => {
    const response = await request(app(repository)).get('/api/v1/public/doctors').query({ branchPublicId: branchA.publicId });
    expect(response.status).toBe(200);
    expect(response.body.data[0].fullName).toBe('Bác sĩ An');
    expect(response.body.data[0]).not.toHaveProperty('medicalLicenseNo');
  });

  it('returns only the manager branch and denies catalog access outside it', async () => {
    const references = await request(app(repository)).get('/api/v1/admin/catalog/reference-data').set(authorization('manager'));
    const outside = await request(app(repository)).get('/api/v1/admin/catalog/rooms')
      .query({ branchPublicId: branchB.publicId }).set(authorization('manager'));
    expect(references.status).toBe(200);
    expect(references.body.data.branches).toHaveLength(1);
    expect(references.body.data.canManageOrganizationServices).toBe(false);
    expect(outside.status).toBe(403);
  });

  it('denies staff without MASTER_DATA_MANAGE', async () => {
    const response = await request(app(repository)).get('/api/v1/admin/catalog/reference-data')
      .set(authorization('receptionist'));
    expect(response.status).toBe(403);
  });

  it('lets a branch manager create a room and returns an ETag', async () => {
    const response = await request(app(repository)).post('/api/v1/admin/catalog/rooms')
      .set(authorization('manager')).send({ branchPublicId: branchA.publicId, code: 'LAB-02',
        name: 'Phòng xét nghiệm 02', type: 'LAB', floorNo: 2, capacity: 2 });
    expect(response.status).toBe(201);
    expect(response.headers.etag).toBe('"AAAAAAAAAAE="');
    expect(response.body.data.code).toBe('LAB-02');
  });

  it('requires optimistic concurrency and maps stale room updates', async () => {
    const missing = await request(app(repository)).put(`/api/v1/admin/catalog/rooms/${repository.room.publicId}`)
      .set(authorization('manager')).send({ name: 'Phòng mới', type: 'LAB', capacity: 1, isActive: true });
    const stale = await request(app(repository)).put(`/api/v1/admin/catalog/rooms/${repository.room.publicId}`)
      .set(authorization('manager')).set('if-match', '"AAAAAAAAAAI="')
      .send({ name: 'Phòng mới', type: 'LAB', capacity: 1, isActive: true });
    expect(missing.status).toBe(428);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CATALOG_VERSION_CONFLICT');
  });

  it('reserves organization service creation for global Admin', async () => {
    const body = { categoryPublicId: category.publicId, specialtyPublicId: specialty.publicId,
      code: 'CONSULT_NEW', name: 'Khám chuyên sâu', type: 'CONSULTATION',
      durationMinutes: 45, basePrice: '350000.00', requiresDoctor: true };
    const denied = await request(app(repository)).post('/api/v1/admin/catalog/services')
      .query({ branchPublicId: branchA.publicId }).set(authorization('manager')).send(body);
    const created = await request(app(repository)).post('/api/v1/admin/catalog/services')
      .query({ branchPublicId: branchA.publicId }).set(authorization('admin')).send(body);
    expect(denied.status).toBe(403);
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('CONSULT_NEW');
  });

  it('allows branch pricing but rejects a duplicate effective date', async () => {
    const body = { branchPublicId: branchA.publicId, amount: '250000.00',
      effectiveFrom: '2026-09-11', isAvailable: true };
    const created = await request(app(repository)).post(`/api/v1/admin/catalog/services/${repository.service.publicId}/prices`)
      .set(authorization('manager')).send(body);
    repository.duplicatePrice = true;
    const duplicate = await request(app(repository)).post(`/api/v1/admin/catalog/services/${repository.service.publicId}/prices`)
      .set(authorization('manager')).send(body);
    expect(created.status).toBe(201);
    expect(created.body.data.branchPrices[0].amount).toBe('250000.00');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('PRICE_PERIOD_CONFLICT');
  });
});
