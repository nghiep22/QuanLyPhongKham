import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { BillingService } from '../src/modules/billing/billing.service.js';
import type { BillingRepository, InvoiceDetail } from '../src/modules/billing/billing.types.js';
import type { ClinicPrincipal, PrincipalAuthenticator } from '../src/modules/identity/index.js';

const branchId = randomUUID(); const encounterId = randomUUID(); const invoiceId = randomUUID();
const allocationId = randomUUID(); const paymentId = randomUUID(); const refundId = randomUUID();
const principal: ClinicPrincipal = { userId: 42, publicId: randomUUID(), tokenVersion: 1,
  roles: [{ code: 'CASHIER', branchId: 1 }] };
class Auth implements PrincipalAuthenticator {
  authenticate(token: string) { return token === 'valid' ? Promise.resolve(principal) : Promise.reject(new Error('invalid')); }
}
const authorization = { authorization: 'Bearer valid' };
function detail(): InvoiceDetail {
  return { publicId: invoiceId, number: 'HD-1', status: 'DRAFT', encounterPublicId: encounterId,
    encounterCode: 'LK-1', patientPublicId: randomUUID(), patientCode: 'BN-1', patientName: 'Nguyễn An', currency: 'VND',
    supersedesInvoicePublicId: null, subtotalAmount: '100000.00', discountAmount: '0.00', taxAmount: '0.00',
    totalAmount: '100000.00', insuranceAmount: '0.00', patientPayableAmount: '100000.00', paidAmount: '0.00',
    refundedAmount: '0.00', balanceDue: '100000.00', issuedAtUtc: null, dueAtUtc: null, voidedAtUtc: null,
    voidReason: null, createdAtUtc: new Date().toISOString(), items: [], payments: [], refunds: [] };
}
function fixture() {
  const invoice = detail();
  const repository = {
    branches: vi.fn().mockResolvedValue([{ publicId: branchId, code: 'MAIN', name: 'Chi nhánh chính',
      timezoneName: 'SE Asia Standard Time' }]),
    workspace: vi.fn().mockResolvedValue({ encounters: [], invoices: [] }),
    get: vi.fn().mockImplementation(async () => invoice), create: vi.fn().mockResolvedValue(invoiceId),
    synchronize: vi.fn().mockResolvedValue(undefined), addManualItem: vi.fn().mockResolvedValue(randomUUID()),
    setInsurance: vi.fn().mockResolvedValue(undefined), issue: vi.fn().mockImplementation(async () => { invoice.status = 'ISSUED'; }),
    recordPayment: vi.fn().mockImplementation(async () => { invoice.status = 'PAID'; invoice.paidAmount = '100000.00';
      invoice.balanceDue = '0.00'; return paymentId; }), refund: vi.fn().mockResolvedValue(refundId),
    voidInvoice: vi.fn().mockImplementation(async () => { invoice.status = 'VOID'; }),
  } as unknown as BillingRepository;
  const app = createApp({ databaseProbe: async () => ({ database: 'test' }), principalAuthenticator: new Auth(),
    billingService: new BillingService(repository) });
  return { app, repository };
}

describe('billing API', () => {
  it('requires authentication and exposes public identifiers only', async () => {
    const { app } = fixture();
    expect((await request(app).get('/api/v1/billing/branches')).status).toBe(401);
    const result = await request(app).get('/api/v1/billing/branches').set(authorization);
    expect(result.status).toBe(200); expect(result.body.data[0].publicId).toBe(branchId);
    expect(result.body.data[0]).not.toHaveProperty('branchId');
  });
  it('creates, synchronizes and issues an invoice with an idempotency key', async () => {
    const { app, repository } = fixture(); const key = randomUUID();
    expect((await request(app).post(`/api/v1/encounters/${encounterId}/invoices`).set(authorization).send({})).status).toBe(201);
    expect((await request(app).post(`/api/v1/invoices/${invoiceId}/synchronize`).set(authorization)).status).toBe(200);
    expect((await request(app).post(`/api/v1/invoices/${invoiceId}/issue`).set(authorization).send({})).status).toBe(400);
    const issued = await request(app).post(`/api/v1/invoices/${invoiceId}/issue`).set(authorization)
      .set('Idempotency-Key', key).send({});
    expect(issued.status).toBe(200); expect(issued.body.data.status).toBe('ISSUED');
    expect(vi.mocked(repository.issue).mock.calls[0]?.[3]).toBe(key);
  });
  it('validates non-cash transactions and forwards payment/refund idempotency keys', async () => {
    const { app, repository } = fixture(); const key = randomUUID();
    const invalid = await request(app).post(`/api/v1/invoices/${invoiceId}/payments`).set(authorization)
      .set('Idempotency-Key', key).send({ amount: 100000, method: 'CARD' });
    const paid = await request(app).post(`/api/v1/invoices/${invoiceId}/payments`).set(authorization)
      .set('Idempotency-Key', key).send({ amount: 100000, method: 'CASH' });
    const refunded = await request(app).post(`/api/v1/payment-allocations/${allocationId}/refunds`).set(authorization)
      .set('Idempotency-Key', key).send({ amount: 50000, method: 'CASH', reason: 'Khách yêu cầu hoàn' });
    expect(invalid.status).toBe(400); expect(paid.status).toBe(201); expect(refunded.status).toBe(201);
    expect(vi.mocked(repository.recordPayment).mock.calls[0]?.[3]).toBe(key);
    expect(vi.mocked(repository.refund).mock.calls[0]?.[3]).toBe(key);
  });
  it('maps completeness and overpayment races to a safe conflict', async () => {
    const { app, repository } = fixture();
    vi.mocked(repository.issue).mockRejectedValueOnce({ number: 53429, message: 'internal charge details' });
    const result = await request(app).post(`/api/v1/invoices/${invoiceId}/issue`).set(authorization)
      .set('Idempotency-Key', randomUUID()).send({});
    expect(result.status).toBe(409); expect(result.body.error.code).toBe('BILLING_CONFLICT');
    expect(JSON.stringify(result.body)).not.toContain('internal charge details');
  });
});
