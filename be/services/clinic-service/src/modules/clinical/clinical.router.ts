import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import type { PrincipalAuthenticator } from '../identity/index.js';
import { ClinicalService } from './clinical.service.js';
import type { EncounterStatus } from './clinical.types.js';

const uuid = z.string().regex(/^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/);
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalNumber = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();
const optionalInteger = (min: number, max: number) => z.number().int().min(min).max(max).nullable().optional();
const listQuery = z.object({ branchPublicId: uuid,
  status: z.string().optional().transform((value, context) => {
    const statuses = value?.split(',').filter(Boolean) ?? ['WAITING', 'IN_PROGRESS', 'COMPLETED'];
    const allowed = new Set(['WAITING', 'IN_PROGRESS', 'COMPLETED', 'SIGNED', 'CANCELLED']);
    if (statuses.some((status) => !allowed.has(status))) { context.addIssue({ code: 'custom', message: 'Trạng thái không hợp lệ.' }); return z.NEVER; }
    return statuses as EncounterStatus[];
  }) }).strict();
const start = z.object({ roomPublicId: uuid.nullable().optional(),
  queueBypassReason: z.string().trim().min(10).max(500).nullable().optional() }).strict();
const notes = z.object({ historyOfPresentIllness: nullableText(10_000), physicalExamination: nullableText(10_000),
  clinicalAssessment: nullableText(10_000), treatmentPlan: nullableText(10_000),
  followUpInstructions: nullableText(10_000), followUpDate: z.iso.date().nullable().optional() }).strict();
const vitals = z.object({ temperatureC: optionalNumber(25, 45), pulseBpm: optionalInteger(10, 300),
  respiratoryRateBpm: optionalInteger(1, 100), systolicBpMmhg: optionalInteger(30, 300),
  diastolicBpMmhg: optionalInteger(20, 200), spo2Percent: optionalNumber(0, 100),
  heightCm: optionalNumber(20, 300), weightKg: optionalNumber(0.2, 500), painScore: optionalInteger(0, 10),
  notes: nullableText(500) }).strict().refine((value) => Object.entries(value).some(([key, item]) => key === 'notes' ? Boolean(item) : item != null),
    'Cần nhập ít nhất một chỉ số.').refine((value) => value.systolicBpMmhg == null || value.diastolicBpMmhg == null
      || value.systolicBpMmhg > value.diastolicBpMmhg, 'Huyết áp tâm thu phải lớn hơn tâm trương.');
const diagnosis = z.object({ code: z.string().trim().min(1).max(30), name: z.string().trim().min(2).max(500),
  type: z.enum(['PROVISIONAL', 'DIFFERENTIAL', 'FINAL']).default('FINAL'), isPrimary: z.boolean().default(false),
  notes: nullableText(1000) }).strict();
const orderService = z.object({ servicePublicId: uuid, quantity: z.number().positive().max(1000).default(1),
  notes: nullableText(1000) }).strict();
function hasMeaningfulResult(value: unknown): boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulResult);
  if (value && typeof value === 'object') return Object.values(value).some(hasMeaningfulResult);
  return false;
}
const finalize = z.object({ summary: nullableText(10_000), conclusion: nullableText(10_000),
  result: z.record(z.string(), z.unknown()).nullable().optional() }).strict()
  .refine((value) => Boolean(value.summary || value.conclusion || hasMeaningfulResult(value.result)),
    'Kết quả FINAL không được để trống.');
const amendment = z.object({ reason: z.string().trim().min(10).max(1000), content: z.string().trim().min(1).max(20_000) }).strict();

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu lâm sàng không hợp lệ.', {
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
function success(response: Response, data: unknown, status = 200) {
  response.status(status).set('Cache-Control', 'no-store').json({ data, meta: {}, requestId: response.locals.requestId });
}

