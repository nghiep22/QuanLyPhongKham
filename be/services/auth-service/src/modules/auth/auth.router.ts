import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config.js';
import { HttpError } from '../../shared/http/errors.js';
import { AuthService } from './auth.service.js';

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(8).max(200),
  clientType: z.enum(['web', 'mobile']).default('web'),
}).strict();
const refreshSchema = z.object({ refreshToken: z.string().optional() }).strict();
const strongPassword = z.string().min(12).max(200)
  .regex(/[a-z]/, 'Mật khẩu cần chữ thường.')
  .regex(/[A-Z]/, 'Mật khẩu cần chữ hoa.')
  .regex(/[0-9]/, 'Mật khẩu cần chữ số.');
const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: strongPassword,
}).strict();
const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(3).max(254) }).strict();
const resetPasswordSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  newPassword: strongPassword,
}).strict();
const dateOfBirth = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && value >= '1900-01-01'
    && value <= new Date().toISOString().slice(0, 10);
}, 'Ngày sinh không hợp lệ.');
const patientRegistrationSchema = z.object({
  contactChannel: z.enum(['EMAIL', 'SMS']),
  contact: z.string().trim().min(3).max(254),
  password: strongPassword,
  fullName: z.string().trim().min(2).max(200),
  dateOfBirth,
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
}).strict().superRefine((value, context) => {
  if (value.contactChannel === 'EMAIL' && !z.email().safeParse(value.contact).success) {
    context.addIssue({ code: 'custom', path: ['contact'], message: 'Email không hợp lệ.' });
  }
  const phone = value.contact.replace(/[ .-]/g, '');
  if (value.contactChannel === 'SMS' && !/^\+?[0-9]{9,15}$/.test(phone)) {
    context.addIssue({ code: 'custom', path: ['contact'], message: 'Số điện thoại không hợp lệ.' });
  }
});
const verifyPatientRegistrationSchema = z.object({
  challengeId: z.uuid(),
  otp: z.string().regex(/^\d{6}$/),
}).strict();

function asyncRoute(handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response, next).catch(next);
}

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Dữ liệu gửi lên không hợp lệ.', {
      fields: result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
    });
  }
  return result.data;
}

function metadata(request: Request) {
  return {
    deviceInfo: request.header('user-agent')?.slice(0, 500),
    ipAddress: request.ip?.replace(/^::ffff:/, '').slice(0, 45),
  };
}

function setRefreshCookie(response: Response, refreshToken: string) {
  response.cookie(env.JWT_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.JWT_COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(response: Response) {
  response.clearCookie(env.JWT_COOKIE_NAME, {
    httpOnly: true,
    secure: env.JWT_COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/v1/auth',
  });
}

function success(response: Response, data: unknown) {
  response.json({ data, meta: {}, requestId: response.locals.requestId });
}

async function authenticate(request: Request, auth: AuthService) {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new HttpError(401, 'ACCESS_TOKEN_REQUIRED', 'Yêu cầu access token.');
  }
  return auth.authenticate(authorization.slice(7));
}

export function createAuthRouter(auth: AuthService) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set('cache-control', 'no-store');
    next();
  });

  router.post('/login', asyncRoute(async (request, response) => {
    const input = validate(loginSchema, request.body);
    const result = await auth.login({ ...input, ...metadata(request) }, response.locals.requestId);
    if (input.clientType === 'web') setRefreshCookie(response, result.refreshToken);
    success(response, {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      ...(input.clientType === 'mobile' ? { refreshToken: result.refreshToken } : {}),
      user: result.principal,
    });
  }));

  router.post('/refresh', asyncRoute(async (request, response) => {
    const body = validate(refreshSchema, request.body ?? {});
    const refreshToken = body.refreshToken ?? request.cookies[env.JWT_COOKIE_NAME];
    if (!refreshToken) throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Không tìm thấy refresh token.');
    try {
      const result = await auth.refresh(refreshToken, metadata(request), response.locals.requestId);
      if (!body.refreshToken) setRefreshCookie(response, result.refreshToken);
      success(response, {
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        ...(body.refreshToken ? { refreshToken: result.refreshToken } : {}),
        user: result.principal,
      });
    } catch (error) {
      clearRefreshCookie(response);
      throw error;
    }
  }));

  router.post('/logout', asyncRoute(async (request, response) => {
    const body = validate(refreshSchema, request.body ?? {});
    const refreshToken = body.refreshToken ?? request.cookies[env.JWT_COOKIE_NAME];
    await auth.logout(refreshToken, response.locals.requestId);
    clearRefreshCookie(response);
    success(response, { loggedOut: true });
  }));

  router.post('/logout-all', asyncRoute(async (request, response) => {
    const principal = await authenticate(request, auth);
    await auth.logoutAll(principal.userId, response.locals.requestId);
    clearRefreshCookie(response);
    success(response, { loggedOut: true, allDevices: true });
  }));

  router.post('/password/change', asyncRoute(async (request, response) => {
    const principal = await authenticate(request, auth);
    const body = validate(changePasswordSchema, request.body);
    await auth.changePassword(principal.userId, body.currentPassword, body.newPassword, response.locals.requestId);
    clearRefreshCookie(response);
    success(response, { passwordChanged: true, allSessionsRevoked: true });
  }));

  router.post('/password/forgot', asyncRoute(async (request, response) => {
    const body = validate(forgotPasswordSchema, request.body);
    await auth.requestPasswordReset(body.identifier, metadata(request).ipAddress, response.locals.requestId);
    response.status(202);
    success(response, { accepted: true });
  }));

  router.post('/password/reset', asyncRoute(async (request, response) => {
    const body = validate(resetPasswordSchema, request.body);
    await auth.resetPassword(body.token, body.newPassword, response.locals.requestId);
    clearRefreshCookie(response);
    success(response, { passwordChanged: true, allSessionsRevoked: true });
  }));

  router.post('/patient-registration/request', asyncRoute(async (request, response) => {
    const idempotencyKey = request.header('idempotency-key');
    if (!idempotencyKey || !z.uuid().safeParse(idempotencyKey).success) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Yêu cầu Idempotency-Key dạng UUID.');
    }
    const body = validate(patientRegistrationSchema, request.body);
    const result = await auth.requestPatientRegistration(
      body, idempotencyKey, metadata(request).ipAddress, response.locals.requestId,
    );
    response.status(202);
    success(response, result);
  }));

  router.post('/patient-registration/verify', asyncRoute(async (request, response) => {
    const body = validate(verifyPatientRegistrationSchema, request.body);
    const result = await auth.verifyPatientRegistration(body.challengeId, body.otp, response.locals.requestId);
    response.status(201);
    success(response, result);
  }));

  return router;
}
