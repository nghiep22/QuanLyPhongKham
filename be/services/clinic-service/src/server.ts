import pino from 'pino';
import { createApp } from './app.js';
import { env } from './config.js';
import { closeSqlPool } from './infrastructure/database/sql-database.js';

const logger = pino({ level: env.LOG_LEVEL });
const server = createApp().listen(env.CLINIC_SERVICE_PORT, () => {
  logger.info({ port: env.CLINIC_SERVICE_PORT }, 'clinic-service started');
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'clinic-service stopping');
  server.close(async () => {
    await closeSqlPool();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
