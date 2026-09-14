import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import type { PrincipalAuthenticator } from '../identity/index.js';
import { PharmacyService } from './pharmacy.service.js';

const uuid = z.string().uuid();
const money = z.number().min(0).max(999_999_999_999).refine((value) => Number.isInteger(value * 100));
const quantity = z.number().positive().max(999_999_999).refine((value) => Number.isInteger(value * 1000));
const reason = z.string().trim().min(5).max(500);
const branchQuery = z.object({ branchPublicId: uuid }).strict();
const medicine = z.object({ code: z.string().trim().min(1).max(30), genericName: z.string().trim().min(2).max(250),
  activeIngredient: z.string().trim().min(2).max(500), strength: z.string().trim().min(1).max(100),
  dosageForm: z.string().trim().min(1).max(100), route: z.string().trim().min(1).max(100),
  baseUnit: z.string().trim().min(1).max(30), salePrice: money }).strict();
const batch = z.object({ branchPublicId: uuid, medicinePublicId: uuid, batchNumber: z.string().trim().min(1).max(80),
  expiryDate: z.iso.date(), purchasePrice: money, salePrice: money }).strict();
const location = z.object({ branchPublicId: uuid, code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(150), type: z.enum(['WAREHOUSE', 'PHARMACY', 'CABINET', 'QUARANTINE']),
  isDispensing: z.boolean() }).strict();
const prescription = z.object({ validDays: z.number().int().min(1).max(90).default(7),
  clinicalNotes: z.string().trim().max(1000).nullable().optional(),
  generalInstructions: z.string().trim().max(1000).nullable().optional() }).strict();
const item = z.object({ medicinePublicId: uuid, prescribedQuantity: quantity,
  dose: z.string().trim().min(1).max(100), frequency: z.string().trim().min(1).max(100),
  durationDays: z.number().int().min(1).max(365).nullable().optional(),
  timingInstruction: z.string().trim().max(200).nullable().optional(),
  usageInstruction: z.string().trim().min(1).max(1000), sortOrder: z.number().int().min(0).max(1000).optional(),
  allergyOverrideReason: z.string().trim().max(500).nullable().optional() }).strict();
const stock = z.object({ locationPublicId: uuid, batchPublicId: uuid, quantity,
  reason: z.string().trim().max(500).nullable().optional() }).strict();
const open = z.object({ locationPublicId: uuid }).strict();
const dispense = z.object({ prescriptionItemPublicId: uuid, batchPublicId: uuid, quantity }).strict();
const reverse = z.object({ returnLocationPublicId: uuid, disposition: z.enum(['SELLABLE', 'QUARANTINE']),
  reason }).strict();
const reasonBody = z.object({ reason }).strict();

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu nhà thuốc không hợp lệ.', {
    fields: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
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
function success(response: Response, data: unknown, status = 200) {
  response.status(status).set('Cache-Control', 'no-store').json({ data, meta: {}, requestId: response.locals.requestId });
}

