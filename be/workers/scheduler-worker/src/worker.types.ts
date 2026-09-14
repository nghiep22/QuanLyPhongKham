export interface OutboxEvent {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  occurredAtUtc: string;
  correlationId: string | null;
  causationId: string | null;
  payload: unknown;
  attemptCount: number;
}

export interface PendingNotification {
  notificationId: string;
  channel: string;
  templateCode: string;
  recipient: string;
  subject: string | null;
  body: string;
  payload: unknown;
  scheduledAtUtc: string;
  attemptCount: number;
}

export interface WorkerRepository {
  ready(): Promise<void>;
  close(): Promise<void>;
  expireAppointmentHolds(requestId: string): Promise<number>;
  generateDoctorSlots(requestId: string): Promise<number>;
  scheduleAppointmentReminders(requestId: string, leadMinutes: number): Promise<number>;
  claimOutboxEvents(workerId: string, batchSize: number, leaseSeconds: number): Promise<OutboxEvent[]>;
  materializeAppointmentNotification(workerId: string, eventId: string): Promise<number>;
  completeOutboxEvent(workerId: string, eventId: string): Promise<void>;
  failOutboxEvent(workerId: string, eventId: string, message: string, maxAttempts: number, retryBaseSeconds: number): Promise<boolean>;
  claimNotifications(workerId: string, batchSize: number, leaseSeconds: number): Promise<PendingNotification[]>;
  completeNotification(workerId: string, notificationId: string): Promise<void>;
  failNotification(workerId: string, notificationId: string, message: string, maxAttempts: number, retryBaseSeconds: number): Promise<boolean>;
}

export interface OutboxPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

export interface NotificationProvider {
  send(notification: PendingNotification): Promise<void>;
}

export interface WorkerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}
