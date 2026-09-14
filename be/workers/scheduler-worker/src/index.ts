import { createServer } from 'node:http';
import pino from 'pino';
import { BackgroundJobs } from './background-jobs.js';
import { env } from './config.js';
import {
  createConsoleNotificationProvider,
  createConsoleOutboxPublisher,
  createWebhookNotificationProvider,
  createWebhookOutboxPublisher,
} from './delivery.js';
import { SqlWorkerRepository } from './sql-worker.repository.js';

const logger = pino({ level: env.LOG_LEVEL });
const repository = new SqlWorkerRepository(env);
const webhookOptions = (url: string, bearerToken: string | undefined) => ({
  url,
  bearerToken,
  timeoutMs: env.DELIVERY_TIMEOUT_MS,
});
const outboxPublisher = env.OUTBOX_PUBLISH_MODE === 'webhook'
  ? createWebhookOutboxPublisher(webhookOptions(env.OUTBOX_WEBHOOK_URL!, env.OUTBOX_WEBHOOK_BEARER_TOKEN))
  : createConsoleOutboxPublisher(logger);
const notificationProvider = env.NOTIFICATION_DELIVERY_MODE === 'webhook'
  ? createWebhookNotificationProvider(webhookOptions(env.NOTIFICATION_WEBHOOK_URL!, env.NOTIFICATION_WEBHOOK_BEARER_TOKEN))
  : createConsoleNotificationProvider(logger);
const jobs = new BackgroundJobs(repository, outboxPublisher, notificationProvider, logger, {
  workerId: env.WORKER_ID,
  reminderLeadMinutes: env.APPOINTMENT_REMINDER_LEAD_MINUTES,
  batchSize: env.DELIVERY_BATCH_SIZE,
  leaseSeconds: env.DELIVERY_LEASE_SECONDS,
  maxAttempts: env.DELIVERY_MAX_ATTEMPTS,
  retryBaseSeconds: env.DELIVERY_RETRY_BASE_SECONDS,
});

const server = createServer((request, response) => {
  if (request.url === '/health/live') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ status: 'ok', service: 'scheduler-worker' }));
    return;
  }
  if (request.url === '/health/ready') {
    void repository.ready().then(() => {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ready', service: 'scheduler-worker' }));
    }).catch(() => {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'unavailable', service: 'scheduler-worker' }));
    });
    return;
  }
  response.writeHead(404).end();
});

const timers = [
  setInterval(() => void jobs.expireAppointmentHolds(), env.APPOINTMENT_HOLD_SWEEP_MS),
  setInterval(() => void jobs.generateDoctorSlots(), env.SLOT_GENERATION_SWEEP_MS),
  setInterval(() => void jobs.scheduleAppointmentReminders(), env.APPOINTMENT_REMINDER_SWEEP_MS),
  setInterval(() => void jobs.publishOutbox(), env.OUTBOX_POLL_MS),
  setInterval(() => void jobs.deliverNotifications(), env.NOTIFICATION_POLL_MS),
];
timers.forEach((timer) => timer.unref());

server.listen(env.SCHEDULER_WORKER_PORT, () => {
  logger.info({ port: env.SCHEDULER_WORKER_PORT, workerId: env.WORKER_ID }, 'scheduler-worker started');
  void jobs.expireAppointmentHolds();
  void jobs.generateDoctorSlots();
  void jobs.scheduleAppointmentReminders();
  void jobs.publishOutbox();
  void jobs.deliverNotifications();
});

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'scheduler-worker stopping');
  timers.forEach((timer) => clearInterval(timer));
  server.close(() => {
    void repository.close().finally(() => process.exit(0));
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
