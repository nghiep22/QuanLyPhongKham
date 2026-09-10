export type ApiClientOptions = {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null>;
};

export * from './generated/sdk.gen.js';
export { client as generatedClient } from './generated/client.gen.js';

export function createApiClient(options: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = await options.getAccessToken?.();
    const response = await fetch(`${options.baseUrl}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => undefined) as
        | { error?: { code?: string; message?: string }; requestId?: string }
        | undefined;
      throw new ApiClientError(
        response.status,
        body?.error?.code ?? 'HTTP_ERROR',
        body?.error?.message ?? `API request failed with status ${response.status}`,
        body?.requestId ?? response.headers.get('x-request-id') ?? undefined,
      );
    }

    return response.json() as Promise<T>;
  }

  return {
    request,
    auth: {
      login: (body: import('@clinic/generated-api-types').LoginRequest) =>
        request<import('@clinic/generated-api-types').AuthResponse>('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      refresh: (body: import('@clinic/generated-api-types').RefreshRequest = {}) =>
        request<import('@clinic/generated-api-types').AuthResponse>('/api/v1/auth/refresh', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      logout: (body: import('@clinic/generated-api-types').RefreshRequest = {}) =>
        request<import('@clinic/generated-api-types').LogoutResponse>('/api/v1/auth/logout', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
      logoutAll: () =>
        request<import('@clinic/generated-api-types').LogoutAllResponse>('/api/v1/auth/logout-all', {
          method: 'POST',
        }),
    },
    health: {
      live: () => request<import('@clinic/generated-api-types').HealthResponse>('/health/live'),
      ready: () => request<import('@clinic/generated-api-types').ReadinessResponse>('/health/ready'),
    },
  };
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