export function createPharmacyRouter(auth: PrincipalAuthenticator, service: PharmacyService) {
  const router = Router(); const db = service.repository;
  router.get('/pharmacy/branches', route(async (req, res) => {
    const current = await actor(req, auth);
    success(res, await service.run(() => db.branches(current, res.locals.requestId)));
  }));
  router.get('/pharmacy/workspace', route(async (req, res) => {
    const { branchPublicId } = validate(branchQuery, req.query); const current = await actor(req, auth);
    success(res, await service.run(() => db.workspace(current, branchPublicId, res.locals.requestId)));
  }));
  router.get('/pharmacy/reconciliation', route(async (req, res) => {
    const { branchPublicId } = validate(branchQuery, req.query); const current = await actor(req, auth);
    success(res, await service.run(() => db.reconcile(current, branchPublicId, res.locals.requestId)));
  }));
  router.get('/prescriptions/:prescriptionId', route(async (req, res) => {
    const current = await actor(req, auth); const id = validate(uuid, req.params.prescriptionId);
    success(res, await service.run(() => db.get(current, id, res.locals.requestId)));
  }));
  router.post('/pharmacy/medicines', route(async (req, res) => {
    const input = validate(medicine, req.body); const current = await actor(req, auth);
    const publicId = await service.run(() => db.createMedicine(current, input, res.locals.requestId));
    success(res, { publicId }, 201);
  }));
  router.post('/pharmacy/batches', route(async (req, res) => {
    const input = validate(batch, req.body); const current = await actor(req, auth);
    const publicId = await service.run(() => db.createBatch(current, input, res.locals.requestId));
    success(res, { publicId }, 201);
  }));
  router.post('/pharmacy/locations', route(async (req, res) => {
    const input = validate(location, req.body); const current = await actor(req, auth);
    const publicId = await service.run(() => db.createLocation(current, input, res.locals.requestId));
    success(res, { publicId }, 201);
  }));
  router.post('/encounters/:encounterId/prescriptions', route(async (req, res) => {
    const input = validate(prescription, req.body ?? {}); const current = await actor(req, auth);
    const publicId = await service.run(() => db.createPrescription(current,
      validate(uuid, req.params.encounterId), input, res.locals.requestId));
    success(res, await service.run(() => db.get(current, publicId, res.locals.requestId)), 201);
  }));
  router.post('/prescriptions/:prescriptionId/items', route(async (req, res) => {
    const input = validate(item, req.body); const current = await actor(req, auth);
    const prescriptionId = validate(uuid, req.params.prescriptionId);
    await service.run(() => db.addItem(current, prescriptionId, input, res.locals.requestId));
    success(res, await service.run(() => db.get(current, prescriptionId, res.locals.requestId)), 201);
  }));
  router.post('/prescriptions/:prescriptionId/issue', route(async (req, res) => {
    const current = await actor(req, auth); const id = validate(uuid, req.params.prescriptionId);
    await service.run(() => db.issue(current, id, res.locals.requestId));
    success(res, await service.run(() => db.get(current, id, res.locals.requestId)));
  }));
  router.post('/prescriptions/:prescriptionId/cancel', route(async (req, res) => {
    const { reason: why } = validate(reasonBody, req.body); const current = await actor(req, auth);
    const id = validate(uuid, req.params.prescriptionId);
    await service.run(() => db.cancelPrescription(current, id, why, res.locals.requestId));
    success(res, await service.run(() => db.get(current, id, res.locals.requestId)));
  }));
  router.post('/pharmacy/receipts', route(async (req, res) => {
    const input = validate(stock, req.body); const current = await actor(req, auth);
    const key = validate(uuid, req.header('idempotency-key'));
    const publicId = await service.run(() => db.receive(current, input.locationPublicId,
      input.batchPublicId, input.quantity, input.reason ?? null, key, res.locals.requestId));
    success(res, { publicId }, 201);
  }));
  router.post('/prescriptions/:prescriptionId/dispensations', route(async (req, res) => {
    const input = validate(open, req.body); const current = await actor(req, auth);
    const id = validate(uuid, req.params.prescriptionId);
    const publicId = await service.run(() => db.openDispensation(current, id, input.locationPublicId, res.locals.requestId));
    success(res, { publicId }, 201);
  }));
  router.post('/dispensations/:dispensationId/items', route(async (req, res) => {
    const input = validate(dispense, req.body); const current = await actor(req, auth);
    const key = validate(uuid, req.header('idempotency-key'));
    const publicId = await service.run(() => db.dispense(current, validate(uuid, req.params.dispensationId),
      input.prescriptionItemPublicId, input.batchPublicId, input.quantity, key, res.locals.requestId));
    success(res, { publicId }, 201);
  }));
  router.post('/dispensations/:dispensationId/complete', route(async (req, res) => {
    const current = await actor(req, auth); await service.run(() => db.completeDispensation(current,
      validate(uuid, req.params.dispensationId), res.locals.requestId));
    success(res, { status: 'COMPLETED' });
  }));
  router.post('/dispensations/:dispensationId/cancel', route(async (req, res) => {
    const { reason: why } = validate(reasonBody, req.body); const current = await actor(req, auth);
    await service.run(() => db.cancelDispensation(current, validate(uuid, req.params.dispensationId), why, res.locals.requestId));
    success(res, { status: 'CANCELLED' });
  }));
  router.post('/pharmacy/dispensation-items/:itemId/reverse', route(async (req, res) => {
    const input = validate(reverse, req.body); const current = await actor(req, auth);
    const publicId = await service.run(() => db.reverse(current, validate(uuid, req.params.itemId),
      input.returnLocationPublicId, input.disposition, input.reason, res.locals.requestId));
    success(res, { publicId });
  }));
  return router;
}
