import { randomUUID } from 'node:crypto';
import type { NotificationProvider, OutboxPublisher, WorkerLogger, WorkerRepository } from './worker.types.js';

export interface BackgroundJobOptions {
  workerId: string;
  reminderLeadMinutes: number;
  batchSize: number;
  leaseSeconds: number;
  maxAttempts: number;
  retryBaseSeconds: number;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown delivery failure.';
  return message.replace(/[\r\n]+/g, ' ').slice(0, 1_000);
}

export class BackgroundJobs {
  private readonly running = new Set<string>();

  constructor(
    private readonly repository: WorkerRepository,
    private readonly outboxPublisher: OutboxPublisher,
    private readonly notificationProvider: NotificationProvider,
    private readonly logger: WorkerLogger,
    private readonly options: BackgroundJobOptions,
  ) {}

  private async run(name: string, action: () => Promise<number>): Promise<number> {
    if (this.running.has(name)) return 0;
    this.running.add(name);
    try {
      return await action();
    } catch (error) {
      this.logger.error({ job: name, error: safeError(error) }, 'background job failed');
      return 0;
    } finally {
      this.running.delete(name);
    }
  }

  expireAppointmentHolds(): Promise<number> {
    return this.run('expire-appointment-holds', async () => {
      const expiredCount = await this.repository.expireAppointmentHolds(randomUUID());
      if (expiredCount) this.logger.info({ expiredCount }, 'expired appointment holds');
      return expiredCount;
    });
  }

  generateDoctorSlots(): Promise<number> {
    return this.run('generate-doctor-slots', async () => {
      const createdCount = await this.repository.generateDoctorSlots(randomUUID());
      this.logger.info({ createdCount }, 'appointment slot generation completed');
      return createdCount;
    });
  }

  scheduleAppointmentReminders(): Promise<number> {
    return this.run('schedule-appointment-reminders', async () => {
      const scheduledCount = await this.repository.scheduleAppointmentReminders(
        randomUUID(), this.options.reminderLeadMinutes,
      );
      if (scheduledCount) this.logger.info({ scheduledCount }, 'appointment reminders scheduled');
      return scheduledCount;
    });
  }

  publishOutbox(): Promise<number> {
    return this.run('publish-outbox', async () => {
      const events = await this.repository.claimOutboxEvents(
        this.options.workerId, this.options.batchSize, this.options.leaseSeconds,
      );
      await Promise.all(events.map(async (event) => {
        try {
          await this.repository.materializeAppointmentNotification(this.options.workerId, event.eventId);
          await this.outboxPublisher.publish(event);
          await this.repository.completeOutboxEvent(this.options.workerId, event.eventId);
        } catch (error) {
          const message = safeError(error);
          const deadLettered = await this.repository.failOutboxEvent(
            this.options.workerId, event.eventId, message,
            this.options.maxAttempts, this.options.retryBaseSeconds,
          );
          this.logger[deadLettered ? 'error' : 'warn'](
            { eventId: event.eventId, eventType: event.eventType, attemptCount: event.attemptCount, error: message },
            deadLettered ? 'outbox event dead-lettered' : 'outbox event scheduled for retry',
          );
        }
      }));
      return events.length;
    });
  }

  deliverNotifications(): Promise<number> {
    return this.run('deliver-notifications', async () => {
      const notifications = await this.repository.claimNotifications(
        this.options.workerId, this.options.batchSize, this.options.leaseSeconds,
      );
      await Promise.all(notifications.map(async (notification) => {
        try {
          await this.notificationProvider.send(notification);
          await this.repository.completeNotification(this.options.workerId, notification.notificationId);
        } catch (error) {
          const message = safeError(error);
          const deadLettered = await this.repository.failNotification(
            this.options.workerId, notification.notificationId, message,
            this.options.maxAttempts, this.options.retryBaseSeconds,
          );
          this.logger[deadLettered ? 'error' : 'warn'](
            { notificationId: notification.notificationId, channel: notification.channel,
              templateCode: notification.templateCode, attemptCount: notification.attemptCount, error: message },
            deadLettered ? 'notification dead-lettered' : 'notification scheduled for retry',
          );
        }
      }));
      return notifications.length;
    });
  }
}
