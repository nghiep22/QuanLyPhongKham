import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { closeSqlPool, executeCommand, sql } from '../infrastructure/database/sql-database.js';

const input = z.object({
  BOOTSTRAP_ADMIN_USERNAME: z.string().trim().min(3).max(80),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(200),
  BOOTSTRAP_ADMIN_DISPLAY_NAME: z.string().trim().min(2).max(200),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
}).parse(process.env);

try {
  const passwordHash = await argon2.hash(input.BOOTSTRAP_ADMIN_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const result = await executeCommand('dbo.sp_bootstrap_first_admin', [
    { name: 'username', type: sql.NVarChar(80), value: input.BOOTSTRAP_ADMIN_USERNAME },
    { name: 'email', type: sql.VarChar(254), value: input.BOOTSTRAP_ADMIN_EMAIL ?? null },
    { name: 'phone', type: sql.VarChar(20), value: null },
    { name: 'password_hash', type: sql.VarChar(255), value: passwordHash },
    { name: 'display_name', type: sql.NVarChar(200), value: input.BOOTSTRAP_ADMIN_DISPLAY_NAME },
    { name: 'user_id', type: sql.BigInt, value: null, direction: 'output' },
  ], { requestId: randomUUID() });
  process.stdout.write(`Đã tạo admin đầu tiên (internal user ID: ${String(result.output.user_id)}).\n`);
} finally {
  await closeSqlPool();
}
