import { createApiClient } from '@clinic/generated-api-client';

let accessToken: string | null = null;
const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/api\/v1\/?$/, '') ?? 'http://localhost:5000';
const localHosts = new Set(['localhost', '127.0.0.1']);
const apiBaseUrl = (() => {
  if (typeof window === 'undefined' || !localHosts.has(window.location.hostname)) return configuredBaseUrl;
  let url: URL;
  try { url = new URL(configuredBaseUrl); } catch { return configuredBaseUrl; }
  if (!localHosts.has(url.hostname)) return configuredBaseUrl;
  url.hostname = window.location.hostname;
  return url.toString().replace(/\/$/, '');
})();

export const apiClient = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: async () => accessToken,
});

export function setAccessToken(value: string | null) {
  accessToken = value;
}
