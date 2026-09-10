import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ genReqId: (request) => request.headers['x-request-id']?.toString() ?? randomUUID() }));

  app.get('/health/live', (_request, response) => {
    response.json({ status: 'ok', service: 'clinic-service' });
  });

  app.get('/health/ready', (_request, response) => {
    response.json({ status: 'ready', service: 'clinic-service' });
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Không tìm thấy API được yêu cầu.' },
    });
  });

  return app;
}
