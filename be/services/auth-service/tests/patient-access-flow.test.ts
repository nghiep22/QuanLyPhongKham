import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';
import type { AuthPrincipal } from '../src/modules/auth/auth.types.js';
import { PatientAccessService } from '../src/modules/patient-access/patient-access.service.js';
import type {
  CreatePatientLinkRequestInput,
  PatientAccessLink,
  PatientAccessRepository,
  PatientLinkRequestView,
  StaffPatientLinkRequest,
  StaffPatientLinkRequestQuery,
} from '../src/modules/patient-access/patient-access.types.js';

const branchA = { id: 10, publicId: randomUUID(), code: 'MAIN', name: 'Chi nhánh chính' };
const branchB = { id: 20, publicId: randomUUID(), code: 'WEST', name: 'Chi nhánh Tây' };
const patientPublicId = randomUUID();
const requesterPublicId = randomUUID();
const rowVersion = 'AAAAAAAAAAA=';

const principals: Record<string, AuthPrincipal> = {
  patient: {
    userId: 10, publicId: requesterPublicId, displayName: 'Bệnh nhân', tokenVersion: 1,
    roles: [{ code: 'PATIENT', branchId: null }], permissions: ['APPOINTMENTS_SELF'],
  },
  receptionist: {
    userId: 20, publicId: randomUUID(), displayName: 'Lễ tân', tokenVersion: 1,
    roles: [{ code: 'RECEPTIONIST', branchId: String(branchA.id) }],
    permissions: ['PATIENT_PORTAL_LINK_MANAGE'],
  },
  outsider: {
    userId: 30, publicId: randomUUID(), displayName: 'Nhân viên ngoài phạm vi', tokenVersion: 1,
    roles: [{ code: 'RECEPTIONIST', branchId: String(branchB.id) }], permissions: [],
  },
};

function fakeAuth(): AuthService {
  return {
    authenticate: async (token: string) => {
      const principal = principals[token];
      if (!principal) throw new Error('invalid');
      return principal;
    },
    getJwks: async () => ({ keys: [] }),
  } as unknown as AuthService;
}

function link(): PatientAccessLink {
  return {
    publicId: randomUUID(),
    patient: { publicId: patientPublicId, code: 'BN0001', fullName: 'Bệnh nhân A', dateOfBirth: '1990-01-01' },
    relationshipType: 'SELF', status: 'ACTIVE', bookingAllowed: true, accessKind: 'OWN',
    linkedUser: { publicId: requesterPublicId, displayName: 'Bệnh nhân' },
    verifiedBranch: { publicId: branchA.publicId, name: branchA.name },
    verifiedAtUtc: new Date().toISOString(), canRevoke: false, rowVersion,
  };
}

function patientRequest(publicId = randomUUID()): PatientLinkRequestView {
  return {
    publicId,
    branch: { publicId: branchA.publicId, code: branchA.code, name: branchA.name },
    patientReference: '**0001', relationshipType: 'CHILD', requestNote: 'Giấy khai sinh',
    status: 'PENDING', decisionReason: null, createdAtUtc: new Date().toISOString(),
    expiresAtUtc: new Date(Date.now() + 86_400_000).toISOString(), decidedAtUtc: null,
    patient: null, rowVersion,
  };
}

class MemoryPatientAccessRepository implements PatientAccessRepository {
  readonly branches = [branchA, branchB];
  readonly links = [link()];
  readonly requests: PatientLinkRequestView[] = [];
  private readonly idempotency = new Map<string, { hash: string; requestId: string }>();

