import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config.js';
import { probeDatabase } from './infrastructure/database/sql-database.js';
import { AuthService, createAuthRouter, SqlAuthRepository } from './modules/auth/index.js';
import { errorHandler, HttpError, notFoundHandler } from './shared/http/errors.js';
import { requestContext } from './shared/http/request-context.js';

export type DatabaseProbe = () => Promise<{ database: string }>;
export type AppDependencies = {
  databaseProbe?: DatabaseProbe;
  authService?: AuthService;
};

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const databaseProbe = dependencies.databaseProbe ?? probeDatabase;
  const authService = dependencies.authService ?? new AuthService(new SqlAuthRepository());

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(requestContext);
  app.use(pinoHttp({
    genReqId: (request) => request.headers['x-request-id']!.toString(),
    autoLogging: process.env.NODE_ENV !== 'test',
  }));
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || env.WEB_ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origin không được phép truy cập Auth Service.'));
    },
    credentials: true,
    exposedHeaders: ['x-request-id'],
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get(['/health/live', '/api/v1/auth/health/live'], (_request, response) => {
    response.json({
      data: { status: 'ok', service: 'auth-service' },
      meta: {},
      requestId: response.locals.requestId,
    });
  });

  app.get(['/health/ready', '/api/v1/auth/health/ready'], async (_request, response, next) => {
    try {
      const database = await databaseProbe();
      response.json({
        data: {
          status: 'ready',
          service: 'auth-service',
          dependencies: { sqlServer: { status: 'up', database: database.database } },
        },
        meta: {},
        requestId: response.locals.requestId,
      });
    } catch {
      next(new HttpError(503, 'DATABASE_UNAVAILABLE', 'Auth Service chưa kết nối được SQL Server.'));
    }
  });

  app.get('/.well-known/jwks.json', async (_request, response, next) => {
    try {
      response.json(await authService.getJwks());
    } catch (error) {
      next(error);
    }
  });
  app.use('/api/v1/auth', createAuthRouter(authService));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
