import { describe, expect, it } from 'vitest';
import { parseWorkerEnvironment } from '../src/config.js';

describe('worker configuration', () => {
  it('requires dedicated worker credentials for SQL authentication', () => {
    expect(() => parseWorkerEnvironment({
      SQL_TRUSTED_CONNECTION: 'false',
      SQL_USER: 'generic-api-user',
      SQL_PASSWORD: 'generic-api-password',
    })).toThrow('SQL_WORKER_USER and SQL_WORKER_PASSWORD');
  });

  it('rejects console delivery in production', () => {
    expect(() => parseWorkerEnvironment({ NODE_ENV: 'production' })).toThrow('development-only');
  });

  it('treats empty optional values from the example env as unset', () => {
    expect(parseWorkerEnvironment({
      OUTBOX_WEBHOOK_URL: '',
      OUTBOX_WEBHOOK_BEARER_TOKEN: '',
      NOTIFICATION_WEBHOOK_URL: '',
      NOTIFICATION_WEBHOOK_BEARER_TOKEN: '',
      SQL_WORKER_USER: '',
      SQL_WORKER_PASSWORD: '',
    }).OUTBOX_WEBHOOK_URL).toBeUndefined();
  });

  it('accepts authenticated HTTPS webhooks in production', () => {
    expect(parseWorkerEnvironment({
      NODE_ENV: 'production',
      OUTBOX_PUBLISH_MODE: 'webhook',
      OUTBOX_WEBHOOK_URL: 'https://events.example.test/outbox',
      OUTBOX_WEBHOOK_BEARER_TOKEN: 'outbox-token-long',
      NOTIFICATION_DELIVERY_MODE: 'webhook',
      NOTIFICATION_WEBHOOK_URL: 'https://events.example.test/notifications',
      NOTIFICATION_WEBHOOK_BEARER_TOKEN: 'notification-token-long',
    }).NODE_ENV).toBe('production');
  });

  it('bounds prescription expiry cadence and batch size', () => {
    expect(() => parseWorkerEnvironment({ PRESCRIPTION_EXPIRY_SWEEP_MS: '59999' })).toThrow();
    expect(() => parseWorkerEnvironment({ PRESCRIPTION_EXPIRY_BATCH_SIZE: '1001' })).toThrow();
    expect(parseWorkerEnvironment({}).PRESCRIPTION_EXPIRY_BATCH_SIZE).toBe(500);
  });
});