  resolveBranch(publicId: string) {
    return Promise.resolve(this.branches.find((branch) => branch.publicId === publicId) ?? null);
  }
  listPatientBranches() { return Promise.resolve(this.branches); }
  listManagedBranches(actorUserId: number) {
    return Promise.resolve(actorUserId === principals.receptionist!.userId ? [branchA] : []);
  }
  hasPermission(actorUserId: number, permission: string, branchId: number | null) {
    return Promise.resolve(actorUserId === principals.receptionist!.userId
      && permission === 'PATIENT_PORTAL_LINK_MANAGE' && branchId === branchA.id);
  }
  requestLink(input: Parameters<PatientAccessRepository['requestLink']>[0]) {
    const existing = this.idempotency.get(input.idempotencyKey);
    const hash = input.requestHash.toString('hex');
    if (existing && existing.hash !== hash) return Promise.reject({ number: 53506 });
    if (existing) return Promise.resolve({ requestPublicId: existing.requestId, created: false });
    const item = patientRequest();
    this.requests.push(item);
    this.idempotency.set(input.idempotencyKey, { hash, requestId: item.publicId });
    return Promise.resolve({ requestPublicId: item.publicId, created: true });
  }
  getPatientAccess() { return Promise.resolve({ links: this.links, requests: this.requests }); }
  cancelRequest(_actorUserId: number, requestPublicId: string) {
    const item = this.requests.find(({ publicId }) => publicId === requestPublicId);
    if (!item) return Promise.reject({ number: 53508 });
    item.status = 'CANCELLED';
    return Promise.resolve();
  }
  listRequests(_actorUserId: number, _branchId: number, query: StaffPatientLinkRequestQuery) {
    const items = this.requests.filter((item) => !query.status || item.status === query.status)
      .map((item): StaffPatientLinkRequest => ({
        ...item,
        requester: { publicId: requesterPublicId, displayName: 'Bệnh nhân', email: 'patient@example.test', phone: null },
        patient: { publicId: patientPublicId, code: 'BN0001', fullName: 'Bệnh nhân A', dateOfBirth: '1990-01-01' },
      }));
    return Promise.resolve({ items, total: items.length });
  }
  decideRequest(actorUserId: number, requestPublicId: string, decision: 'APPROVED' | 'REJECTED', _reason: string,
    expectedRowVersion: string) {
    if (actorUserId !== principals.receptionist!.userId) return Promise.reject({ number: 51002 });
    if (expectedRowVersion !== rowVersion) return Promise.reject({ number: 53513 });
    const item = this.requests.find(({ publicId }) => publicId === requestPublicId);
    if (!item) return Promise.reject({ number: 53512 });
    item.status = decision;
    return Promise.resolve(decision === 'APPROVED' ? randomUUID() : null);
  }
  revokeLink(actorUserId: number, linkPublicId: string) {
    const item = this.links.find(({ publicId }) => publicId === linkPublicId);
    if (!item) return Promise.reject({ number: 53519 });
    if (actorUserId === principals.patient!.userId && item.relationshipType === 'SELF') {
      return Promise.reject({ number: 51002 });
    }
    return Promise.resolve();
  }
}

function app(repository: MemoryPatientAccessRepository) {
  return createApp({
    authService: fakeAuth(), patientAccessService: new PatientAccessService(repository),
    databaseProbe: async () => ({ database: 'test' }),
  });
}

const authorization = (token: keyof typeof principals) => ({ authorization: `Bearer ${token}` });
const requestBody = (overrides: Partial<CreatePatientLinkRequestInput> = {}) => ({
  branchPublicId: branchA.publicId,
  patientCode: 'BN0001',
  dateOfBirth: '1990-01-01',
  relationshipType: 'CHILD',
  requestNote: 'Có giấy khai sinh',
  ...overrides,
});

