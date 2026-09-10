import { createApiClient } from '@clinic/generated-api-client';

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL?.replace('/api/v1', '') ?? 'http://localhost:5000',
});
