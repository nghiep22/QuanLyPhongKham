import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import { AuthService } from '../auth/auth.service.js';
import { patientRelationships } from './patient-access.types.js';
import { PatientAccessService } from './patient-access.service.js';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value && parsed < new Date();
}, 'Ngày sinh không hợp lệ hoặc ở tương lai.');
const relationship = z.enum(patientRelationships);
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const requestSchema = z.object({
  branchPublicId: uuid,
  patientCode: z.string().trim().min(2).max(30),
  dateOfBirth: dateOnly,
  relationshipType: relationship,
  requestNote: z.string().trim().max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.relationshipType !== 'SELF' && (!value.requestNote || value.requestNote.length < 3)) {
    context.addIssue({ code: 'custom', path: ['requestNote'], message: 'Liên kết người thân cần ghi chú xác minh.' });
  }
});
const requestListSchema = z.object({
  branchPublicId: uuid,
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(3).max(500),
}).strict();
const rowVersionPattern = /^"([A-Za-z0-9+/]{11}=)"$/;

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu gửi lên không hợp lệ.', {
      fields: result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })),
    });
  }
  return result.data;
}

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
}

async function actor(request: Request, auth: AuthService) {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new HttpError(401, 'ACCESS_TOKEN_REQUIRED', 'Yêu cầu access token.');
  }
  return auth.authenticate(authorization.slice(7));
}

function success(response: Response, data: unknown, meta: Record<string, unknown> = {}) {
  response.json({ data, meta, requestId: response.locals.requestId });
}

function idempotencyKey(request: Request) {
  const value = request.header('idempotency-key');
  if (!value) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Yêu cầu header Idempotency-Key.');
  return validate(uuid, value);
}

function ifMatch(request: Request) {
  const value = request.header('if-match');
  if (!value) throw new HttpError(428, 'PRECONDITION_REQUIRED', 'Duyệt yêu cầu cần header If-Match.');
  const match = rowVersionPattern.exec(value);
  if (!match) throw new HttpError(400, 'INVALID_IF_MATCH', 'Header If-Match không đúng định dạng row version.');
  return match[1]!;
}

function noStore(_request: Request, response: Response, next: NextFunction) {
  response.set('cache-control', 'no-store');
  next();
}

export function createPatientAccessRouter(auth: AuthService, service: PatientAccessService) {
  const router = Router();
  router.use(noStore);

  router.get('/reference-data', asyncRoute(async (request, response) => {
    success(response, await service.patientReferences(await actor(request, auth)));
  }));
  router.get('/', asyncRoute(async (request, response) => {
    success(response, await service.getPatientAccess(await actor(request, auth), response.locals.requestId));
  }));
  router.post('/requests', asyncRoute(async (request, response) => {
    const result = await service.request(
      await actor(request, auth), validate(requestSchema, request.body),
      idempotencyKey(request), response.locals.requestId,
    );
    response.status(202);
    success(response, result);
  }));
  router.delete('/requests/:requestId', asyncRoute(async (request, response) => {
    success(response, await service.cancel(
      await actor(request, auth), validate(uuid, request.params.requestId), response.locals.requestId,
    ));
  }));
  router.delete('/links/:linkId', asyncRoute(async (request, response) => {
    const body = validate(reasonSchema, request.body);
    success(response, await service.revoke(
      await actor(request, auth), validate(uuid, request.params.linkId), body.reason, response.locals.requestId,
    ));
  }));
  return router;
}

export function createPatientAccessAdminRouter(auth: AuthService, service: PatientAccessService) {
  const router = Router();
  router.use(noStore);

  router.get('/patient-link-requests/reference-data', asyncRoute(async (request, response) => {
    success(response, await service.staffReferences(await actor(request, auth)));
  }));
  router.get('/patient-link-requests', asyncRoute(async (request, response) => {
    const query = validate(requestListSchema, request.query);
    const result = await service.listRequests(await actor(request, auth), query, response.locals.requestId);
    success(response, result.items, { page: query.page, pageSize: query.pageSize, total: result.total });
  }));
  router.post('/patient-link-requests/:requestId/decision', asyncRoute(async (request, response) => {
    const body = validate(decisionSchema, request.body);
    success(response, await service.decide(
      await actor(request, auth), validate(uuid, request.params.requestId), body.decision,
      body.reason, ifMatch(request), response.locals.requestId,
    ));
  }));
  router.delete('/patient-links/:linkId', asyncRoute(async (request, response) => {
    const body = validate(reasonSchema, request.body);
    success(response, await service.revoke(
      await actor(request, auth), validate(uuid, request.params.linkId), body.reason, response.locals.requestId,
    ));
  }));
  return router;
}
