import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import type { PrincipalAuthenticator } from '../identity/index.js';
import { ReportsService } from './reports.service.js';

const query = z.object({ branchPublicId: z.string().uuid(), from: z.iso.date(), to: z.iso.date() }).strict()
  .refine((value) => value.from <= value.to, { path: ['to'], message: 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' });
function validate(value: unknown) {
  const parsed = query.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Bộ lọc báo cáo không hợp lệ.', {
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
function success(response: Response, data: unknown) {
  response.set('Cache-Control', 'private, no-store').json({ data, meta: {}, requestId: response.locals.requestId });
}

export function createReportsRouter(auth: PrincipalAuthenticator, service: ReportsService) {
  const router = Router(); const repository = service.repository;
  router.get('/reports/branches', route(async (request, response) => {
    const current = await actor(request, auth);
    success(response, await service.run(() => repository.branches(current, response.locals.requestId)));
  }));
  router.get('/reports/operations', route(async (request, response) => {
    const filter = validate(request.query); const current = await actor(request, auth);
    success(response, await service.run(() => repository.operations(current, filter.branchPublicId,
      { from: filter.from, to: filter.to }, response.locals.requestId)));
  }));
  router.get('/reports/revenue', route(async (request, response) => {
    const filter = validate(request.query); const current = await actor(request, auth);
    success(response, await service.run(() => repository.revenue(current, filter.branchPublicId,
      { from: filter.from, to: filter.to }, response.locals.requestId)));
  }));
  router.get('/reports/inventory', route(async (request, response) => {
    const filter = validate(request.query); const current = await actor(request, auth);
    success(response, await service.run(() => repository.inventory(current, filter.branchPublicId,
      { from: filter.from, to: filter.to }, response.locals.requestId)));
  }));
  return router;
}
