import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import type { PrincipalAuthenticator } from '../identity/index.js';
import { PatientService } from './patient.service.js';

// SQL Server NEWSEQUENTIALID keeps GUID layout but does not always use an RFC UUID version nibble.
const uuid = z.string().regex(/^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const patientFields = z.object({
  fullName: z.string().trim().min(2).max(200), dateOfBirth: dateOnly,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  nationalId: optionalText(30), healthInsuranceNo: optionalText(30),
  phone: optionalText(20), email: optionalText(254),
  addressLine: optionalText(300), province: optionalText(100),
}).strict();
const branch = z.object({ branchPublicId: uuid }).strict();
const search = branch.extend({ query: z.string().trim().min(2).max(100).optional(), dateOfBirth: dateOnly.optional() }).strict();
const create = patientFields.extend({ branchPublicId: uuid, duplicateOverride: z.boolean().default(false),
  duplicateReason: z.string().trim().min(10).max(500).optional() }).strict();
const duplicates = patientFields.extend({ branchPublicId: uuid }).strict();
const etag = /^"([A-Za-z0-9+/]{11}=)"$/;

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu gửi lên không hợp lệ.', {
    fields: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
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
function version(request: Request) {
  const value = request.header('if-match');
  if (!value) throw new HttpError(428, 'PRECONDITION_REQUIRED', 'Cập nhật hồ sơ yêu cầu If-Match.');
  const match = etag.exec(value);
  if (!match) throw new HttpError(400, 'INVALID_IF_MATCH', 'If-Match không đúng định dạng.');
  return match[1]!;
}
function success(response: Response, data: unknown) {
  response.set('Cache-Control', 'no-store');
  response.json({ data, meta: {}, requestId: response.locals.requestId });
}

export function createPatientAdminRouter(auth: PrincipalAuthenticator, patients: PatientService) {
  const router = Router();
  router.get('/reference-data', asyncRoute(async (request, response) => {
    success(response, { branches: await patients.branches(await actor(request, auth)) });
  }));
  router.post('/search', asyncRoute(async (request, response) => {
    const input = validate(search, request.body);
    success(response, await patients.search(await actor(request, auth), input.branchPublicId,
      response.locals.requestId, input.query, input.dateOfBirth));
  }));
  router.post('/duplicates', asyncRoute(async (request, response) => {
    const input = validate(duplicates, request.body);
    success(response, await patients.duplicates(await actor(request, auth), input.branchPublicId, response.locals.requestId, input));
  }));
  router.get('/:patientId', asyncRoute(async (request, response) => {
    const input = validate(branch, request.query);
    const patient = await patients.get(await actor(request, auth), input.branchPublicId,
      validate(uuid, request.params.patientId), response.locals.requestId);
    response.set('ETag', `"${patient.rowVersion}"`); success(response, patient);
  }));
  router.post('/', asyncRoute(async (request, response) => {
    const patient = await patients.create(await actor(request, auth), validate(create, request.body), response.locals.requestId);
    response.status(201).set('ETag', `"${patient.rowVersion}"`); success(response, patient);
  }));
  router.put('/:patientId', asyncRoute(async (request, response) => {
    const input = validate(branch, request.query);
    const patient = await patients.update(await actor(request, auth), input.branchPublicId,
      validate(uuid, request.params.patientId), validate(patientFields, request.body), version(request), response.locals.requestId);
    response.set('ETag', `"${patient.rowVersion}"`); success(response, patient);
  }));
  return router;
}

export function createPatientClinicalRouter(auth: PrincipalAuthenticator, patients: PatientService) {
  const router = Router();
  router.get('/:patientId/clinical-summary', asyncRoute(async (request, response) => {
    const input = validate(branch, request.query);
    success(response, await patients.clinicalSummary(await actor(request, auth), input.branchPublicId,
      validate(uuid, request.params.patientId), response.locals.requestId));
  }));
  return router;
}
