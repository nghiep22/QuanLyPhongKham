import { createApiClient } from '@clinic/generated-api-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('API network errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('wraps only transport failures in ApiNetworkError', async () => {
    const cause = new TypeError('Network request failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(cause));
    const client = createApiClient({ baseUrl: 'http://localhost:5000' });

    const request = client.auth.login({ identifier: 'patient.demo', password: 'password', clientType: 'mobile' });
    await expect(request).rejects.toMatchObject({ name: 'ApiNetworkError', cause });
  });
});
