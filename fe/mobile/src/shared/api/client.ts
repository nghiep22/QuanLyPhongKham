import { createApiClient } from '@clinic/generated-api-client';
import { authTokenStorage } from '../storage/auth-token';

export const apiClient = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL?.replace('/api/v1', '') ?? 'http://localhost:5000',
  getAccessToken: authTokenStorage.getAccessToken,
});