export function createClinicalRouter(auth: PrincipalAuthenticator, service: ClinicalService) {
  const router = Router();
  router.get('/clinical/branches', asyncRoute(async (request, response) => success(response,
    await service.branches(await actor(request, auth), response.locals.requestId))));
  router.get('/encounters', asyncRoute(async (request, response) => {
    const input = validate(listQuery, request.query);
    success(response, await service.list(await actor(request, auth), input.branchPublicId, input.status, response.locals.requestId));
  }));
  router.get('/encounters/:encounterId', asyncRoute(async (request, response) => success(response,
    await service.get(await actor(request, auth), validate(uuid, request.params.encounterId), response.locals.requestId))));
  router.post('/encounters/:encounterId/start', asyncRoute(async (request, response) => {
    const input = validate(start, request.body ?? {}); const encounterId = validate(uuid, request.params.encounterId);
    const current = await actor(request, auth); await service.start(current, encounterId, input.roomPublicId ?? null,
      input.queueBypassReason ?? null, response.locals.requestId);
    success(response, await service.get(current, encounterId, response.locals.requestId));
  }));
  router.patch('/encounters/:encounterId/clinical-notes', asyncRoute(async (request, response) => {
    const input = validate(notes, request.body); const encounterId = validate(uuid, request.params.encounterId);
    const current = await actor(request, auth); await service.updateNotes(current, encounterId, input, response.locals.requestId);
    success(response, await service.get(current, encounterId, response.locals.requestId));
  }));
  router.post('/encounters/:encounterId/vital-signs', asyncRoute(async (request, response) => success(response,
    await service.addVitalSigns(await actor(request, auth), validate(uuid, request.params.encounterId),
      validate(vitals, request.body), response.locals.requestId), 201)));
  router.post('/encounters/:encounterId/diagnoses', asyncRoute(async (request, response) => success(response,
    await service.addDiagnosis(await actor(request, auth), validate(uuid, request.params.encounterId),
      validate(diagnosis, request.body), response.locals.requestId), 201)));
  router.post('/encounters/:encounterId/services', asyncRoute(async (request, response) => success(response,
    await service.orderService(await actor(request, auth), validate(uuid, request.params.encounterId),
      validate(orderService, request.body), response.locals.requestId), 201)));
  router.post('/clinical/services/:serviceId/results/finalize', asyncRoute(async (request, response) => success(response,
    await service.finalizeResult(await actor(request, auth), validate(uuid, request.params.serviceId),
      validate(finalize, request.body), response.locals.requestId), 201)));
  router.post('/encounters/:encounterId/complete', asyncRoute(async (request, response) => {
    const encounterId = validate(uuid, request.params.encounterId); const current = await actor(request, auth);
    await service.complete(current, encounterId, response.locals.requestId);
    success(response, await service.get(current, encounterId, response.locals.requestId));
  }));
  router.post('/encounters/:encounterId/sign', asyncRoute(async (request, response) => success(response,
    await service.sign(await actor(request, auth), validate(uuid, request.params.encounterId), response.locals.requestId))));
  router.post('/encounters/:encounterId/release-to-patient', asyncRoute(async (request, response) => {
    const encounterId = validate(uuid, request.params.encounterId); const current = await actor(request, auth);
    await service.releaseToPatient(current, encounterId, response.locals.requestId);
    success(response, await service.get(current, encounterId, response.locals.requestId));
  }));
  router.post('/encounters/:encounterId/amendments', asyncRoute(async (request, response) => success(response,
    await service.amend(await actor(request, auth), validate(uuid, request.params.encounterId),
      validate(amendment, request.body), response.locals.requestId), 201)));
  router.get('/patient/clinical-records', asyncRoute(async (request, response) => {
    const patientPublicId = validate(uuid, request.query.patientPublicId);
    success(response, await service.patientHistory(await actor(request, auth), patientPublicId, response.locals.requestId));
  }));
  router.get('/patient/clinical-records/:encounterId', asyncRoute(async (request, response) => {
    const patientPublicId = validate(uuid, request.query.patientPublicId);
    success(response, await service.patientRecord(await actor(request, auth), patientPublicId,
      validate(uuid, request.params.encounterId), response.locals.requestId));
  }));
  return router;
}
