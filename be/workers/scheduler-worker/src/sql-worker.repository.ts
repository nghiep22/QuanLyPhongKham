import { createRequire } from 'node:module';
import type { config, ConnectionPool } from 'mssql';
import type { WorkerEnvironment } from './config.js';
import type { OutboxEvent, PendingNotification, WorkerRepository } from './worker.types.js';

function parseJson(value: string | null): unknown {
  return value ? JSON.parse(value) : null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class SqlWorkerRepository implements WorkerRepository {
  private readonly sql: typeof import('mssql');
  private readonly databaseConfig: config & { options?: config['options'] & { trustedConnection?: boolean } };
  private pool: ConnectionPool | undefined;
  private connecting: Promise<ConnectionPool> | undefined;

  constructor(environment: WorkerEnvironment) {
    const require = createRequire(import.meta.url);
    this.sql = (environment.SQL_TRUSTED_CONNECTION ? require('mssql/msnodesqlv8') : require('mssql')) as typeof import('mssql');
    this.databaseConfig = {
      server: environment.SQL_SERVER,
      port: environment.SQL_SERVER.startsWith('np:') ? undefined : environment.SQL_PORT,
      database: environment.SQL_DATABASE,
      user: environment.SQL_TRUSTED_CONNECTION ? undefined : environment.SQL_WORKER_USER,
      password: environment.SQL_TRUSTED_CONNECTION ? undefined : environment.SQL_WORKER_PASSWORD,
      driver: environment.SQL_TRUSTED_CONNECTION ? environment.SQL_ODBC_DRIVER : undefined,
      connectionTimeout: environment.SQL_CONNECTION_TIMEOUT_MS,
      requestTimeout: environment.SQL_REQUEST_TIMEOUT_MS,
      options: {
        trustedConnection: environment.SQL_TRUSTED_CONNECTION,
        encrypt: environment.SQL_ENCRYPT,
        trustServerCertificate: environment.SQL_TRUST_SERVER_CERTIFICATE,
      },
      pool: { min: 0, max: 5, idleTimeoutMillis: 30_000 },
    };
  }

  private async connected(): Promise<ConnectionPool> {
    if (this.pool?.connected) return this.pool;
    if (!this.connecting) {
      const candidate = new this.sql.ConnectionPool(this.databaseConfig);
      this.connecting = candidate.connect().then((value) => {
        this.pool = value;
        return value;
      }).finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  async ready(): Promise<void> {
    await (await this.connected()).request().query('SELECT 1 AS ready;');
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.close();
    this.pool = undefined;
  }

  async expireAppointmentHolds(requestId: string): Promise<number> {
    const result = await (await this.connected()).request()
      .input('request_id', this.sql.UniqueIdentifier, requestId)
      .output('expired_count', this.sql.Int, 0)
      .execute('dbo.sp_expire_appointment_holds');
    return Number(result.output.expired_count);
  }

  async expirePrescriptions(requestId: string, batchSize: number): Promise<number> {
    const result = await (await this.connected()).request()
      .input('request_id', this.sql.UniqueIdentifier, requestId)
      .input('batch_size', this.sql.Int, batchSize)
      .output('expired_count', this.sql.Int, 0)
      .execute('dbo.sp_expire_due_prescriptions_system');
    return Number(result.output.expired_count);
  }

  async generateDoctorSlots(requestId: string): Promise<number> {
    const result = await (await this.connected()).request()
      .input('request_id', this.sql.UniqueIdentifier, requestId)
      .output('created_count', this.sql.Int, 0)
      .execute('dbo.sp_generate_all_doctor_slots_system');
    return Number(result.output.created_count);
  }

  async scheduleAppointmentReminders(requestId: string, leadMinutes: number): Promise<number> {
    const result = await (await this.connected()).request()
      .input('request_id', this.sql.UniqueIdentifier, requestId)
      .input('lead_minutes', this.sql.Int, leadMinutes)
      .output('scheduled_count', this.sql.Int, 0)
      .execute('dbo.sp_schedule_appointment_reminders');
    return Number(result.output.scheduled_count);
  }

  async claimOutboxEvents(workerId: string, batchSize: number, leaseSeconds: number): Promise<OutboxEvent[]> {
    const result = await (await this.connected()).request()
      .input('worker_id', this.sql.UniqueIdentifier, workerId)
      .input('batch_size', this.sql.Int, batchSize)
      .input('lease_seconds', this.sql.Int, leaseSeconds)
      .execute('dbo.sp_claim_outbox_events');
    return result.recordset.map((row: Record<string, unknown>) => ({
      eventId: String(row.eventId),
      eventType: String(row.eventType),
      schemaVersion: Number(row.schemaVersion),
      producer: String(row.producer),
      aggregateType: String(row.aggregateType),
      aggregateId: String(row.aggregateId),
      occurredAtUtc: iso(row.occurredAtUtc as Date | string),
      correlationId: row.correlationId ? String(row.correlationId) : null,
      causationId: row.causationId ? String(row.causationId) : null,
      payload: parseJson(row.payloadJson as string | null),
      attemptCount: Number(row.attemptCount),
    }));
  }

  async materializeAppointmentNotification(workerId: string, eventId: string): Promise<number> {
    const result = await (await this.connected()).request()
      .input('worker_id', this.sql.UniqueIdentifier, workerId)
      .input('event_id', this.sql.UniqueIdentifier, eventId)
      .output('notification_count', this.sql.Int, 0)
      .execute('dbo.sp_materialize_appointment_notification');
    return Number(result.output.notification_count);
  }

  async completeOutboxEvent(workerId: string, eventId: string): Promise<void> {
    await (await this.connected()).request()
      .input('worker_id', this.sql.UniqueIdentifier, workerId)
      .input('event_id', this.sql.UniqueIdentifier, eventId)
      .execute('dbo.sp_complete_outbox_event');
  }

  async failOutboxEvent(workerId: string, eventId: string, message: string, maxAttempts: number,
    retryBaseSeconds: number): Promise<boolean> {
    const result = await (await this.connected()).request()
      .input('worker_id', this.sql.UniqueIdentifier, workerId)
      .input('event_id', this.sql.UniqueIdentifier, eventId)
      .input('error_message', this.sql.NVarChar(1000), message)
      .input('max_attempts', this.sql.Int, maxAttempts)
      .input('retry_base_seconds', this.sql.Int, retryBaseSeconds)
      .output('dead_lettered', this.sql.Bit, false)
      .execute('dbo.sp_fail_outbox_event');
    return Boolean(result.output.dead_lettered);
  }

  async claimNotifications(workerId: string, batchSize: number, leaseSeconds: number): Promise<PendingNotification[]> {
    const result = await (await this.connected()).request()
      .input('worker_id', this.sql.UniqueIdentifier, workerId)
      .input('batch_size', this.sql.Int, batchSize)
      .input('lease_seconds', this.sql.Int, leaseSeconds)
      .execute('dbo.sp_claim_notifications');
    return result.recordset.map((row: Record<string, unknown>) => ({
      notificationId: String(row.notificationId),
      channel: String(row.channel),
      templateCode: String(row.templateCode),
      recipient: String(row.recipient),
      subject: row.subject === null ? null : String(row.subject),
      body: String(row.body),
      payload: parseJson(row.payloadJson as string | null),
      scheduledAtUtc: iso(row.scheduledAtUtc as Date | string),
      attemptCount: Number(row.attemptCount),
    }));
  }

  async completeNotification(workerId: string, notificationId: string): Promise<void> {
    await (await this.connected()).request()
      .input('worker_id', this.sql.UniqueIdentifier, workerId)
      .input('notification_id', this.sql.UniqueIdentifier, notificationId)
      .execute('dbo.sp_complete_notification');
  }

  async failNotification(workerId: string, notificationId: string, message: string, maxAttempts: number,
    retryBaseSeconds: number): Promise<boolean> {
    const result = await (await this.connected()).request()
      .input('worker_id', this.sql.UniqueIdentifier, workerId)
      .input('notification_id', this.sql.UniqueIdentifier, notificationId)
      .input('error_message', this.sql.NVarChar(1000), message)
      .input('max_attempts', this.sql.Int, maxAttempts)
      .input('retry_base_seconds', this.sql.Int, retryBaseSeconds)
      .output('dead_lettered', this.sql.Bit, false)
      .execute('dbo.sp_fail_notification');
    return Boolean(result.output.dead_lettered);
  }
}
