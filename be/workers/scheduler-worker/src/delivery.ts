import type { OutboxPublisher, NotificationProvider, PendingNotification, WorkerLogger } from './worker.types.js';

interface WebhookOptions {
  url: string;
  bearerToken?: string;
  timeoutMs: number;
}

async function postJson(options: WebhookOptions, body: unknown): Promise<void> {
  const response = await fetch(options.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(options.bearerToken ? { authorization: `Bearer ${options.bearerToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
}

export function createConsoleOutboxPublisher(logger: WorkerLogger): OutboxPublisher {
  return {
    async publish(event) {
      logger.info({ developmentOnly: true, eventId: event.eventId, eventType: event.eventType,
        aggregateType: event.aggregateType }, 'outbox event published to development console');
    },
  };
}

export function createWebhookOutboxPublisher(options: WebhookOptions): OutboxPublisher {
  return {
    publish: (event) => postJson(options, {
      eventId: event.eventId,
      eventType: event.eventType,
      schemaVersion: event.schemaVersion,
      producer: event.producer,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAtUtc,
      correlationId: event.correlationId ?? event.eventId,
      causationId: event.causationId,
      payload: event.payload,
    }),
  };
}

export function createConsoleNotificationProvider(logger: WorkerLogger): NotificationProvider {
  return {
    async send(notification) {
      logger.info({ developmentOnly: true, notificationId: notification.notificationId,
        channel: notification.channel, templateCode: notification.templateCode },
      'notification delivered to development console');
    },
  };
}

export function createWebhookNotificationProvider(options: WebhookOptions): NotificationProvider {
  return {
    send: (notification: PendingNotification) => postJson(options, {
      id: notification.notificationId,
      channel: notification.channel,
      templateCode: notification.templateCode,
      recipient: notification.recipient,
      subject: notification.subject,
      body: notification.body,
      data: notification.payload,
      scheduledAtUtc: notification.scheduledAtUtc,
    }),
  };
}
