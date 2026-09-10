import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: new URL('../../../../.env', import.meta.url) });

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CLINIC_SERVICE_PORT: z.coerce.number().int().positive().default(4002),
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
});

export const env = environmentSchema.parse(process.env);
