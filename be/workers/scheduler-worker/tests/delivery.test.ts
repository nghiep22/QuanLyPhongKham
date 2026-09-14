import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConsoleNotificationProvider,
  createConsoleOutboxPublisher,
  createWebhookNotificationProvider,
  createWebhookOutboxPublisher,
} from '../src/delivery.js';
import type { OutboxEvent, PendingNotification, WorkerLogger } from '../src/worker.types.js';

const event: OutboxEvent = {
  eventId: '10000000-0000-4000-8000-000000000001', eventType: 'APPOINTMENT_CREATED', schemaVersion: 1,
  producer: 'clinic-service', aggregateType: 'APPOINTMENT',
  aggregateId: '20000000-0000-4000-8000-000000000001', occurredAtUtc: '2026-09-14T01:00:00.000Z',
  correlationId: null, causationId: null, payload: { appointmentPublicId: 'appointment' }, attemptCount: 1,
};
const notification: PendingNotification = {
  notificationId: '30000000-0000-4000-8000-000000000001', channel: 'EMAIL',
  templateCode: 'APPOINTMENT_CREATED', recipient: 'patient@example.test', subject: 'Subject',
  body: 'Private body', payload: { appointmentPublicId: 'appointment' },
  scheduledAtUtc: '2026-09-14T01:00:00.000Z', attemptCount: 1,
};
const options = { url: 'https://provider.example.test/events', bearerToken: 'test-token', timeoutMs: 1_000 };

afterEach(() => vi.unstubAllGlobals());

describe('delivery adapters', () => {
  it('publishes a versioned outbox envelope with stable correlation fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    await createWebhookOutboxPublisher(options).publish(event);

    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(request.headers).toEqual(expect.objectContaining({ authorization: 'Bearer test-token' }));
    expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
      eventId: event.eventId,
      eventType: event.eventType,
      schemaVersion: 1,
      producer: event.producer,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAtUtc,
      correlationId: event.eventId,
      payload: event.payload,
    }));
  });

  it('sends the notification contract to the configured webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    await createWebhookNotificationProvider(options).send(notification);

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body).toEqual(expect.objectContaining({
      id: notification.notificationId,
      recipient: notification.recipient,
      body: notification.body,
    }));
  });

  it('does not include a provider response body in delivery errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, body: 'secret response' }));
    await expect(createWebhookOutboxPublisher(options).publish(event)).rejects.toThrow('HTTP 502');
    await expect(createWebhookOutboxPublisher(options).publish(event)).rejects.not.toThrow('secret response');
  });

  it('keeps console-mode logs free of payload, recipient, and body', async () => {
    const log: WorkerLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await createConsoleOutboxPublisher(log).publish(event);
    await createConsoleNotificationProvider(log).send(notification);
    const serialized = JSON.stringify(vi.mocked(log.info).mock.calls);
    expect(serialized).not.toContain(notification.recipient);
    expect(serialized).not.toContain(notification.body);
    expect(serialized).not.toContain('appointmentPublicId');
  });
});
