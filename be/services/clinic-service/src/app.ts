import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config.js';
import { probeDatabase } from './infrastructure/database/sql-database.js';
import { JwtPrincipalAuthenticator, SqlPrincipalRepository, type PrincipalAuthenticator } from './modules/identity/index.js';
import {
  CatalogService, createAdminCatalogRouter, createPublicCatalogRouter, SqlCatalogRepository,
} from './modules/organization-catalog/index.js';
import { errorHandler, HttpError, notFoundHandler } from './shared/http/errors.js';
import { requestContext } from './shared/http/request-context.js';

export type DatabaseProbe = () => Promise<{ database: string }>;
export type AppDependencies = {
  databaseProbe?: DatabaseProbe;
  principalAuthenticator?: PrincipalAuthenticator;
  catalogService?: CatalogService;
};

export function createApp(dependencies: AppDependencies | DatabaseProbe = {}) {
  const app = express();
  const resolved = typeof dependencies === 'function' ? { databaseProbe: dependencies } : dependencies;
  const databaseProbe = resolved.databaseProbe ?? probeDatabase;
  const principalAuthenticator = resolved.principalAuthenticator
    ?? new JwtPrincipalAuthenticator(new SqlPrincipalRepository());
  const catalogService = resolved.catalogService ?? new CatalogService(new SqlCatalogRepository());

  app.disable('x-powered-by');
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
      callback(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origin không được phép truy cập Clinic Service.'));
    },
    credentials: true,
    exposedHeaders: ['x-request-id', 'etag'],
  }));
  app.use(express.json({ limit: '2mb' }));

  app.get(['/health/live', '/api/v1/health/live'], (_request, response) => {
    response.json({
      data: { status: 'ok', service: 'clinic-service' },
      meta: {},
      requestId: response.locals.requestId,
    });
  });

  app.get(['/health/ready', '/api/v1/health/ready'], async (_request, response, next) => {
    try {
      const database = await databaseProbe();
      response.json({
        data: {
          status: 'ready',
          service: 'clinic-service',
          dependencies: { sqlServer: { status: 'up', database: database.database } },
        },
        meta: {},
        requestId: response.locals.requestId,
      });
    } catch {
      next(new HttpError(503, 'DATABASE_UNAVAILABLE', 'Clinic Service chưa kết nối được SQL Server.'));
    }
  });

  app.use('/api/v1/public', createPublicCatalogRouter(catalogService));
  app.use('/api/v1/admin/catalog', createAdminCatalogRouter(principalAuthenticator, catalogService));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
