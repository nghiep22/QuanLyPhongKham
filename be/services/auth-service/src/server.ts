import pino from 'pino';
import { createApp } from './app.js';
import { env } from './config.js';

const logger = pino({ level: env.LOG_LEVEL });
const server = createApp().listen(env.AUTH_SERVICE_PORT, () => {
  logger.info({ port: env.AUTH_SERVICE_PORT }, 'auth-service started');
});

function shutdown(signal: string) {
  logger.info({ signal }, 'auth-service stopping');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
