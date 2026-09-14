import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: new URL('../../../../.env', import.meta.url) });

const booleanString = z.string().default('false').transform((value) => value === 'true');
const webhookUrl = z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional());
const optionalSecret = z.preprocess((value) => value === '' ? undefined : value, z.string().min(16).optional());
const optionalCredential = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  SCHEDULER_WORKER_PORT: z.coerce.number().int().positive().default(4010),
  WORKER_ID: z.string().uuid().default(() => randomUUID()),
  APPOINTMENT_HOLD_SWEEP_MS: z.coerce.number().int().min(10_000).default(60_000),
  SLOT_GENERATION_SWEEP_MS: z.coerce.number().int().min(60_000).default(21_600_000),
  APPOINTMENT_REMINDER_SWEEP_MS: z.coerce.number().int().min(10_000).default(300_000),
  APPOINTMENT_REMINDER_LEAD_MINUTES: z.coerce.number().int().min(15).max(10_080).default(1_440),
  OUTBOX_POLL_MS: z.coerce.number().int().min(1_000).default(5_000),
  NOTIFICATION_POLL_MS: z.coerce.number().int().min(1_000).default(5_000),
  DELIVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  DELIVERY_LEASE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(2).max(20).default(5),
  DELIVERY_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(3_600).default(15),
  DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(8_000),
  OUTBOX_PUBLISH_MODE: z.enum(['console', 'webhook']).default('console'),
  OUTBOX_WEBHOOK_URL: webhookUrl,
  OUTBOX_WEBHOOK_BEARER_TOKEN: optionalSecret,
  NOTIFICATION_DELIVERY_MODE: z.enum(['console', 'webhook']).default('console'),
  NOTIFICATION_WEBHOOK_URL: webhookUrl,
  NOTIFICATION_WEBHOOK_BEARER_TOKEN: optionalSecret,
  SQL_SERVER: z.string().default('localhost'),
  SQL_PORT: z.coerce.number().int().positive().default(1433),
  SQL_DATABASE: z.string().default('PrivateClinicManagement'),
  SQL_TRUSTED_CONNECTION: z.string().default('true').transform((value) => value === 'true'),
  SQL_ENCRYPT: booleanString,
  SQL_TRUST_SERVER_CERTIFICATE: z.string().default('true').transform((value) => value === 'true'),
  SQL_ODBC_DRIVER: z.string().default('ODBC Driver 18 for SQL Server'),
  SQL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  SQL_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  SQL_WORKER_USER: optionalCredential,
  SQL_WORKER_PASSWORD: optionalCredential,
}).superRefine((value, context) => {
  if (!value.SQL_TRUSTED_CONNECTION && (!value.SQL_WORKER_USER || !value.SQL_WORKER_PASSWORD)) {
    context.addIssue({ code: 'custom', message: 'SQL_WORKER_USER and SQL_WORKER_PASSWORD are required for SQL authentication.' });
  }
  for (const [mode, url, token, label] of [
    [value.OUTBOX_PUBLISH_MODE, value.OUTBOX_WEBHOOK_URL, value.OUTBOX_WEBHOOK_BEARER_TOKEN, 'OUTBOX'],
    [value.NOTIFICATION_DELIVERY_MODE, value.NOTIFICATION_WEBHOOK_URL, value.NOTIFICATION_WEBHOOK_BEARER_TOKEN, 'NOTIFICATION'],
  ] as const) {
    if (mode === 'webhook' && !url) {
      context.addIssue({ code: 'custom', message: `${label}_WEBHOOK_URL is required in webhook mode.` });
    }
    if (value.NODE_ENV === 'production' && mode === 'console') {
      context.addIssue({ code: 'custom', message: `${label} console mode is development-only.` });
    }
    if (value.NODE_ENV === 'production' && mode === 'webhook' && (!token || !url?.startsWith('https://'))) {
      context.addIssue({ code: 'custom', message: `${label} production webhook requires HTTPS and a bearer token.` });
    }
  }
});

export function parseWorkerEnvironment(source: NodeJS.ProcessEnv): z.infer<typeof schema> {
  return schema.parse(source);
}

export const env = parseWorkerEnvironment(process.env);
export type WorkerEnvironment = z.infer<typeof schema>;
