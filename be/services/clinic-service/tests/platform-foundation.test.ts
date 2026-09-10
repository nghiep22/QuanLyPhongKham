import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

describe('clinic-service platform foundation', () => {
  it('generates a safe request ID and does not probe SQL for liveness', async () => {
    const probe = vi.fn(async () => ({ database: 'test' }));
    const response = await request(createApp(probe))
      .get('/health/live')
      .set('x-request-id', 'invalid request id');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(response.body.data.status).toBe('ok');
    expect(probe).not.toHaveBeenCalled();
  });

  it('reports SQL readiness', async () => {
    const response = await request(createApp(async () => ({ database: 'PrivateClinicManagement' })))
      .get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ready');
    expect(response.body.data.dependencies.sqlServer.status).toBe('up');
  });

  it('returns the standard 404 envelope', async () => {
    const response = await request(createApp()).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });
});
