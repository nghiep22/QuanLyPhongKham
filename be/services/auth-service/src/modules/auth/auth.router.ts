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

export function createAuthRouter(auth: AuthService) {
  const router = Router();

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
    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new HttpError(401, 'ACCESS_TOKEN_REQUIRED', 'Yêu cầu access token.');
    }
    const principal = await auth.authenticate(authorization.slice(7));
    await auth.logoutAll(principal.userId, response.locals.requestId);
    clearRefreshCookie(response);
    success(response, { loggedOut: true, allDevices: true });
  }));

  return router;
}
