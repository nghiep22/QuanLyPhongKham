import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { probeDatabase } from './infrastructure/database/sql-database.js';
import { errorHandler, HttpError, notFoundHandler } from './shared/http/errors.js';
import { requestContext } from './shared/http/request-context.js';

export type DatabaseProbe = () => Promise<{ database: string }>;

export function createApp(databaseProbe: DatabaseProbe = probeDatabase) {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(pinoHttp({
    genReqId: (request) => request.headers['x-request-id']!.toString(),
    autoLogging: process.env.NODE_ENV !== 'test',
  }));
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true, exposedHeaders: ['x-request-id'] }));
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

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
