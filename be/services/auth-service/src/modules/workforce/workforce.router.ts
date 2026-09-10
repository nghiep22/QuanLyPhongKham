import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../../shared/http/errors.js';
import { AuthService } from '../auth/auth.service.js';
import { employeeTypes } from './workforce.types.js';
import { WorkforceService } from './workforce.service.js';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const employeeType = z.enum(employeeTypes);
const accountStatus = z.enum(['ACTIVE', 'LOCKED', 'DISABLED', 'PENDING']);
const employmentStatus = z.enum(['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED']);
const gender = z.enum(['MALE', 'FEMALE', 'OTHER']);
const rowVersion = '[A-Za-z0-9+/]{11}=';
const etagPattern = new RegExp(`^"(${rowVersion})(?::(${rowVersion}))?"$`);

const listSchema = z.object({
  query: z.string().trim().max(100).optional(),
  branchPublicId: uuid.optional(),
  employeeType: employeeType.optional(),
  accountStatus: accountStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const createBaseSchema = z.object({
  branchPublicId: uuid,
  username: z.string().trim().min(3).max(80),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(8).max(20).optional(),
  temporaryPassword: z.string().min(12).max(200),
  employeeCode: z.string().trim().min(2).max(30),
  employeeType,
  fullName: z.string().trim().min(2).max(200),
  dateOfBirth: dateOnly.optional(),
  gender: gender.optional(),
  addressLine: optionalText(300),
  hireDate: dateOnly,
  medicalLicenseNo: optionalText(100),
  licenseIssuedDate: dateOnly.optional(),
  licenseExpiryDate: dateOnly.optional(),
  academicTitle: optionalText(100),
  biography: optionalText(4000),
  defaultSlotMinutes: z.number().int().min(5).max(240).optional(),
  acceptsOnlineBooking: z.boolean().optional(),
  specialtyPublicId: uuid.optional(),
}).strict();
const createSchema = createBaseSchema.superRefine((value, context) => {
  if (value.employeeType === 'DOCTOR' && !value.medicalLicenseNo) {
    context.addIssue({ code: 'custom', path: ['medicalLicenseNo'], message: 'Bác sĩ phải có số chứng chỉ hành nghề.' });
  }
});
const updateSchema = createBaseSchema.omit({
  branchPublicId: true, username: true, temporaryPassword: true,
  employeeCode: true, employeeType: true, specialtyPublicId: true,
}).safeExtend({
  employmentStatus,
  terminationDate: dateOnly.optional(),
}).superRefine((value, context) => {
  if (value.employmentStatus === 'TERMINATED' && !value.terminationDate) {
    context.addIssue({ code: 'custom', path: ['terminationDate'], message: 'Nhân viên nghỉ việc phải có ngày nghỉ.' });
  }
});
const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
  reason: z.string().trim().min(3).max(500),
}).strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const grantRoleSchema = z.object({
  roleCode: z.string().trim().min(2).max(50),
  branchPublicId: uuid.optional(),
  validToUtc: z.string().datetime({ offset: true }).optional(),
}).strict();

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

function parseIfMatch(request: Request) {
  const value = request.header('if-match');
  if (!value) {
    throw new HttpError(428, 'PRECONDITION_REQUIRED', 'Cập nhật hồ sơ yêu cầu header If-Match.');
  }
  const match = etagPattern.exec(value);
  if (!match) {
    throw new HttpError(400, 'INVALID_IF_MATCH', 'Header If-Match không đúng định dạng row version.');
  }
  return { employeeRowVersion: match[1]!, doctorRowVersion: match[2] };
}

function setStaffEtag(response: Response, staff: { rowVersion: string; doctor: { rowVersion: string } | null }) {
  response.set('etag', `"${staff.rowVersion}${staff.doctor ? `:${staff.doctor.rowVersion}` : ''}"`);
}

export function createWorkforceRouter(auth: AuthService, workforce: WorkforceService) {
  const router = Router();

  router.get('/staff/reference-data', asyncRoute(async (request, response) => {
    success(response, await workforce.references(await actor(request, auth)));
  }));
  router.get('/staff', asyncRoute(async (request, response) => {
    const query = validate(listSchema, request.query);
    const result = await workforce.list(await actor(request, auth), query);
    success(response, result.items, { page: query.page, pageSize: query.pageSize, total: result.total });
  }));
  router.post('/staff', asyncRoute(async (request, response) => {
    const created = await workforce.create(
      await actor(request, auth), validate(createSchema, request.body), response.locals.requestId,
    );
    response.status(201);
    success(response, created);
  }));
  router.get('/staff/:staffId', asyncRoute(async (request, response) => {
    const staff = await workforce.get(await actor(request, auth), validate(uuid, request.params.staffId));
    setStaffEtag(response, staff);
    success(response, staff);
  }));
  router.put('/staff/:staffId', asyncRoute(async (request, response) => {
    const staff = await workforce.update(
      await actor(request, auth), validate(uuid, request.params.staffId),
      validate(updateSchema, request.body), parseIfMatch(request), response.locals.requestId,
    );
    setStaffEtag(response, staff);
    success(response, staff);
  }));
  router.put('/users/:userId/status', asyncRoute(async (request, response) => {
    const body = validate(statusSchema, request.body);
    success(response, await workforce.setAccountStatus(
      await actor(request, auth), validate(uuid, request.params.userId),
      body.status, body.reason, response.locals.requestId,
    ));
  }));
  router.post('/users/:userId/unlock', asyncRoute(async (request, response) => {
    const body = validate(reasonSchema, request.body);
    success(response, await workforce.unlock(
      await actor(request, auth), validate(uuid, request.params.userId),
      body.reason, response.locals.requestId,
    ));
  }));
  router.post('/users/:userId/roles', asyncRoute(async (request, response) => {
    const body = validate(grantRoleSchema, request.body);
    success(response, await workforce.grantRole(
      await actor(request, auth), validate(uuid, request.params.userId),
      body.roleCode, body.branchPublicId, body.validToUtc, response.locals.requestId,
    ));
  }));
  router.delete('/users/:userId/roles/:assignmentId', asyncRoute(async (request, response) => {
    const body = validate(reasonSchema, request.body);
    success(response, await workforce.revokeRole(
      await actor(request, auth), validate(uuid, request.params.userId),
      validate(uuid, request.params.assignmentId), body.reason, response.locals.requestId,
    ));
  }));
  return router;
}