describe('patient portal linking vertical slice', () => {
  let repository: MemoryPatientAccessRepository;
  beforeEach(() => { repository = new MemoryPatientAccessRepository(); });

  it('requires an authenticated patient and an idempotency key', async () => {
    const missingKey = await request(app(repository)).post('/api/v1/patient-access/requests')
      .set(authorization('patient')).send(requestBody());
    const staffAttempt = await request(app(repository)).post('/api/v1/patient-access/requests')
      .set(authorization('receptionist')).set('Idempotency-Key', randomUUID()).send(requestBody());
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(staffAttempt.status).toBe(403);
    expect(staffAttempt.body.error.code).toBe('PATIENT_ACCOUNT_REQUIRED');
  });

  it('returns the same request for a safe retry and rejects a changed payload', async () => {
    const key = randomUUID();
    const first = await request(app(repository)).post('/api/v1/patient-access/requests')
      .set(authorization('patient')).set('Idempotency-Key', key).send(requestBody());
    const retry = await request(app(repository)).post('/api/v1/patient-access/requests')
      .set(authorization('patient')).set('Idempotency-Key', key).send(requestBody());
    const changed = await request(app(repository)).post('/api/v1/patient-access/requests')
      .set(authorization('patient')).set('Idempotency-Key', key)
      .send(requestBody({ relationshipType: 'PARENT' }));
    expect(first.status).toBe(202);
    expect(retry.body.data.requestId).toBe(first.body.data.requestId);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('lists only the branches a staff member may manage', async () => {
    const response = await request(app(repository)).get('/api/v1/admin/patient-link-requests/reference-data')
      .set(authorization('receptionist'));
    const denied = await request(app(repository)).get('/api/v1/admin/patient-link-requests')
      .set(authorization('receptionist')).query({ branchPublicId: branchB.publicId });
    expect(response.status).toBe(200);
    expect(response.body.data.branches).toHaveLength(1);
    expect(denied.status).toBe(403);
  });

  it('requires optimistic concurrency and approves a pending request', async () => {
    const created = await request(app(repository)).post('/api/v1/patient-access/requests')
      .set(authorization('patient')).set('Idempotency-Key', randomUUID()).send(requestBody());
    const requestId = created.body.data.requestId as string;
    const missingVersion = await request(app(repository))
      .post(`/api/v1/admin/patient-link-requests/${requestId}/decision`)
      .set(authorization('receptionist')).send({ decision: 'APPROVE', reason: 'Đã đối chiếu giấy tờ' });
    const approved = await request(app(repository))
      .post(`/api/v1/admin/patient-link-requests/${requestId}/decision`)
      .set(authorization('receptionist')).set('If-Match', `"${rowVersion}"`)
      .send({ decision: 'APPROVE', reason: 'Đã đối chiếu giấy tờ' });
    expect(missingVersion.status).toBe(428);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.linkPublicId).toBeTruthy();
  });

  it('maps stale decisions to a version conflict', async () => {
    const item = patientRequest();
    repository.requests.push(item);
    const response = await request(app(repository))
      .post(`/api/v1/admin/patient-link-requests/${item.publicId}/decision`)
      .set(authorization('receptionist')).set('If-Match', '"AAAAAAAAAAE="')
      .send({ decision: 'REJECT', reason: 'Không đủ giấy tờ' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PATIENT_LINK_VERSION_CONFLICT');
  });

  it('rejects a patient attempting to approve a link request', async () => {
    const item = patientRequest();
    repository.requests.push(item);
    const response = await request(app(repository))
      .post(`/api/v1/admin/patient-link-requests/${item.publicId}/decision`)
      .set(authorization('patient')).set('If-Match', `"${rowVersion}"`)
      .send({ decision: 'APPROVE', reason: 'Tự duyệt trái phép' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('allows cancellation but protects the primary SELF link from patient revocation', async () => {
    const item = patientRequest();
    repository.requests.push(item);
    const cancelled = await request(app(repository)).delete(`/api/v1/patient-access/requests/${item.publicId}`)
      .set(authorization('patient'));
    const revoked = await request(app(repository)).delete(`/api/v1/patient-access/links/${repository.links[0]!.publicId}`)
      .set(authorization('patient')).send({ reason: 'Không dùng nữa' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.cancelled).toBe(true);
    expect(revoked.status).toBe(403);
    expect(revoked.body.error.code).toBe('FORBIDDEN');
  });
});
