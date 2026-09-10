import pino from 'pino';
import { createApp } from './app.js';
import { env } from './config.js';

const logger = pino({ level: env.LOG_LEVEL });
const server = createApp().listen(env.CLINIC_SERVICE_PORT, () => {
  logger.info({ port: env.CLINIC_SERVICE_PORT }, 'clinic-service started');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'clinic-service stopping');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
