import { createServer } from 'node:http';
import dotenv from 'dotenv';
import pino from 'pino';
import { z } from 'zod';

dotenv.config({ path: new URL('../../../../.env', import.meta.url) });

const env = z.object({
  LOG_LEVEL: z.string().default('info'),
  SCHEDULER_WORKER_PORT: z.coerce.number().int().positive().default(4010),
}).parse(process.env);

const logger = pino({ level: env.LOG_LEVEL });
const server = createServer((request, response) => {
  if (request.url === '/health/live' || request.url === '/health/ready') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok', service: 'scheduler-worker' }));
    return;
  }
  response.writeHead(404).end();
});

server.listen(env.SCHEDULER_WORKER_PORT, () => {
  logger.info({ port: env.SCHEDULER_WORKER_PORT }, 'scheduler-worker started; jobs are not enabled yet');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'scheduler-worker stopping');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
