import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { ClinicPrincipal, PrincipalAuthenticator } from '../src/modules/identity/index.js';
import { ReportsService, type ReportsRepository } from '../src/modules/reports/index.js';

const branchId = randomUUID();
const principal: ClinicPrincipal = { userId: 42, publicId: randomUUID(), tokenVersion: 1,
  roles: [{ code: 'MANAGER', branchId: 1 }] };
class Auth implements PrincipalAuthenticator {
  authenticate(token: string) { return token === 'valid' ? Promise.resolve(principal) : Promise.reject(new Error('invalid')); }
}
const authorization = { authorization: 'Bearer valid' };
function fixture() {
  const repository = {
    branches: vi.fn().mockResolvedValue([{ publicId: branchId, code: 'MAIN', name: 'Chi nhánh chính',
      timezoneName: 'SE Asia Standard Time', canViewOperations: true, canViewRevenue: true, canViewInventory: true }]),
    operations: vi.fn().mockResolvedValue({ summary: { appointmentCount: 12, confirmedCount: 9, cancelledCount: 1,
      noShowCount: 2, encounterCount: 8, completedEncounterCount: 7, averageWaitMinutes: 11.5 }, daily: [] }),
    revenue: vi.fn().mockResolvedValue({ summary: { invoicedAmount: '1200000.00', collectedAmount: '1000000.00',
      refundedAmount: '100000.00', netCollectedAmount: '900000.00' }, daily: [] }),
    inventory: vi.fn().mockResolvedValue({ summary: { serviceQuantity: '10.000', medicineQuantity: '22.000',
      lowStockCount: 1, expiringBatchCount: 2 }, services: [], medicines: [], lowStock: [], expiringBatches: [] }),
  } as unknown as ReportsRepository;
  const app = createApp({ databaseProbe: async () => ({ database: 'test' }), principalAuthenticator: new Auth(),
    reportsService: new ReportsService(repository) });
  return { app, repository };
}

describe('reports API', () => {
  it('requires authentication and returns branch capabilities without internal identifiers', async () => {
    const { app } = fixture();
    expect((await request(app).get('/api/v1/reports/branches')).status).toBe(401);
    const response = await request(app).get('/api/v1/reports/branches').set(authorization);
    expect(response.status).toBe(200); expect(response.body.data[0].publicId).toBe(branchId);
    expect(response.body.data[0]).not.toHaveProperty('branchId');
    expect(response.headers['cache-control']).toContain('no-store');
  });
  it('forwards a bounded date range to each report repository method', async () => {
    const { app, repository } = fixture();
    for (const name of ['operations', 'revenue', 'inventory']) {
      const response = await request(app).get(`/api/v1/reports/${name}`)
        .query({ branchPublicId: branchId, from: '2026-09-01', to: '2026-09-14' }).set(authorization);
      expect(response.status).toBe(200);
    }
    expect(vi.mocked(repository.operations).mock.calls[0]?.slice(1, 3)).toEqual([
      branchId, { from: '2026-09-01', to: '2026-09-14' },
    ]);
  });
  it('rejects invalid dates before querying SQL', async () => {
    const { app, repository } = fixture();
    const response = await request(app).get('/api/v1/reports/operations')
      .query({ branchPublicId: branchId, from: '2026-09-14', to: '2026-09-01' }).set(authorization);
    expect(response.status).toBe(400); expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(repository.operations).not.toHaveBeenCalled();
  });
  it('maps database scope denial without leaking its details', async () => {
    const { app, repository } = fixture();
    vi.mocked(repository.revenue).mockRejectedValueOnce({ number: 54102, message: 'internal role details' });
    const response = await request(app).get('/api/v1/reports/revenue')
      .query({ branchPublicId: branchId, from: '2026-09-01', to: '2026-09-14' }).set(authorization);
    expect(response.status).toBe(403); expect(response.body.error.code).toBe('REPORT_FORBIDDEN');
    expect(JSON.stringify(response.body)).not.toContain('internal role details');
  });
});
