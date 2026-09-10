import { createRequire } from 'node:module';
import type { config, ConnectionPool, IProcedureResult, ISqlType, Request, Transaction } from 'mssql';
import { env } from '../../config.js';

const require = createRequire(import.meta.url);
export const sql = (env.SQL_TRUSTED_CONNECTION
  ? require('mssql/msnodesqlv8')
  : require('mssql')) as typeof import('mssql');

type SqlConfig = config & {
  options?: config['options'] & { trustedConnection?: boolean };
};

const databaseConfig: SqlConfig = {
  server: env.SQL_SERVER,
  port: env.SQL_SERVER.startsWith('np:') ? undefined : env.SQL_PORT,
  database: env.SQL_DATABASE,
  user: env.SQL_TRUSTED_CONNECTION ? undefined : env.SQL_USER,
  password: env.SQL_TRUSTED_CONNECTION ? undefined : env.SQL_PASSWORD,
  driver: env.SQL_TRUSTED_CONNECTION ? env.SQL_ODBC_DRIVER : undefined,
  connectionTimeout: env.SQL_CONNECTION_TIMEOUT_MS,
  requestTimeout: env.SQL_REQUEST_TIMEOUT_MS,
  options: {
    trustedConnection: env.SQL_TRUSTED_CONNECTION,
    encrypt: env.SQL_ENCRYPT,
    trustServerCertificate: env.SQL_TRUST_SERVER_CERTIFICATE,
  },
  pool: { min: 0, max: 10, idleTimeoutMillis: 30_000 },
};

let pool: ConnectionPool | undefined;
let connecting: Promise<ConnectionPool> | undefined;

export async function getSqlPool(): Promise<ConnectionPool> {
  if (pool?.connected) return pool;
  if (!connecting) {
    const candidate = new sql.ConnectionPool(databaseConfig);
    connecting = candidate.connect()
      .then((connectedPool) => {
        pool = connectedPool;
        return connectedPool;
      })
      .finally(() => {
        connecting = undefined;
      });
  }
  return connecting;
}

export async function probeDatabase() {
  const connectedPool = await getSqlPool();
  const result = await connectedPool.request().query<{ databaseName: string }>(
    'SELECT DB_NAME() AS databaseName;',
  );
  return { database: result.recordset[0]?.databaseName ?? env.SQL_DATABASE };
}

export async function closeSqlPool() {
  if (pool) await pool.close();
  pool = undefined;
}

export type CommandContext = {
  requestId: string;
  actorUserId?: number;
  branchId?: number;
};

export type SqlParameter = {
  name: string;
  type: (() => ISqlType) | ISqlType;
  value: unknown;
  direction?: 'input' | 'output';
};

async function setSessionContext(transaction: Transaction, context: CommandContext) {
  const request = transaction.request();
  request.input('requestId', sql.NVarChar(128), context.requestId);
  request.input('actorUserId', sql.BigInt, context.actorUserId ?? null);
  request.input('branchId', sql.BigInt, context.branchId ?? null);
  await request.query(`
    EXEC sys.sp_set_session_context @key=N'request_id', @value=@requestId;
    EXEC sys.sp_set_session_context @key=N'actor_user_id', @value=@actorUserId;
    EXEC sys.sp_set_session_context @key=N'branch_id', @value=@branchId;
  `);
}

async function clearSessionContext(transaction: Transaction) {
  await transaction.request().query(`
    EXEC sys.sp_set_session_context @key=N'request_id', @value=NULL;
    EXEC sys.sp_set_session_context @key=N'actor_user_id', @value=NULL;
    EXEC sys.sp_set_session_context @key=N'branch_id', @value=NULL;
  `);
}

export async function executeCommand<T>(
  procedure: string,
  parameters: SqlParameter[],
  context: CommandContext,
): Promise<IProcedureResult<T>> {
  const connectedPool = await getSqlPool();
  const transaction = new sql.Transaction(connectedPool);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

  try {
    await setSessionContext(transaction, context);
    const request: Request = transaction.request();
    for (const parameter of parameters) {
      if (parameter.direction === 'output') {
        request.output(parameter.name, parameter.type, parameter.value);
      } else {
        request.input(parameter.name, parameter.type, parameter.value);
      }
    }
    const result = await request.execute<T>(procedure);
    await clearSessionContext(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try { await clearSessionContext(transaction); } catch { /* rollback still releases the reserved connection */ }
    try { await transaction.rollback(); } catch { /* keep the original database error */ }
    throw error;
  }
}
