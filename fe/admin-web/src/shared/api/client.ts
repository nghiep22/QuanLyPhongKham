import { createApiClient } from '@clinic/generated-api-client';

let accessToken: string | null = null;

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL?.replace('/api/v1', '') ?? 'http://localhost:5000',
  getAccessToken: async () => accessToken,
});

export function setAccessToken(value: string | null) {
  accessToken = value;
}
