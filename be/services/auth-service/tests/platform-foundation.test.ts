import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

describe('auth-service platform foundation', () => {
  it('keeps a valid request ID through liveness without probing SQL', async () => {
    const requestId = '74ed3a7b-d580-448a-8570-22cb2345c6be';
    const probe = vi.fn(async () => ({ database: 'test' }));
    const response = await request(createApp({ databaseProbe: probe }))
      .get('/health/live')
      .set('x-request-id', requestId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.body).toMatchObject({ data: { status: 'ok' }, meta: {}, requestId });
    expect(probe).not.toHaveBeenCalled();
  });

  it('reports SQL readiness', async () => {
    const response = await request(createApp({ databaseProbe: async () => ({ database: 'PrivateClinicManagement' }) }))
      .get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.data.dependencies.sqlServer).toEqual({
      status: 'up',
      database: 'PrivateClinicManagement',
    });
  });

  it('uses the standard error envelope when SQL is unavailable', async () => {
    const response = await request(createApp({ databaseProbe: async () => { throw new Error('offline'); } }))
      .get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });
});
