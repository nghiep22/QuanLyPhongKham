import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import type { PrincipalAuthenticator } from '../identity/index.js';
import { BillingService } from './billing.service.js';

const uuid = z.string().uuid();
const money = z.number().min(0).max(999_999_999_999).refine((value) => Number.isInteger(value * 100));
const positiveMoney = money.refine((value) => value > 0);
const method = z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'EWALLET', 'OTHER']);
const branchQuery = z.object({ branchPublicId: uuid }).strict();
const createInvoice = z.object({ supersedesInvoicePublicId: uuid.nullable().optional() }).strict();
const manualItem = z.object({ code: z.string().trim().max(40).nullable().optional(), name: z.string().trim().min(2).max(300),
  quantity: z.number().positive().max(999_999_999).refine((value) => Number.isInteger(value * 1000)),
  unitPrice: money, discountAmount: money.optional(), taxRatePercent: z.number().min(0).max(100).optional() }).strict();
const insurance = z.object({ amount: money }).strict();
const issue = z.object({ dueAtUtc: z.iso.datetime({ offset: true }).nullable().optional() }).strict();
const financial = z.object({ amount: positiveMoney, method, externalTransactionId: z.string().trim().min(1).max(150).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional() }).strict().superRefine((value, context) => {
    if (value.method !== 'CASH' && !value.externalTransactionId)
      context.addIssue({ code: 'custom', path: ['externalTransactionId'], message: 'Mã giao dịch là bắt buộc.' });
  });
const refund = z.object({ amount: positiveMoney, method, externalTransactionId: z.string().trim().min(1).max(150).nullable().optional(),
  reason: z.string().trim().min(5).max(500) }).strict().superRefine((value, context) => {
    if (value.method !== 'CASH' && !value.externalTransactionId)
      context.addIssue({ code: 'custom', path: ['externalTransactionId'], message: 'Mã giao dịch là bắt buộc.' });
  });
const reasonBody = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu hóa đơn không hợp lệ.', {
    fields: parsed.error.issues.map((item) => ({ path: item.path.join('.'), message: item.message })),
  });
  return parsed.data;
}
function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
}
async function actor(request: Request, auth: PrincipalAuthenticator) {
  const token = request.header('authorization');
  if (!token?.startsWith('Bearer ')) throw new HttpError(401, 'ACCESS_TOKEN_REQUIRED', 'Yêu cầu access token.');
  return auth.authenticate(token.slice(7));
}
function key(request: Request) { return validate(uuid, request.header('idempotency-key')); }
function success(response: Response, data: unknown, status = 200) {
  response.status(status).set('Cache-Control', 'no-store').json({ data, meta: {}, requestId: response.locals.requestId });
}

export function createBillingRouter(auth: PrincipalAuthenticator, service: BillingService) {
  const router = Router(); const db = service.repository;
  router.get('/billing/branches', route(async (req, res) => {
    const current = await actor(req, auth); success(res, await service.run(() => db.branches(current, res.locals.requestId)));
  }));
  router.get('/billing/workspace', route(async (req, res) => {
    const { branchPublicId } = validate(branchQuery, req.query); const current = await actor(req, auth);
    success(res, await service.run(() => db.workspace(current, branchPublicId, res.locals.requestId)));
  }));
  router.get('/invoices/:invoiceId', route(async (req, res) => {
    const current = await actor(req, auth); const invoiceId = validate(uuid, req.params.invoiceId);
    success(res, await service.run(() => db.get(current, invoiceId, res.locals.requestId)));
  }));
  router.post('/encounters/:encounterId/invoices', route(async (req, res) => {
    const input = validate(createInvoice, req.body ?? {}); const current = await actor(req, auth);
    const publicId = await service.run(() => db.create(current, validate(uuid, req.params.encounterId),
      input.supersedesInvoicePublicId ?? null, res.locals.requestId));
    success(res, await service.run(() => db.get(current, publicId, res.locals.requestId)), 201);
  }));
  router.post('/invoices/:invoiceId/synchronize', route(async (req, res) => {
    const current = await actor(req, auth); const invoiceId = validate(uuid, req.params.invoiceId);
    await service.run(() => db.synchronize(current, invoiceId, res.locals.requestId));
    success(res, await service.run(() => db.get(current, invoiceId, res.locals.requestId)));
  }));
  router.post('/invoices/:invoiceId/items', route(async (req, res) => {
    const input = validate(manualItem, req.body); const current = await actor(req, auth);
    const invoiceId = validate(uuid, req.params.invoiceId);
    await service.run(() => db.addManualItem(current, invoiceId, input, res.locals.requestId));
    success(res, await service.run(() => db.get(current, invoiceId, res.locals.requestId)), 201);
  }));
  router.patch('/invoices/:invoiceId/insurance', route(async (req, res) => {
    const input = validate(insurance, req.body); const current = await actor(req, auth);
    const invoiceId = validate(uuid, req.params.invoiceId);
    await service.run(() => db.setInsurance(current, invoiceId, input.amount, res.locals.requestId));
    success(res, await service.run(() => db.get(current, invoiceId, res.locals.requestId)));
  }));
  router.post('/invoices/:invoiceId/issue', route(async (req, res) => {
    const input = validate(issue, req.body ?? {}); const current = await actor(req, auth);
    const invoiceId = validate(uuid, req.params.invoiceId);
    await service.run(() => db.issue(current, invoiceId, input.dueAtUtc ?? null, key(req), res.locals.requestId));
    success(res, await service.run(() => db.get(current, invoiceId, res.locals.requestId)));
  }));
  router.post('/invoices/:invoiceId/payments', route(async (req, res) => {
    const input = validate(financial, req.body); const current = await actor(req, auth);
    const invoiceId = validate(uuid, req.params.invoiceId);
    await service.run(() => db.recordPayment(current, invoiceId, input, key(req), res.locals.requestId));
    success(res, await service.run(() => db.get(current, invoiceId, res.locals.requestId)), 201);
  }));
  router.post('/payment-allocations/:allocationId/refunds', route(async (req, res) => {
    const input = validate(refund, req.body); const current = await actor(req, auth);
    const allocationId = validate(uuid, req.params.allocationId);
    const refundPublicId = await service.run(() => db.refund(current, allocationId, input, key(req), res.locals.requestId));
    success(res, { publicId: refundPublicId }, 201);
  }));
  router.post('/invoices/:invoiceId/void', route(async (req, res) => {
    const input = validate(reasonBody, req.body); const current = await actor(req, auth);
    const invoiceId = validate(uuid, req.params.invoiceId);
    await service.run(() => db.voidInvoice(current, invoiceId, input.reason, res.locals.requestId));
    success(res, await service.run(() => db.get(current, invoiceId, res.locals.requestId)));
  }));
  return router;
}
