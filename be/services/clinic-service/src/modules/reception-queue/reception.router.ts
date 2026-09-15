import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import type { PrincipalAuthenticator } from '../identity/index.js';
import { ReceptionService } from './reception.service.js';

const uuid = z.string().regex(/^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/);
const branchQuery = z.object({ branchPublicId: uuid }).strict();
const patientQuery = branchQuery.extend({ query: z.string().trim().min(2).max(100) }).strict();
const checkIn = z.object({ priorityLevel: z.number().int().min(0).max(9).default(0) }).strict();
const walkIn = z.object({ branchPublicId: uuid, patientPublicId: uuid, doctorPublicId: uuid,
  roomPublicId: uuid, servicePublicId: uuid, chiefComplaint: z.string().trim().max(1000).nullable().optional(),
  priorityLevel: z.number().int().min(0).max(9).default(0) }).strict();
const cancelEncounter = z.object({ reason: z.string().trim().min(10).max(500) }).strict();

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu tiếp nhận không hợp lệ.', {
    fields: result.error.issues.map((item) => ({ path: item.path.join('.'), message: item.message })),
  });
  return result.data;
}
function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
}
async function actor(request: Request, auth: PrincipalAuthenticator) {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'ACCESS_TOKEN_REQUIRED', 'Yêu cầu access token.');
  return auth.authenticate(authorization.slice(7));
}
function key(request: Request) {
  const value = request.header('idempotency-key');
  if (!value) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Yêu cầu header Idempotency-Key.');
  return validate(uuid, value);
}
function success(response: Response, data: unknown) {
  response.set('Cache-Control', 'no-store').json({ data, meta: {}, requestId: response.locals.requestId });
}

export function createReceptionRouter(auth: PrincipalAuthenticator, service: ReceptionService) {
  const router = Router();
  router.get('/reception/branches', asyncRoute(async (request, response) => success(response,
    await service.branches(await actor(request, auth), response.locals.requestId))));
  router.get('/reception', asyncRoute(async (request, response) => {
    const input = validate(branchQuery, request.query);
    success(response, await service.workspace(await actor(request, auth), input.branchPublicId, response.locals.requestId));
  }));
  router.get('/reception/patients', asyncRoute(async (request, response) => {
    const input = validate(patientQuery, request.query);
    success(response, await service.searchPatients(await actor(request, auth), input.branchPublicId,
      input.query, response.locals.requestId));
  }));
  router.post('/check-ins/appointments/:appointmentId', asyncRoute(async (request, response) => {
    const input = validate(checkIn, request.body ?? {});
    const item = await service.checkIn(await actor(request, auth), validate(uuid, request.params.appointmentId),
      input.priorityLevel, key(request), response.locals.requestId);
    response.status(201); success(response, item);
  }));
  router.post('/check-ins/walk-ins', asyncRoute(async (request, response) => {
    const input = validate(walkIn, request.body);
    const item = await service.createWalkIn(await actor(request, auth), input, key(request), response.locals.requestId);
    response.status(201); success(response, item);
  }));
  router.post('/queues/call-next', asyncRoute(async (request, response) => {
    const input = validate(branchQuery, request.body);
    success(response, await service.callNext(await actor(request, auth), input.branchPublicId, response.locals.requestId));
  }));
  router.post('/encounters/:encounterId/cancel', asyncRoute(async (request, response) => {
    const input = validate(cancelEncounter, request.body);
    success(response, await service.cancelEncounter(await actor(request, auth),
      validate(uuid, request.params.encounterId), input.reason, response.locals.requestId));
  }));
  return router;
}
