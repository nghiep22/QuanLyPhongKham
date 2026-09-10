import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: new URL('../../../../.env', import.meta.url) });

const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional());
const optionalSecret = z.preprocess((value) => value === '' ? undefined : value, z.string().min(16).optional());
const developmentOtpSecret = 'development-only-otp-secret-change-me';
const exampleOtpSecret = 'replace-with-at-least-32-random-characters';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  AUTH_SERVICE_PORT: z.coerce.number().int().positive().default(4001),
  WEB_ALLOWED_ORIGINS: z.string().default('http://localhost:5173').transform((value) =>
    value.split(',').map((origin) => origin.trim()).filter(Boolean)),
  LOG_LEVEL: z.string().default('info'),
  SQL_SERVER: z.string().default('localhost'),
  SQL_PORT: z.coerce.number().int().positive().default(1433),
  SQL_DATABASE: z.string().default('PrivateClinicManagement'),
  SQL_TRUSTED_CONNECTION: z.string().default('true').transform((value) => value === 'true'),
  SQL_ENCRYPT: z.string().default('false').transform((value) => value === 'true'),
  SQL_TRUST_SERVER_CERTIFICATE: z.string().default('true').transform((value) => value === 'true'),
  SQL_ODBC_DRIVER: z.string().default('ODBC Driver 18 for SQL Server'),
  SQL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  SQL_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  SQL_USER: z.string().optional(),
  SQL_PASSWORD: z.string().optional(),
  JWT_ISSUER: z.string().min(3).default('private-clinic-auth'),
  JWT_AUDIENCE: z.string().min(3).default('private-clinic-api'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  JWT_COOKIE_NAME: z.string().default('clinic_refresh_token'),
  JWT_COOKIE_SECURE: z.string().default('false').transform((value) => value === 'true'),
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
  PASSWORD_RESET_MAX_PER_HOUR: z.coerce.number().int().min(1).max(20).default(3),
  PASSWORD_RESET_URL: z.string().url().default('http://localhost:5173/reset-password'),
  PASSWORD_RESET_DELIVERY_MODE: z.enum(['console', 'webhook']).default('console'),
  PASSWORD_RESET_WEBHOOK_URL: optionalUrl,
  PASSWORD_RESET_WEBHOOK_BEARER_TOKEN: optionalSecret,
  PATIENT_REGISTRATION_BRANCH_CODE: z.string().trim().min(1).max(30).default('MAIN'),
  AUTH_OTP_TTL_MINUTES: z.coerce.number().int().min(3).max(30).default(10),
  AUTH_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  AUTH_OTP_MAX_REQUESTS_PER_HOUR: z.coerce.number().int().min(1).max(20).default(3),
  AUTH_OTP_HASH_SECRET: z.string().min(32).default(developmentOtpSecret),
  AUTH_OTP_DELIVERY_MODE: z.enum(['console', 'webhook']).default('console'),
  AUTH_OTP_WEBHOOK_URL: optionalUrl,
  AUTH_OTP_WEBHOOK_BEARER_TOKEN: optionalSecret,
  JWT_PRIVATE_KEY_PATH: z.string().default(fileURLToPath(new URL('../../../../.runtime/auth-private.pem', import.meta.url))),
  JWT_PUBLIC_KEY_PATH: z.string().default(fileURLToPath(new URL('../../../../.runtime/auth-public.pem', import.meta.url))),
}).superRefine((value, context) => {
  if (value.PASSWORD_RESET_DELIVERY_MODE === 'webhook' && !value.PASSWORD_RESET_WEBHOOK_URL) {
    context.addIssue({ code: 'custom', path: ['PASSWORD_RESET_WEBHOOK_URL'], message: 'Webhook URL is required.' });
  }
  if (value.NODE_ENV === 'production' && value.PASSWORD_RESET_DELIVERY_MODE === 'console') {
    context.addIssue({ code: 'custom', path: ['PASSWORD_RESET_DELIVERY_MODE'], message: 'Console recovery delivery is forbidden in production.' });
  }
  if (value.NODE_ENV === 'production' && value.PASSWORD_RESET_DELIVERY_MODE === 'webhook'
    && !value.PASSWORD_RESET_WEBHOOK_BEARER_TOKEN) {
    context.addIssue({ code: 'custom', path: ['PASSWORD_RESET_WEBHOOK_BEARER_TOKEN'], message: 'A webhook bearer token is required in production.' });
  }
  if (value.NODE_ENV === 'production' && new URL(value.PASSWORD_RESET_URL).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['PASSWORD_RESET_URL'], message: 'The production reset URL must use HTTPS.' });
  }
  if (value.NODE_ENV === 'production' && value.PASSWORD_RESET_WEBHOOK_URL
    && new URL(value.PASSWORD_RESET_WEBHOOK_URL).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['PASSWORD_RESET_WEBHOOK_URL'], message: 'The production webhook URL must use HTTPS.' });
  }
  if (value.AUTH_OTP_DELIVERY_MODE === 'webhook' && !value.AUTH_OTP_WEBHOOK_URL) {
    context.addIssue({ code: 'custom', path: ['AUTH_OTP_WEBHOOK_URL'], message: 'OTP webhook URL is required.' });
  }
  if (value.NODE_ENV === 'production' && value.AUTH_OTP_DELIVERY_MODE === 'console') {
    context.addIssue({ code: 'custom', path: ['AUTH_OTP_DELIVERY_MODE'], message: 'Console OTP delivery is forbidden in production.' });
  }
  if (value.NODE_ENV === 'production'
    && [developmentOtpSecret, exampleOtpSecret].includes(value.AUTH_OTP_HASH_SECRET)) {
    context.addIssue({ code: 'custom', path: ['AUTH_OTP_HASH_SECRET'], message: 'A unique OTP HMAC secret is required in production.' });
  }
  if (value.NODE_ENV === 'production' && value.AUTH_OTP_DELIVERY_MODE === 'webhook'
    && !value.AUTH_OTP_WEBHOOK_BEARER_TOKEN) {
    context.addIssue({ code: 'custom', path: ['AUTH_OTP_WEBHOOK_BEARER_TOKEN'], message: 'An OTP webhook bearer token is required in production.' });
  }
  if (value.NODE_ENV === 'production' && value.AUTH_OTP_WEBHOOK_URL
    && new URL(value.AUTH_OTP_WEBHOOK_URL).protocol !== 'https:') {
    context.addIssue({ code: 'custom', path: ['AUTH_OTP_WEBHOOK_URL'], message: 'The production OTP webhook URL must use HTTPS.' });
  }
});

export const env = environmentSchema.parse(process.env);
