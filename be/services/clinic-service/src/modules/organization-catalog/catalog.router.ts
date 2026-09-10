import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import type { PrincipalAuthenticator } from '../identity/index.js';
import { roomTypes, serviceTypes } from './catalog.types.js';
import { CatalogService } from './catalog.service.js';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.string().regex(/^(0|[1-9]\d{0,16})(\.\d{1,2})?$/);
const publicServiceQuery = z.object({
  branchPublicId: uuid,
  specialtyPublicId: uuid.optional(),
  query: z.string().trim().max(100).optional(),
});
const publicDoctorQuery = z.object({
  branchPublicId: uuid.optional(), specialtyPublicId: uuid.optional(),
  servicePublicId: uuid.optional(), query: z.string().trim().max(100).optional(),
});
const branchQuery = z.object({ branchPublicId: uuid });
const createRoomSchema = z.object({
  branchPublicId: uuid, code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(2).max(150), type: z.enum(roomTypes),
  floorNo: z.number().int().min(-5).max(200).optional(),
  capacity: z.number().int().min(1).max(500).default(1),
}).strict();
const updateRoomSchema = createRoomSchema.omit({ branchPublicId: true, code: true }).extend({ isActive: z.boolean() }).strict();
const createServiceSchema = z.object({
  categoryPublicId: uuid, specialtyPublicId: uuid.optional(),
  code: z.string().trim().min(1).max(30), name: z.string().trim().min(2).max(200),
  type: z.enum(serviceTypes), durationMinutes: z.number().int().min(5).max(480),
  basePrice: money, requiresDoctor: z.boolean().default(true),
}).strict();
const updateServiceSchema = createServiceSchema.omit({ code: true }).extend({ isActive: z.boolean() }).strict();
const setPriceSchema = z.object({
  branchPublicId: uuid, amount: money, effectiveFrom: dateOnly, isAvailable: z.boolean(),
}).strict();
const etagPattern = /^"([A-Za-z0-9+/]{11}=)"$/;

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

async function actor(request: Request, auth: PrincipalAuthenticator) {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new HttpError(401, 'ACCESS_TOKEN_REQUIRED', 'Yêu cầu access token.');
  }
  return auth.authenticate(authorization.slice(7));
}

function version(request: Request) {
  const value = request.header('if-match');
  if (!value) throw new HttpError(428, 'PRECONDITION_REQUIRED', 'Cập nhật danh mục yêu cầu header If-Match.');
  const match = etagPattern.exec(value);
  if (!match) throw new HttpError(400, 'INVALID_IF_MATCH', 'Header If-Match không đúng định dạng row version.');
  return match[1]!;
}

function success(response: Response, data: unknown, meta: Record<string, unknown> = {}) {
  response.json({ data, meta, requestId: response.locals.requestId });
}

function setEtag(response: Response, item: { rowVersion: string }) {
  response.set('etag', `"${item.rowVersion}"`);
}

export function createPublicCatalogRouter(catalog: CatalogService) {
  const router = Router();
  router.get('/branches', asyncRoute(async (_request, response) => success(response, await catalog.publicBranches())));
  router.get('/specialties', asyncRoute(async (_request, response) => success(response, await catalog.publicSpecialties())));
  router.get('/services', asyncRoute(async (request, response) => {
    const query = validate(publicServiceQuery, request.query);
    success(response, await catalog.publicServices(query.branchPublicId, query.specialtyPublicId, query.query));
  }));
  router.get('/doctors', asyncRoute(async (request, response) => {
    const query = validate(publicDoctorQuery, request.query);
    success(response, await catalog.publicDoctors(
      query.branchPublicId, query.specialtyPublicId, query.servicePublicId, query.query,
    ));
  }));
  return router;
}

export function createAdminCatalogRouter(auth: PrincipalAuthenticator, catalog: CatalogService) {
  const router = Router();
  router.get('/reference-data', asyncRoute(async (request, response) => {
    success(response, await catalog.references(await actor(request, auth)));
  }));
  router.get('/rooms', asyncRoute(async (request, response) => {
    const query = validate(branchQuery, request.query);
    success(response, await catalog.rooms(await actor(request, auth), query.branchPublicId));
  }));
  router.post('/rooms', asyncRoute(async (request, response) => {
    const created = await catalog.createRoom(
      await actor(request, auth), validate(createRoomSchema, request.body), response.locals.requestId,
    );
    response.status(201); setEtag(response, created); success(response, created);
  }));
  router.put('/rooms/:roomId', asyncRoute(async (request, response) => {
    const updated = await catalog.updateRoom(
      await actor(request, auth), validate(uuid, request.params.roomId),
      validate(updateRoomSchema, request.body), version(request), response.locals.requestId,
    );
    setEtag(response, updated); success(response, updated);
  }));
  router.get('/services', asyncRoute(async (request, response) => {
    const query = validate(branchQuery, request.query);
    success(response, await catalog.services(await actor(request, auth), query.branchPublicId));
  }));
  router.post('/services', asyncRoute(async (request, response) => {
    const query = validate(branchQuery, request.query);
    const created = await catalog.createService(
      await actor(request, auth), query.branchPublicId,
      validate(createServiceSchema, request.body), response.locals.requestId,
    );
    response.status(201); setEtag(response, created); success(response, created);
  }));
  router.put('/services/:serviceId', asyncRoute(async (request, response) => {
    const query = validate(branchQuery, request.query);
    const updated = await catalog.updateService(
      await actor(request, auth), validate(uuid, request.params.serviceId), query.branchPublicId,
      validate(updateServiceSchema, request.body), version(request), response.locals.requestId,
    );
    setEtag(response, updated); success(response, updated);
  }));
  router.post('/services/:serviceId/prices', asyncRoute(async (request, response) => {
    const updated = await catalog.setBranchPrice(
      await actor(request, auth), validate(uuid, request.params.serviceId),
      validate(setPriceSchema, request.body), response.locals.requestId,
    );
    response.status(201); setEtag(response, updated); success(response, updated);
  }));
  return router;
}
