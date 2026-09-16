import { describe, expect, it, vi } from 'vitest';
import { BackgroundJobs } from '../src/background-jobs.js';
import type {
  NotificationProvider,
  OutboxEvent,
  OutboxPublisher,
  PendingNotification,
  WorkerLogger,
  WorkerRepository,
} from '../src/worker.types.js';

const event: OutboxEvent = {
  eventId: '10000000-0000-4000-8000-000000000001',
  eventType: 'APPOINTMENT_CONFIRMED',
  schemaVersion: 1,
  producer: 'clinic-service',
  aggregateType: 'APPOINTMENT',
  aggregateId: '20000000-0000-4000-8000-000000000001',
  occurredAtUtc: '2026-09-14T01:00:00.000Z',
  correlationId: null,
  causationId: null,
  payload: { privateValue: 'must-not-be-logged' },
  attemptCount: 1,
};

const notification: PendingNotification = {
  notificationId: '30000000-0000-4000-8000-000000000001',
  channel: 'EMAIL',
  templateCode: 'APPOINTMENT_REMINDER',
  recipient: 'patient@example.test',
  subject: 'Reminder',
  body: 'Private notification body',
  payload: { privateValue: 'must-not-be-logged' },
  scheduledAtUtc: '2026-09-14T01:00:00.000Z',
  attemptCount: 1,
};

function repository(overrides: Partial<WorkerRepository> = {}): WorkerRepository {
  return {
    ready: vi.fn(),
    close: vi.fn(),
    expireAppointmentHolds: vi.fn().mockResolvedValue(0),
    expirePrescriptions: vi.fn().mockResolvedValue(0),
    generateDoctorSlots: vi.fn().mockResolvedValue(0),
    scheduleAppointmentReminders: vi.fn().mockResolvedValue(0),
    claimOutboxEvents: vi.fn().mockResolvedValue([]),
    materializeAppointmentNotification: vi.fn().mockResolvedValue(0),
    completeOutboxEvent: vi.fn(),
    failOutboxEvent: vi.fn().mockResolvedValue(false),
    claimNotifications: vi.fn().mockResolvedValue([]),
    completeNotification: vi.fn(),
    failNotification: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function logger(): WorkerLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createJobs(
  repo: WorkerRepository,
  publisher: OutboxPublisher = { publish: vi.fn() },
  provider: NotificationProvider = { send: vi.fn() },
  log: WorkerLogger = logger(),
): BackgroundJobs {
  return new BackgroundJobs(repo, publisher, provider, log, {
    workerId: '40000000-0000-4000-8000-000000000001',
    reminderLeadMinutes: 1_440,
    prescriptionExpiryBatchSize: 500,
    batchSize: 20,
    leaseSeconds: 60,
    maxAttempts: 5,
    retryBaseSeconds: 15,
  });
}

describe('BackgroundJobs', () => {
  it('expires prescriptions in a bounded batch without overlapping the same job', async () => {
    let release!: (count: number) => void;
    const pending = new Promise<number>((resolve) => { release = resolve; });
    const expirePrescriptions = vi.fn().mockReturnValue(pending);
    const repo = repository({ expirePrescriptions });
    const log = logger();
    const jobs = createJobs(repo, undefined, undefined, log);

    const first = jobs.expirePrescriptions();
    await expect(jobs.expirePrescriptions()).resolves.toBe(0);
    release(3);
    await expect(first).resolves.toBe(3);

    expect(expirePrescriptions).toHaveBeenCalledWith(expect.any(String), 500);
    expect(expirePrescriptions).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith({ expiredCount: 3 }, 'expired prescriptions');
  });

  it('materializes, publishes, then completes each outbox event', async () => {
    const repo = repository({ claimOutboxEvents: vi.fn().mockResolvedValue([event]) });
    const publisher = { publish: vi.fn() };

    await expect(createJobs(repo, publisher).publishOutbox()).resolves.toBe(1);

    expect(repo.materializeAppointmentNotification).toHaveBeenCalledWith(expect.any(String), event.eventId);
    expect(publisher.publish).toHaveBeenCalledWith(event);
    expect(repo.completeOutboxEvent).toHaveBeenCalledWith(expect.any(String), event.eventId);
    expect(vi.mocked(repo.materializeAppointmentNotification).mock.invocationCallOrder[0])
      .toBeLessThan(publisher.publish.mock.invocationCallOrder[0]!);
    expect(publisher.publish.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(repo.completeOutboxEvent).mock.invocationCallOrder[0]!);
  });

  it('schedules a failed outbox event for retry without logging its payload', async () => {
    const repo = repository({ claimOutboxEvents: vi.fn().mockResolvedValue([event]) });
    const publisher = { publish: vi.fn().mockRejectedValue(new Error('provider failed\nsecond line')) };
    const log = logger();

    await expect(createJobs(repo, publisher, undefined, log).publishOutbox()).resolves.toBe(1);

    expect(repo.completeOutboxEvent).not.toHaveBeenCalled();
    expect(repo.failOutboxEvent).toHaveBeenCalledWith(
      expect.any(String), event.eventId, 'provider failed second line', 5, 15,
    );
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain('must-not-be-logged');
  });

  it('completes sent notifications and dead-letters terminal failures', async () => {
    const sentRepo = repository({ claimNotifications: vi.fn().mockResolvedValue([notification]) });
    const provider = { send: vi.fn() };
    await expect(createJobs(sentRepo, undefined, provider).deliverNotifications()).resolves.toBe(1);
    expect(sentRepo.completeNotification).toHaveBeenCalledWith(expect.any(String), notification.notificationId);

    const failedRepo = repository({
      claimNotifications: vi.fn().mockResolvedValue([notification]),
      failNotification: vi.fn().mockResolvedValue(true),
    });
    const failedProvider = { send: vi.fn().mockRejectedValue(new Error('provider unavailable')) };
    const log = logger();
    await createJobs(failedRepo, undefined, failedProvider, log).deliverNotifications();
    expect(failedRepo.completeNotification).not.toHaveBeenCalled();
    expect(failedRepo.failNotification).toHaveBeenCalledWith(
      expect.any(String), notification.notificationId, 'provider unavailable', 5, 15,
    );
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ notificationId: notification.notificationId }),
      'notification dead-lettered');
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain(notification.recipient);
  });

  it('does not overlap two runs of the same job in one process', async () => {
    let release!: (events: OutboxEvent[]) => void;
    const pending = new Promise<OutboxEvent[]>((resolve) => { release = resolve; });
    const repo = repository({ claimOutboxEvents: vi.fn().mockReturnValue(pending) });
    const jobs = createJobs(repo);

    const first = jobs.publishOutbox();
    await expect(jobs.publishOutbox()).resolves.toBe(0);
    release([]);
    await expect(first).resolves.toBe(0);
    expect(repo.claimOutboxEvents).toHaveBeenCalledTimes(1);
  });
});
